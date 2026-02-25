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
  campaignJobId?: string
}

export type EnqueueMessageResult = {
  ok: boolean
  status: 'queued' | 'duplicate' | 'rate_limited' | 'instance_disconnected' | 'tenant_degraded' | 'error'
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

  // Tenant status check skipped — no tenants table in current schema

  const { data: connectedInstance } = await input.supabase
    .from('whatsapp_instancias')
    .select('id, instance_name, status')
    .eq('id', input.payload.instanceId)
    .eq('user_id', input.tenantId)
    .maybeSingle()

  if (!connectedInstance || connectedInstance.status !== 'connected') {
    console.warn(JSON.stringify({
      level: 'warn',
      event: 'enqueue_fail_fast_instance_unavailable',
      tenant_id: input.tenantId,
      instance_id: input.payload.instanceId,
      instance_status: connectedInstance?.status ?? 'missing',
      reason: 'instance_not_connected',
    }))
    return {
      ok: false,
      status: 'instance_disconnected',
      idempotencyKey,
      reason: 'instance_not_connected',
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

  const { data: allowedToken, error: tokenError } = await input.supabase.rpc('consume_token', {
    p_tenant_id: input.tenantId,
    p_instance_id: connectedInstance.id,
    p_amount: 1,
  })

  if (tokenError) {
    return { ok: false, status: 'error', idempotencyKey, reason: tokenError.message }
  }

  if (!allowedToken) {
    return { ok: false, status: 'rate_limited', idempotencyKey, reason: 'tenant_instance_token_bucket_exhausted' }
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
    campaign_job_id: input.campaignJobId ?? null,
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
