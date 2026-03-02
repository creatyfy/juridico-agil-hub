// @ts-nocheck - Deno edge function
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { buildIdempotencyKey } from '../_shared/outbox.ts'
import { explainMovement } from '../webhook-whatsapp/services/ai.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
}

const BATCH_SIZE = Number(Deno.env.get('DOMAIN_EVENTS_BATCH_SIZE') ?? '30')
const LEASE_SECONDS = Number(Deno.env.get('DOMAIN_EVENTS_LEASE_SECONDS') ?? '45')
const MAX_ATTEMPTS = Number(Deno.env.get('DOMAIN_EVENTS_MAX_ATTEMPTS') ?? '6')
const DAILY_NOTIFICATION_COOLDOWN_HOURS = Number(Deno.env.get('WHATSAPP_DAILY_NOTIFICATION_COOLDOWN_HOURS') ?? '8')
const OUTBOX_BACKLOG_LIMIT_PER_TENANT = Number(Deno.env.get('OUTBOX_BACKLOG_LIMIT_PER_TENANT') ?? '500')
const OUTBOX_BACKLOG_BLOCK_ENQUEUE = String(Deno.env.get('OUTBOX_BACKLOG_BLOCK_ENQUEUE') ?? 'true').toLowerCase() === 'true'

function normalizeDestination(destination: string): string {
  return destination.replace('@s.whatsapp.net', '').replace('@lid', '').replace(/\D/g, '')
}

function backoffMs(attempts: number): number {
  return Math.min(120_000, 1500 * 2 ** Math.max(attempts - 1, 0))
}

function sameDay(dateA: Date, dateB: Date): boolean {
  return dateA.getUTCFullYear() === dateB.getUTCFullYear()
    && dateA.getUTCMonth() === dateB.getUTCMonth()
    && dateA.getUTCDate() === dateB.getUTCDate()
}

// deno-lint-ignore no-explicit-any
async function enqueueOutboundLog(
  svc: any,
  tenantId: string,
  phoneNumber: string,
  message: string,
  intent: string,
): Promise<void> {
  await svc.from('conversation_logs').insert({
    tenant_id: tenantId,
    phone_number: phoneNumber,
    message,
    direction: 'outbound',
    intent,
  })
}

