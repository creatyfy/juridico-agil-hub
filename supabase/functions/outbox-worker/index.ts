import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { computeBackoffWithJitterMs, maskSensitive, type OutboxPayload } from '../_shared/outbox.ts'
import { decideOutboxOutcome } from '../_shared/outbox-worker-logic.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const EVOLUTION_API_URL = Deno.env.get('EVOLUTION_API_URL')!
const EVOLUTION_API_KEY = Deno.env.get('EVOLUTION_API_KEY')!
const MAX_ATTEMPTS = Number(Deno.env.get('OUTBOX_MAX_ATTEMPTS') ?? '8')
const BATCH_SIZE = Number(Deno.env.get('OUTBOX_BATCH_SIZE') ?? '20')
const LEASE_SECONDS = Number(Deno.env.get('OUTBOX_LEASE_SECONDS') ?? '45')
const REAPER_LIMIT = Number(Deno.env.get('OUTBOX_REAPER_LIMIT') ?? '200')
const REQUEST_TIMEOUT_MS = Number(Deno.env.get('OUTBOX_PROVIDER_TIMEOUT_MS') ?? '10000')

const TENANT_BUCKET_CAPACITY = Number(Deno.env.get('TENANT_BUCKET_CAPACITY') ?? '30')
const TENANT_BUCKET_REFILL_PER_SECOND = Number(Deno.env.get('TENANT_BUCKET_REFILL_PER_SECOND') ?? '1')
const INSTANCE_BUCKET_CAPACITY = Number(Deno.env.get('INSTANCE_BUCKET_CAPACITY') ?? '10')
const INSTANCE_BUCKET_REFILL_PER_SECOND = Number(Deno.env.get('INSTANCE_BUCKET_REFILL_PER_SECOND') ?? '0.5')

