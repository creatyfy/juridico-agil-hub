import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { normalizePhone } from './services/evolution.ts'
import { unifiedErrorResponse } from './services/messages.ts'
import { logError, logInfo } from './services/logger.ts'
import { validateWebhookSignature } from './services/webhook-security.ts'

type InboundRpcResult = {
  inbound_message_id: string
  queue_id: string
  inserted: boolean
  queue_status: string
}

async function persistWebhookFailure(input: {
  supabase: ReturnType<typeof createClient>
  tenantId?: string
  instanceName?: string
  source: string
  eventName?: string
  correlationId: string
  httpStatus: number
  errorMessage: string
  errorStack?: string
}) {
  const { error } = await input.supabase.from('webhook_failures').insert({
    tenant_id: input.tenantId ?? null,
    instance_name: input.instanceName ?? null,
    webhook_source: input.source,
    event_name: input.eventName ?? null,
    correlation_id: input.correlationId,
    http_status: input.httpStatus,
    error_message: input.errorMessage,
    error_stack: input.errorStack ?? null,
    payload: {
      redacted: true,
      reason: 'lgpd_minimal_retention',
    },
  })

  if (error) {
    logError('webhook_failure_persist_failed', { correlation_id: input.correlationId, error: error.message })
  }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id, x-correlation-id, x-webhook-signature, x-webhook-timestamp, x-webhook-nonce',
}

function jsonResponse(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function extractMessageText(msg: any): string | null {
  const msgContent = msg?.message || {}
  return msgContent.conversation
    || msgContent.extendedTextMessage?.text
    || msgContent.imageMessage?.caption
    || msgContent.videoMessage?.caption
    || null
}

function extractProviderMessageId(item: any): string | null {
  return item?.key?.id ?? item?.messageId ?? item?.id ?? null
}

function buildSafePayload(item: any): Record<string, unknown> {
  return {
    key: {
      id: item?.key?.id ?? null,
      remoteJid: item?.key?.remoteJid ?? null,
      fromMe: Boolean(item?.key?.fromMe),
    },
    messageTimestamp: item?.messageTimestamp ?? null,
    pushName: item?.pushName ? '[REDACTED]' : null,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const correlationId = req.headers.get('x-correlation-id') || req.headers.get('x-request-id') || crypto.randomUUID()

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  let body: Record<string, any> = {}
  let rawBody = ''

  try {
    rawBody = await req.text()
    body = JSON.parse(rawBody)

    const instanceName = body.instance || body.instance_id || body.data?.instance
    const event = body.event

    if (!instanceName || !event) {
      await persistWebhookFailure({
        supabase,
        source: 'webhook-whatsapp',
        eventName: event,
        instanceName,
        correlationId,
        httpStatus: 400,
        errorMessage: 'invalid_payload',
      })
      return jsonResponse({ ok: false, correlation_id: correlationId, error: 'invalid_payload' }, 400)
    }

    const webhookValidation = await validateWebhookSignature({ req, rawBody, supabase, instanceName })
    if (!webhookValidation.valid) {
      logInfo('webhook_rejected', { correlation_id: correlationId, instance_name: instanceName, reason: webhookValidation.reason })
      const unauthorized = unifiedErrorResponse(correlationId, 'unauthorized_webhook', 401)
      const unauthorizedPayload = await unauthorized.text()
      return new Response(unauthorizedPayload, { status: unauthorized.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const { data: instance } = await supabase
      .from('whatsapp_instancias')
      .select('id, user_id, instance_name')
      .eq('instance_name', instanceName)
      .maybeSingle()

    if (!instance) {
      logInfo('unknown_instance', { correlation_id: correlationId, instance_name: instanceName })
      return jsonResponse({ ok: true, correlation_id: correlationId })
    }

    if (event !== 'messages.upsert' && event !== 'MESSAGES_UPSERT') {
      return jsonResponse({ ok: true, correlation_id: correlationId })
    }

    const payloadMessages = Array.isArray(body.data)
      ? body.data
      : Array.isArray(body.data?.messages)
        ? body.data.messages
        : body.data?.key
          ? [body.data]
          : []

    let enqueuedCount = 0
    let duplicateCount = 0

    for (const item of payloadMessages) {
      if (!item?.key || item.key?.fromMe) continue

      const incomingText = extractMessageText(item)?.trim()
      if (!incomingText) continue

      const providerMessageId = extractProviderMessageId(item)
      if (!providerMessageId) continue

      const rawJid = item.key.remoteJid
      if (!rawJid || rawJid === 'status@broadcast' || rawJid.includes('@g.us')) continue

      const phone = normalizePhone(rawJid)

      const { data, error } = await supabase.rpc('enqueue_inbound_message', {
        p_tenant_id: instance.user_id,
        p_instance_id: instance.id,
        p_instance_name: instance.instance_name,
        p_provider_message_id: providerMessageId,
        p_phone: phone,
        p_message: incomingText,
        p_payload: buildSafePayload(item),
      })

      if (error) {
        logError('inbound_enqueue_failed', {
          correlation_id: correlationId,
          tenant_id: instance.user_id,
          instance_id: instance.id,
          provider_message_id: providerMessageId,
          error: error.message,
        })
        continue
      }

      const result = (data?.[0] ?? null) as InboundRpcResult | null
      if (!result) continue

      if (result.inserted) {
        enqueuedCount += 1
      } else {
        duplicateCount += 1
      }
    }

    logInfo('inbound_persisted_and_queued', {
      correlation_id: correlationId,
      tenant_id: instance.user_id,
      instance_id: instance.id,
      enqueued_count: enqueuedCount,
      duplicate_count: duplicateCount,
    })

    return jsonResponse({ ok: true, correlation_id: correlationId, enqueued: enqueuedCount, duplicates: duplicateCount })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const stack = error instanceof Error ? error.stack : undefined

    await persistWebhookFailure({
      supabase,
      source: 'webhook-whatsapp',
      eventName: body?.event,
      instanceName: body?.instance || body?.instance_id || body?.data?.instance,
      correlationId,
      httpStatus: 500,
      errorMessage: message,
      errorStack: stack,
    })

    logError('webhook_whatsapp_failed', {
      correlation_id: correlationId,
      error: message,
    })

    return jsonResponse({ ok: false, correlation_id: correlationId, error: 'internal_webhook_error' }, 500)
  }
})