// deno-lint-ignore no-explicit-any
export async function processMovementDetected(svc: any, event: any): Promise<void> {
  const payload = event.payload ?? {}
  const processoId = payload.processo_id as string | undefined
  const resumo = (payload.resumo as string | undefined) ?? 'Nova movimentação processual detectada.'
  const totalMovimentacoes = Number(payload.total_movimentacoes ?? 1)
  const movementId = payload.movement_id as string | undefined

  if (!processoId) throw new Error('missing_processo_id')
  if (!movementId) throw new Error('missing_movement_id')

  const { data: processo } = await svc
    .from('processos')
    .select('id, numero_cnj, user_id')
    .eq('id', processoId)
    .maybeSingle()

  if (!processo) throw new Error('process_not_found')

  await svc.from('notificacoes').insert({
    user_id: processo.user_id,
    tipo: 'movimentacao',
    titulo: 'Nova movimentação processual',
    mensagem: `Processo ${processo.numero_cnj} recebeu uma atualização.`,
    link: `/processos/${processo.id}`,
    metadata: { event_id: event.id, resumo },
  })

  const summary = await explainMovement(resumo)

  const { data: contacts } = await svc
    .from('whatsapp_contacts')
    .select('id, phone_number, client_id, verified, notifications_opt_in, last_notification_sent_at')
    .eq('tenant_id', processo.user_id)
    .eq('process_id', processo.id)
    .eq('verified', true)
    .eq('notifications_opt_in', true)

  const { data: instance } = await svc
    .from('whatsapp_instancias')
    .select('id, instance_name')
    .eq('user_id', processo.user_id)
    .eq('status', 'connected')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!instance) return

  for (const contact of contacts ?? []) {
    if (!contact?.phone_number) continue

    if (movementId) {
      const { data: existingNotification } = await svc
        .from('process_movement_notifications')
        .select('id')
        .eq('tenant_id', processo.user_id)
        .eq('movement_id', movementId)
        .eq('contact_id', contact.id)
        .maybeSingle()

      if (existingNotification?.id) continue
    }

    const destination = normalizeDestination(String(contact.phone_number))
    const now = new Date()
    const lastSentAt = contact.last_notification_sent_at ? new Date(contact.last_notification_sent_at) : null
    const cooldownActive = lastSentAt
      ? (now.getTime() - lastSentAt.getTime()) < DAILY_NOTIFICATION_COOLDOWN_HOURS * 60 * 60 * 1000
      : false

    if (cooldownActive && lastSentAt && sameDay(lastSentAt, now)) {
      continue
    }

    const groupedPrefix = totalMovimentacoes > 1
      ? `Detectamos ${totalMovimentacoes} novas movimentações hoje no processo ${processo.numero_cnj}. `
      : `Nova movimentação no processo ${processo.numero_cnj}. `

    const messageText = `${groupedPrefix}${summary}`

    const { data: connectedInstance } = await svc
      .from('whatsapp_instancias')
      .select('id, instance_name, status')
      .eq('id', instance.id)
      .eq('user_id', processo.user_id)
      .maybeSingle()

    if (!connectedInstance || connectedInstance.status !== 'connected') {
      throw new Error('enqueue_failed:instance_disconnected:instance_not_connected')
    }

    const { count: backlogCount, error: backlogCountError } = await svc
      .from('message_outbox')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', processo.user_id)
      .in('status', ['pending', 'retry', 'sending', 'accepted'])

    if (backlogCountError) {
      throw new Error(`enqueue_failed:error:${backlogCountError.message}`)
    }

    if ((backlogCount ?? 0) > OUTBOX_BACKLOG_LIMIT_PER_TENANT && OUTBOX_BACKLOG_BLOCK_ENQUEUE) {
      throw new Error('enqueue_failed:rate_limited:tenant_backlog_limit_exceeded')
    }

    const { data: allowedToken, error: tokenError } = await svc.rpc('consume_token', {
      p_tenant_id: processo.user_id,
      p_instance_id: connectedInstance.id,
      p_amount: 1,
    })

    if (tokenError) {
      throw new Error(`enqueue_failed:error:${tokenError.message}`)
    }

    if (!allowedToken) {
      throw new Error('enqueue_failed:rate_limited:tenant_instance_token_bucket_exhausted')
    }

    const payload = {
      kind: 'process_update',
      processoId: processo.id,
      processoNumero: processo.numero_cnj,
      destinationNumber: destination,
      messageText,
      instanceName: connectedInstance.instance_name,
      instanceId: connectedInstance.id,
      userId: processo.user_id,
    }

    const idempotencyKey = await buildIdempotencyKey({
      tenantId: processo.user_id,
      event: 'process_update',
      destination,
      reference: `movement:${event.id}:${contact.id}`,
    })

    const { data: enqueueRows, error: enqueueError } = await svc.rpc('enqueue_process_movement_notification', {
      p_tenant_id: processo.user_id,
      p_process_id: processo.id,
      p_movement_id: movementId,
      p_contact_id: contact.id,
      p_notified_at: now.toISOString(),
      p_aggregate_type: 'processo',
      p_aggregate_id: processo.id,
      p_idempotency_key: idempotencyKey,
      p_payload: payload,
      p_campaign_job_id: null,
    })

    if (enqueueError) {
      throw new Error(`enqueue_failed:error:${enqueueError.message}`)
    }

    const enqueueResult = Array.isArray(enqueueRows) ? enqueueRows[0] : enqueueRows
    const resolvedOutboxId = enqueueResult?.outbox_id ?? null

    if (!resolvedOutboxId) {
      throw new Error('enqueue_outbox_id_missing')
    }

    await enqueueOutboundLog(svc, processo.user_id, destination, messageText, 'PROCESS_STATUS')

    await svc
      .from('whatsapp_contacts')
      .update({ last_notification_sent_at: now.toISOString(), updated_at: now.toISOString() })
      .eq('id', contact.id)

  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  // deno-lint-ignore no-explicit-any
  const svc = createClient<any>(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const workerId = `${Deno.env.get('DENO_DEPLOYMENT_ID') ?? 'local'}:${req.headers.get('x-request-id') ?? crypto.randomUUID()}`

  const { data: events, error: claimError } = await svc.rpc('claim_domain_events', {
    p_worker_id: workerId,
    p_batch_size: BATCH_SIZE,
    p_lease_seconds: LEASE_SECONDS,
    p_event_types: ['PROCESS_MOVEMENT_DETECTED'],
  })

  if (claimError) {
    return new Response(JSON.stringify({ error: claimError.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  const processed: Array<Record<string, unknown>> = []

  for (const event of events ?? []) {
    const startedAt = Date.now()
    try {
      if (event.event_type === 'PROCESS_MOVEMENT_DETECTED') {
        await processMovementDetected(svc, event)
      }

      const { data: ok } = await svc.rpc('complete_domain_event', {
        p_event_id: event.id,
        p_worker_id: workerId,
        p_lease_version: event.lease_version,
      })

      await svc.rpc('record_worker_metric', {
        p_worker_name: 'process-domain-events',
        p_event_id: event.id,
        p_tenant_id: event.tenant_id,
        p_event_type: event.event_type,
        p_status: ok ? 'processed' : 'lease_lost',
        p_retries: Number(event.attempts ?? 0),
        p_processing_ms: Date.now() - startedAt,
      })

      processed.push({ id: event.id, status: ok ? 'processed' : 'lease_lost' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const attempts = Number(event.attempts ?? 1)
      const shouldDeadLetter = attempts >= MAX_ATTEMPTS

      if (shouldDeadLetter) {
        await svc.rpc('dead_letter_domain_event', {
          p_event_id: event.id,
          p_worker_id: workerId,
          p_lease_version: event.lease_version,
          p_error: message,
        })
      } else {
        await svc.rpc('reschedule_domain_event_retry', {
          p_event_id: event.id,
          p_worker_id: workerId,
          p_lease_version: event.lease_version,
          p_next_retry_at: new Date(Date.now() + backoffMs(attempts)).toISOString(),
          p_error: message,
        })
      }

      await svc.rpc('record_worker_metric', {
        p_worker_name: 'process-domain-events',
        p_event_id: event.id,
        p_tenant_id: event.tenant_id,
        p_event_type: event.event_type,
        p_status: shouldDeadLetter ? 'dead_letter' : 'retry',
        p_retries: attempts,
        p_processing_ms: Date.now() - startedAt,
        p_error_code: message.slice(0, 120),
      })

      processed.push({ id: event.id, status: shouldDeadLetter ? 'dead_letter' : 'retry' })
    }
  }

  return new Response(JSON.stringify({ workerId, claimed: events?.length ?? 0, processed }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
