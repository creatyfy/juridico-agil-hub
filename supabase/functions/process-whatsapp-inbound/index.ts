import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

// deno-lint-ignore no-explicit-any
type AnySupabase = SupabaseClient<any, any, any>
import { handleAuthenticationFlow, isPhoneVerified, tryActivateNotificationsOptIn } from '../webhook-whatsapp/services/auth.ts'
import { handleIncomingMessage } from '../webhook-whatsapp/services/orchestrator.ts'
import type { RequestContext } from '../webhook-whatsapp/services/types.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
}

const BATCH_SIZE = Number(Deno.env.get('WHATSAPP_INBOUND_BATCH_SIZE') ?? '20')
const LEASE_SECONDS = Number(Deno.env.get('WHATSAPP_INBOUND_LEASE_SECONDS') ?? '45')
const CONVERSATION_LOCK_SECONDS = Number(Deno.env.get('WHATSAPP_CONVERSATION_LOCK_SECONDS') ?? '120')
const MAX_ATTEMPTS = Number(Deno.env.get('WHATSAPP_INBOUND_MAX_ATTEMPTS') ?? '8')

function backoffMs(attempts: number): number {
  const capped = Math.max(attempts, 1)
  return Math.min(300_000, 2_000 * 2 ** (capped - 1))
}

function extractMessageText(msg: any): string | null {
  const msgContent = msg?.message || {}
  return msgContent.conversation
    || msgContent.extendedTextMessage?.text
    || msgContent.imageMessage?.caption
    || msgContent.videoMessage?.caption
    || null
}

async function processInboundEvent(svc: AnySupabase, workerId: string, event: any): Promise<void> {
  const payload = event.payload ?? {}
  const inboundMessageId = payload.inbound_message_id as string | undefined
  const tenantId = event.tenant_id as string
  const phone = payload.phone as string

  if (!inboundMessageId || !tenantId || !phone) throw new Error('invalid_whatsapp_event_payload')

  const { data: inbound } = await svc
    .from('inbound_messages')
    .select('id, instance_id, phone, payload_raw')
    .eq('id', inboundMessageId)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  if (!inbound) throw new Error('inbound_message_not_found')

  const lockTokenResult = await svc.rpc('acquire_conversation_lock', {
    p_tenant_id: tenantId,
    p_phone: phone,
    p_worker_id: workerId,
    p_lease_seconds: CONVERSATION_LOCK_SECONDS,
  })

  const fenceToken = lockTokenResult.data as number | null
  if (!fenceToken) throw new Error('conversation_lock_busy')

  try {
    const { data: instance } = await svc
      .from('whatsapp_instancias')
      .select('id, instance_name')
      .eq('id', inbound.instance_id)
      .eq('user_id', tenantId)
      .maybeSingle()

    if (!instance) throw new Error('instance_not_found')

    const message = extractMessageText(inbound.payload_raw)
    if (!message) return

    const ctx: RequestContext = {
      requestId: event.id,
      supabase: svc,
      tenantId,
      instanceName: instance.instance_name,
      instanceId: instance.id,
      phone: inbound.phone,
      message: message.trim(),
    }

    const verified = await isPhoneVerified(ctx)
    if (!verified.verified) {
      const authResult = await handleAuthenticationFlow(ctx)
      if (!authResult.authenticated || !authResult.clienteId) return
      await handleIncomingMessage({ ...ctx, clienteId: authResult.clienteId })
      return
    }

    const optInEnabled = await tryActivateNotificationsOptIn(ctx)
    if (optInEnabled) return

    if (!verified.clienteId) throw new Error('verified_without_cliente')
    await handleIncomingMessage({ ...ctx, clienteId: verified.clienteId })
  } finally {
    await svc.rpc('release_conversation_lock', {
      p_tenant_id: tenantId,
      p_phone: phone,
      p_worker_id: workerId,
      p_fence_token: fenceToken,
    })
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const svc: AnySupabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const workerId = `${Deno.env.get('DENO_DEPLOYMENT_ID') ?? 'local'}:${req.headers.get('x-request-id') ?? crypto.randomUUID()}`

  const { data: events, error: claimError } = await svc.rpc('claim_domain_events', {
    p_worker_id: workerId,
    p_batch_size: BATCH_SIZE,
    p_lease_seconds: LEASE_SECONDS,
    p_event_types: ['WHATSAPP_MESSAGE_RECEIVED'],
  })

  if (claimError) {
    return new Response(JSON.stringify({ error: claimError.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  const processed: Array<Record<string, unknown>> = []

  for (const event of events ?? []) {
    const startedAt = Date.now()
    try {
      await processInboundEvent(svc, workerId, event)

      const { data: done } = await svc.rpc('complete_domain_event', {
        p_event_id: event.id,
        p_worker_id: workerId,
        p_lease_version: event.lease_version,
      })

      await svc.rpc('record_worker_metric', {
        p_worker_name: 'process-whatsapp-inbound',
        p_event_id: event.id,
        p_tenant_id: event.tenant_id,
        p_event_type: event.event_type,
        p_status: done ? 'processed' : 'lease_lost',
        p_retries: Number(event.attempts ?? 0),
        p_processing_ms: Date.now() - startedAt,
      })

      processed.push({ id: event.id, status: done ? 'processed' : 'lease_lost' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const attempts = Number(event.attempts ?? 1)

      if (attempts >= MAX_ATTEMPTS) {
        await svc.rpc('dead_letter_domain_event', {
          p_event_id: event.id,
          p_worker_id: workerId,
          p_lease_version: event.lease_version,
          p_error: message,
        })

        await svc.rpc('record_worker_metric', {
          p_worker_name: 'process-whatsapp-inbound',
          p_event_id: event.id,
          p_tenant_id: event.tenant_id,
          p_event_type: event.event_type,
          p_status: 'dead_letter',
          p_retries: attempts,
          p_processing_ms: Date.now() - startedAt,
          p_error_code: message.slice(0, 120),
        })

        processed.push({ id: event.id, status: 'dead_letter' })
        continue
      }

      await svc.rpc('reschedule_domain_event_retry', {
        p_event_id: event.id,
        p_worker_id: workerId,
        p_lease_version: event.lease_version,
        p_next_retry_at: new Date(Date.now() + backoffMs(attempts)).toISOString(),
        p_error: message,
      })

      await svc.rpc('record_worker_metric', {
        p_worker_name: 'process-whatsapp-inbound',
        p_event_id: event.id,
        p_tenant_id: event.tenant_id,
        p_event_type: event.event_type,
        p_status: 'retry',
        p_retries: attempts,
        p_processing_ms: Date.now() - startedAt,
        p_error_code: message.slice(0, 120),
      })

      processed.push({ id: event.id, status: 'retry' })
    }
  }

  return new Response(JSON.stringify({ workerId, claimed: events?.length ?? 0, processed }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