function buildWorkerId(req: Request): string {
  const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID()
  return `${Deno.env.get('DENO_DEPLOYMENT_ID') ?? 'local'}:${requestId}`
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort('timeout'), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const workerId = buildWorkerId(req)

  await svc.rpc('reap_orphaned_outbox_messages', { p_limit: REAPER_LIMIT, p_retry_delay_seconds: 5 })

  const { data: rows, error: claimError } = await svc.rpc('claim_message_outbox_with_lease', {
    p_batch_size: BATCH_SIZE,
    p_worker_id: workerId,
    p_lease_seconds: LEASE_SECONDS,
    p_tenant_capacity: TENANT_BUCKET_CAPACITY,
    p_tenant_refill_per_second: TENANT_BUCKET_REFILL_PER_SECOND,
    p_instance_capacity: INSTANCE_BUCKET_CAPACITY,
    p_instance_refill_per_second: INSTANCE_BUCKET_REFILL_PER_SECOND,
  })

  if (claimError) {
    return new Response(JSON.stringify({ error: claimError.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  const processed: Array<Record<string, unknown>> = []

  for (const row of rows ?? []) {
    const payload = row.payload as OutboxPayload

    const { data: attemptRegistered } = await svc.rpc('register_outbox_attempt', {
      p_outbox_id: row.id,
      p_lease_version: row.lease_version,
    })

    if (!attemptRegistered) {
      processed.push({ id: row.id, status: 'lease_not_confirmed' })
      continue
    }

    try {
      const response = await fetchWithTimeout(`${EVOLUTION_API_URL}/message/sendText/${payload.instanceName}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': EVOLUTION_API_KEY,
        },
        body: JSON.stringify({ number: payload.destinationNumber, text: payload.messageText }),
      }, REQUEST_TIMEOUT_MS)

      const evoData = await response.json().catch(() => ({}))
      const decision = decideOutboxOutcome({
        attempts: row.attempts,
        maxAttempts: MAX_ATTEMPTS,
        httpStatus: response.status,
      })

      if (decision.action === 'retry') {
        const ok = await svc.rpc('reschedule_outbox_retry', {
          p_id: row.id,
          p_worker_id: workerId,
          p_lease_version: row.lease_version,
          p_next_retry_at: new Date(Date.now() + decision.delayMs).toISOString(),
          p_error: decision.reason,
        })
        if (ok.data && row.campaign_job_id) { await svc.from('campaign_recipients').update({ status: 'failed', last_error: decision.reason }).eq('outbox_id', row.id).eq('status', 'queued') }
        processed.push({ id: row.id, status: ok.data ? 'retry' : 'lease_lost_retry' })
        continue
      }

      if (decision.action === 'dead_letter') {
        const ok = await svc.rpc('move_outbox_dead_letter', {
          p_id: row.id,
          p_worker_id: workerId,
          p_lease_version: row.lease_version,
          p_error: decision.reason,
        })
        if (ok.data && row.campaign_job_id) { await svc.from('campaign_recipients').update({ status: 'failed', last_error: decision.reason }).eq('outbox_id', row.id).eq('status', 'queued') }
        processed.push({ id: row.id, status: ok.data ? 'dead_letter' : 'lease_lost_dead_letter' })
        continue
      }

      const remoteJid = `${payload.destinationNumber}@s.whatsapp.net`
      const providerMessageId = evoData?.key?.id || evoData?.message?.id || crypto.randomUUID()

      const accepted = await svc.rpc('complete_outbox_accepted', {
        p_id: row.id,
        p_worker_id: workerId,
        p_lease_version: row.lease_version,
        p_provider_message_id: providerMessageId,
        p_provider_response: evoData,
      })

      if (accepted.data) {
        await svc.from('whatsapp_mensagens').insert({
          instancia_id: payload.instanceId,
          remote_jid: remoteJid,
          direcao: 'out',
          conteudo: payload.messageText,
          tipo: 'text',
          message_id: providerMessageId,
        })

        await svc.from('whatsapp_chats_cache').upsert({
          instancia_id: payload.instanceId,
          remote_jid: remoteJid,
          ultima_mensagem: payload.messageText.substring(0, 100),
          ultimo_timestamp: new Date().toISOString(),
          direcao: 'out',
        }, { onConflict: 'instancia_id,remote_jid', ignoreDuplicates: false })
      }

      if (accepted.data && row.campaign_job_id) {
        await svc.from('campaign_recipients').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('outbox_id', row.id).eq('status', 'queued')
      }

      processed.push({
        id: row.id,
        status: accepted.data ? 'accepted' : 'lease_lost_accepted',
        to: maskSensitive(payload.destinationNumber),
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const timedOut = message.includes('timeout') || message.includes('aborted')
      const decision = decideOutboxOutcome({
        attempts: Number(row.attempts ?? 1),
        maxAttempts: MAX_ATTEMPTS,
        timedOut,
        httpStatus: timedOut ? undefined : 500,
      })

      if (decision.action === 'retry') {
        await svc.rpc('reschedule_outbox_retry', {
          p_id: row.id,
          p_worker_id: workerId,
          p_next_retry_at: new Date(Date.now() + computeBackoffWithJitterMs(Number(row.attempts ?? 1))).toISOString(),
          p_lease_version: row.lease_version,
          p_error: decision.reason,
        })
        processed.push({ id: row.id, status: 'retry_exception' })
        continue
      }

      await svc.rpc('move_outbox_dead_letter', {
        p_id: row.id,
        p_worker_id: workerId,
        p_lease_version: row.lease_version,
        p_error: 'reason' in decision ? decision.reason : 'unknown',
      })
      processed.push({ id: row.id, status: 'dead_letter_exception' })
    }
  }


  const { data: metricsRows, error: metricsError } = await svc
    .from('v_whatsapp_operational_metrics')
    .select('tenant_id,success_rate_percent,retry_rate_percent,dead_letter_rate_percent,backlog_count,avg_backlog_age_seconds')

  if (metricsError) {
    console.error(JSON.stringify({
      level: 'error',
      event: 'outbox_metrics_query_failed',
      workerId,
      error: metricsError.message,
    }))
  } else {
    for (const metric of metricsRows ?? []) {
      console.log(JSON.stringify({
        level: 'info',
        event: 'outbox_operational_metrics',
        workerId,
        ...metric,
      }))
    }
  }

  return new Response(JSON.stringify({ processed, claimed: rows?.length ?? 0, workerId }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
