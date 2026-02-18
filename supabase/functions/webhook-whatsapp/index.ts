import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleAuthenticationFlow, isPhoneVerified } from './services/auth.ts'
import { normalizePhone } from './services/evolution.ts'
import { unifiedErrorResponse } from './services/messages.ts'
import { logError, logInfo } from './services/logger.ts'
import { handleIncomingMessage } from './services/orchestrator.ts'
import type { RequestContext } from './services/types.ts'
import { validateWebhookSignature } from './services/webhook-security.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id, x-correlation-id, x-webhook-signature, x-webhook-timestamp, x-webhook-nonce',
}

const WINDOW_SECONDS = 60
const MAX_MESSAGES_PER_WINDOW = 20

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

async function enforceRateLimit(ctx: RequestContext): Promise<boolean> {
  const now = new Date()
  const windowStart = new Date(now.getTime() - WINDOW_SECONDS * 1000).toISOString()

  const { data } = await ctx.supabase
    .from('whatsapp_rate_limits')
    .select('id, counter, window_start')
    .eq('tenant_id', ctx.tenantId)
    .eq('telefone', ctx.phone)
    .maybeSingle()

  if (!data || new Date(data.window_start).getTime() < new Date(windowStart).getTime()) {
    await ctx.supabase.from('whatsapp_rate_limits').upsert({
      tenant_id: ctx.tenantId,
      telefone: ctx.phone,
      window_start: now.toISOString(),
      counter: 1,
    }, { onConflict: 'tenant_id,telefone', ignoreDuplicates: false })
    return true
  }

  if (data.counter >= MAX_MESSAGES_PER_WINDOW) return false

  await ctx.supabase.from('whatsapp_rate_limits').update({ counter: data.counter + 1 }).eq('id', data.id)
  return true
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const requestId = req.headers.get('x-request-id') || req.headers.get('x-correlation-id') || crypto.randomUUID()

  try {
    const rawBody = await req.text()
    const body = JSON.parse(rawBody)

    const instanceName = body.instance || body.instance_id || body.data?.instance
    const event = body.event

    if (!instanceName || !event) {
      return jsonResponse({ ok: false, request_id: requestId, error: 'invalid_payload' }, 400)
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const webhookValidation = await validateWebhookSignature({ req, rawBody, supabase, instanceName })
    if (!webhookValidation.valid) {
      logInfo('webhook_rejected', { request_id: requestId, instance_name: instanceName, reason: webhookValidation.reason })
      const unauthorized = unifiedErrorResponse(requestId, 'unauthorized_webhook', 401)
      const unauthorizedPayload = await unauthorized.text()
      return new Response(unauthorizedPayload, { status: unauthorized.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const { data: instance } = await supabase
      .from('whatsapp_instancias')
      .select('id, user_id, instance_name')
      .eq('instance_name', instanceName)
      .maybeSingle()

    if (!instance) {
      logInfo('unknown_instance', { request_id: requestId, instance_name: instanceName })
      return jsonResponse({ ok: true, request_id: requestId })
    }

    if (event !== 'messages.upsert' && event !== 'MESSAGES_UPSERT') {
      return jsonResponse({ ok: true, request_id: requestId })
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

      const incomingText = extractMessageText(item)
      if (!incomingText) continue

      const rawJid = item.key.remoteJid
      if (!rawJid || rawJid === 'status@broadcast' || rawJid.includes('@g.us')) continue

      const phone = normalizePhone(rawJid)
      const ctx: RequestContext = {
        requestId,
        supabase,
        tenantId: instance.user_id,
        instanceName: instance.instance_name,
        instanceId: instance.id,
        phone,
        message: incomingText.trim(),
      }

      logInfo('incoming_message', {
        request_id: requestId,
        tenant_id: ctx.tenantId,
        instance_id: ctx.instanceId,
        telefone: phone,
      })

      const canProceed = await enforceRateLimit(ctx)
      if (!canProceed) {
        logInfo('rate_limit_hit', { request_id: requestId, tenant_id: ctx.tenantId, telefone: phone })
        continue
      }

      const verified = await isPhoneVerified(ctx)
      if (!verified.verified) {
        const authResult = await handleAuthenticationFlow(ctx)
        if (!authResult.authenticated || !authResult.clienteId) continue

        await handleIncomingMessage({ ...ctx, clienteId: authResult.clienteId })
        continue
      }

      if (!verified.clienteId) {
        logError('verified_without_client', { request_id: requestId, tenant_id: ctx.tenantId, telefone: phone })
        continue
      }

      await handleIncomingMessage({ ...ctx, clienteId: verified.clienteId })
    }

    return jsonResponse({ ok: true, request_id: requestId })
  } catch (error) {
    logError('webhook_whatsapp_failed', {
      request_id: requestId,
      error: String(error),
    })

    return jsonResponse({ ok: true, request_id: requestId })
  }
})
