import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { normalizePhone } from './services/evolution.ts'
import { logError, logInfo } from './services/logger.ts'
import { validateWebhookSignature } from './services/webhook-security.ts'

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

const DELIVERY_STATUS_MAP: Record<number, string> = {
  0: 'error', 1: 'pending', 2: 'sent', 3: 'delivered', 4: 'read', 5: 'played',
}

function extractMessageText(msg: any): string | null {
  const msgContent = msg?.message || {}
  return msgContent.conversation
    || msgContent.extendedTextMessage?.text
    || msgContent.imageMessage?.caption
    || msgContent.videoMessage?.caption
    || (msgContent.imageMessage ? '[imagem]' : null)
    || (msgContent.videoMessage ? '[vídeo]' : null)
    || (msgContent.audioMessage ? '[áudio]' : null)
    || (msgContent.documentMessage ? '[documento]' : null)
    || (msgContent.stickerMessage ? '[sticker]' : null)
    || null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const correlationId = req.headers.get('x-correlation-id') || req.headers.get('x-request-id') || crypto.randomUUID()
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  let body: Record<string, any> = {}
  let rawBody = ''

  try {
    rawBody = await req.text()
    body = JSON.parse(rawBody)

    const instanceName = body.instance || body.instance_id || body.data?.instance
    const event = body.event

    if (!instanceName || !event) {
      return jsonResponse({ ok: false, correlation_id: correlationId, error: 'invalid_payload' }, 400)
    }

    const webhookValidation = await validateWebhookSignature({ req, rawBody, supabase, instanceName })
    if (!webhookValidation.valid) {
      return jsonResponse({ ok: false, correlation_id: correlationId, error: 'unauthorized_webhook' }, 401)
    }

    if (webhookValidation.reason === 'hmac_skipped_no_headers') {
      logError('webhook_hmac_not_present', { instanceName, correlationId })
    }

    const { data: instance } = await supabase
      .from('whatsapp_instancias')
      .select('id, user_id, instance_name')
      .eq('instance_name', instanceName)
      .maybeSingle()

    if (!instance) return jsonResponse({ ok: true, correlation_id: correlationId })

    // Handle delivery status updates from Evolution API
    if (event === 'messages.update' || event === 'MESSAGES_UPDATE') {
      const items = Array.isArray(body.data) ? body.data : body.data ? [body.data] : []
      for (const item of items) {
        const msgId = item?.key?.id as string | undefined
        const statusNum = item?.update?.status as number | undefined
        if (!msgId || statusNum == null) continue
        const statusStr = DELIVERY_STATUS_MAP[statusNum] ?? null
        if (!statusStr) continue
        await supabase
          .from('whatsapp_mensagens')
          .update({ status_entrega: statusStr, updated_at: new Date().toISOString() })
          .eq('tenant_id', instance.user_id)
          .eq('message_id', msgId)
      }
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

    for (const item of payloadMessages) {
      if (!item?.key || item.key?.fromMe) continue

      const rawJid = item.key.remoteJid
      if (!rawJid || rawJid === 'status@broadcast' || rawJid.includes('@g.us')) continue

      const providerMessageId = item.key.id as string | undefined
      if (!providerMessageId) continue

      const incomingText = extractMessageText(item)
      if (!incomingText) continue

      const phone = normalizePhone(rawJid)

      const { data: inbound, error: inboundError } = await supabase
        .from('inbound_messages')
        .upsert({
          tenant_id: instance.user_id,
          instance_id: instance.id,
          provider_message_id: providerMessageId,
          phone,
          payload_raw: item,
        }, { onConflict: 'tenant_id,instance_id,provider_message_id', ignoreDuplicates: false })
        .select('id')
        .maybeSingle()

      if (inboundError) {
        logError('inbound_persist_failed', { correlation_id: correlationId, tenant_id: instance.user_id, error: inboundError.message })
        continue
      }

      await supabase.from('domain_events').upsert({
        tenant_id: instance.user_id,
        event_type: 'WHATSAPP_MESSAGE_RECEIVED',
        dedupe_key: `${instance.id}:${providerMessageId}`,
        payload: {
          inbound_message_id: inbound?.id,
          instance_id: instance.id,
          instance_name: instance.instance_name,
          provider_message_id: providerMessageId,
          phone,
          message_preview: incomingText.slice(0, 80),
        },
      }, { onConflict: 'tenant_id,event_type,dedupe_key', ignoreDuplicates: true })

      logInfo('whatsapp_inbound_event_enqueued', {
        correlation_id: correlationId,
        tenant_id: instance.user_id,
        instance_id: instance.id,
        telefone: phone,
      })
    }

    return jsonResponse({ ok: true, correlation_id: correlationId })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logError('webhook_whatsapp_failed', { correlation_id: correlationId, error: message })
    return jsonResponse({ ok: false, correlation_id: correlationId, error: 'internal_webhook_error' }, 500)
  }
})
