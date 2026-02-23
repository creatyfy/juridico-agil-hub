import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleAuthenticationFlow, isPhoneVerified } from './services/auth.ts'
import { normalizePhone } from './services/evolution.ts'
import { unifiedErrorResponse } from './services/messages.ts'
import { logError, logInfo } from './services/logger.ts'
import { handleIncomingMessage } from './services/orchestrator.ts'
import type { RequestContext } from './services/types.ts'
import { validateWebhookSignature } from './services/webhook-security.ts'

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
  payload?: unknown
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
    payload: input.payload ?? null,
  })

  if (error) {
    logError('webhook_failure_persist_failed', { correlation_id: input.correlationId, error: error.message })
  }
}


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
        payload: body,
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

    for (const item of payloadMessages) {
      if (!item?.key || item.key?.fromMe) continue

      const incomingText = extractMessageText(item)
      if (!incomingText) continue

      const rawJid = item.key.remoteJid
      if (!rawJid || rawJid === 'status@broadcast' || rawJid.includes('@g.us')) continue

      const phone = normalizePhone(rawJid)
      const ctx: RequestContext = {
        requestId: correlationId,
        supabase,
        tenantId: instance.user_id,
        instanceName: instance.instance_name,
        instanceId: instance.id,
        phone,
        message: incomingText.trim(),
      }

      logInfo('incoming_message', {
        correlation_id: correlationId,
        tenant_id: ctx.tenantId,
        instance_id: ctx.instanceId,
        telefone: phone,
      })

      const canProceed = await enforceRateLimit(ctx)
      if (!canProceed) {
        logInfo('rate_limit_hit', { correlation_id: correlationId, tenant_id: ctx.tenantId, telefone: phone })
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
        logError('verified_without_client', { correlation_id: correlationId, tenant_id: ctx.tenantId, telefone: phone })
        continue
      }

      await handleIncomingMessage({ ...ctx, clienteId: verified.clienteId })
    }

    return jsonResponse({ ok: true, correlation_id: correlationId })
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
      payload: body,
    })

    logError('webhook_whatsapp_failed', {
      correlation_id: correlationId,
      error: message,
    })

    return jsonResponse({ ok: false, correlation_id: correlationId, error: 'internal_webhook_error' }, 500)
  }
})
