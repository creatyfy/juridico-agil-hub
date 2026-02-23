import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildIdempotencyKey, type OutboxPayload } from './outbox.ts'

const TENANT_BUCKET_CAPACITY = Number(Deno.env.get('TENANT_BUCKET_CAPACITY') ?? '30')
const TENANT_BUCKET_REFILL_PER_SECOND = Number(Deno.env.get('TENANT_BUCKET_REFILL_PER_SECOND') ?? '1')
const INSTANCE_BUCKET_CAPACITY = Number(Deno.env.get('INSTANCE_BUCKET_CAPACITY') ?? '10')
const INSTANCE_BUCKET_REFILL_PER_SECOND = Number(Deno.env.get('INSTANCE_BUCKET_REFILL_PER_SECOND') ?? '0.5')
const OUTBOX_BACKLOG_LIMIT_PER_TENANT = Number(Deno.env.get('OUTBOX_BACKLOG_LIMIT_PER_TENANT') ?? '500')
const OUTBOX_BACKLOG_BLOCK_ENQUEUE = String(Deno.env.get('OUTBOX_BACKLOG_BLOCK_ENQUEUE') ?? 'true').toLowerCase() === 'true'

export type EnqueueMessageInput = {
  supabase: SupabaseClient
  tenantId: string
  destination: string
  payload: OutboxPayload
  reference: string
  event: string
  aggregateType?: string
  aggregateId?: string
}

export type EnqueueMessageResult = {
  ok: boolean
  status: 'queued' | 'duplicate' | 'rate_limited' | 'instance_disconnected' | 'error'
  idempotencyKey: string
  outboxId?: string
  reason?: string
}

function normalizeDestination(destination: string): string {
  return destination.replace('@s.whatsapp.net', '').replace('@lid', '').replace(/\D/g, '')
}

export async function enqueueMessage(input: EnqueueMessageInput): Promise<EnqueueMessageResult> {
  const normalizedDestination = normalizeDestination(input.destination)
  const idempotencyKey = await buildIdempotencyKey({
    tenantId: input.tenantId,
    event: input.event,
    destination: normalizedDestination,
    reference: input.reference,
  })


  const { data: existing } = await input.supabase
    .from('message_outbox')
    .select('id')
    .eq('tenant_id', input.tenantId)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle()

  if (existing?.id) {
    return {
      ok: true,
      status: 'duplicate',
      idempotencyKey,
      outboxId: existing.id,
    }
  }

  const { data: connectedInstance } = await input.supabase
    .from('whatsapp_instancias')
    .select('id, instance_name, status, is_available, unavailable_reason')
    .eq('id', input.payload.instanceId)
    .eq('user_id', input.tenantId)
    .maybeSingle()

  if (!connectedInstance || connectedInstance.status !== 'connected' || connectedInstance.is_available === false) {
    console.warn(JSON.stringify({
      level: 'warn',
      event: 'enqueue_fail_fast_instance_unavailable',
      tenant_id: input.tenantId,
      instance_id: input.payload.instanceId,
      instance_status: connectedInstance?.status ?? 'missing',
      reason: connectedInstance?.unavailable_reason ?? 'instance_not_connected',
    }))
    return {
      ok: false,
      status: 'instance_disconnected',
      idempotencyKey,
      reason: connectedInstance?.unavailable_reason ?? 'instance_not_connected',
    }
  }

  const { count: backlogCount, error: backlogCountError } = await input.supabase
    .from('message_outbox')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', input.tenantId)
    .in('status', ['pending', 'retry', 'sending', 'accepted'])

  if (backlogCountError) {
    console.error(JSON.stringify({
      level: 'error',
      event: 'backlog_guard_count_failed',
      tenant_id: input.tenantId,
      error: backlogCountError.message,
    }))
    return { ok: false, status: 'error', idempotencyKey, reason: backlogCountError.message }
  }

  if ((backlogCount ?? 0) > OUTBOX_BACKLOG_LIMIT_PER_TENANT) {
    console.warn(JSON.stringify({
      level: 'warn',
      event: 'backlog_guard_triggered',
      tenant_id: input.tenantId,
      backlog: backlogCount,
      limit: OUTBOX_BACKLOG_LIMIT_PER_TENANT,
      block_enqueue: OUTBOX_BACKLOG_BLOCK_ENQUEUE,
    }))

    if (OUTBOX_BACKLOG_BLOCK_ENQUEUE) {
      return {
        ok: false,
        status: 'rate_limited',
        idempotencyKey,
        reason: 'tenant_backlog_limit_exceeded',
      }
    }
  }

  const { data: rateLimitAllowed, error: rateLimitError } = await input.supabase.rpc('consume_rate_limit_tokens_pair', {
    p_tenant_id: input.tenantId,
    p_instance_key: connectedInstance.id,
    p_tenant_capacity: TENANT_BUCKET_CAPACITY,
    p_tenant_refill_per_second: TENANT_BUCKET_REFILL_PER_SECOND,
    p_instance_capacity: INSTANCE_BUCKET_CAPACITY,
    p_instance_refill_per_second: INSTANCE_BUCKET_REFILL_PER_SECOND,
    p_amount: 1,
  })

  if (rateLimitError) {
    return {
      ok: false,
      status: 'error',
      idempotencyKey,
      reason: rateLimitError.message,
    }
  }

  if (!rateLimitAllowed) {
    return {
      ok: false,
      status: 'rate_limited',
      idempotencyKey,
      reason: 'rate_limit_exceeded',
    }
  }

  const outboxRow = {
    tenant_id: input.tenantId,
    aggregate_type: input.aggregateType ?? 'whatsapp',
    aggregate_id: input.aggregateId ?? connectedInstance.id,
    idempotency_key: idempotencyKey,
    payload: {
      ...input.payload,
      destinationNumber: normalizedDestination,
      instanceId: connectedInstance.id,
      instanceName: connectedInstance.instance_name,
      userId: input.tenantId,
    },
    status: 'pending',
  }

  const { data, error } = await input.supabase
    .from('message_outbox')
    .upsert(outboxRow, { onConflict: 'tenant_id,idempotency_key', ignoreDuplicates: true })
    .select('id')

  if (error) {
    return {
      ok: false,
      status: 'error',
      idempotencyKey,
      reason: error.message,
    }
  }

  const row = Array.isArray(data) ? data[0] : data
  if (!row?.id) {
    return {
      ok: true,
      status: 'duplicate',
      idempotencyKey,
    }
  }

  return {
    ok: true,
    status: 'queued',
    idempotencyKey,
    outboxId: row.id,
  }
}
