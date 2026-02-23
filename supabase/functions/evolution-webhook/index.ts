import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-request-id, x-correlation-id, x-webhook-signature, x-webhook-timestamp, x-webhook-nonce',
}

const SIGNATURE_DRIFT_SECONDS = 300
const NONCE_TTL_SECONDS = 600

async function persistWebhookFailure(input: {
  svc: ReturnType<typeof createClient>
  source: string
  correlationId: string
  eventName?: string
  instanceName?: string
  tenantId?: string | null
  httpStatus: number
  errorMessage: string
  payload?: unknown
}) {
  await input.svc.from('webhook_failures').insert({
    tenant_id: input.tenantId ?? null,
    instance_name: input.instanceName ?? null,
    webhook_source: input.source,
    event_name: input.eventName ?? null,
    correlation_id: input.correlationId,
    http_status: input.httpStatus,
    error_message: input.errorMessage,
    payload: input.payload ?? null,
  })
}

function readProviderMessageId(payload: Record<string, any>): string | null {
  return payload?.provider_message_id
    ?? payload?.data?.provider_message_id
    ?? payload?.data?.key?.id
    ?? payload?.data?.id
    ?? payload?.key?.id
    ?? payload?.id
    ?? null
}

function readTenantId(payload: Record<string, any>): string | null {
  return payload?.tenant_id
    ?? payload?.tenantId
    ?? payload?.data?.tenant_id
    ?? payload?.data?.tenantId
    ?? payload?.metadata?.tenant_id
    ?? payload?.metadata?.tenantId
    ?? null
}

function readInstanceId(payload: Record<string, any>): string | null {
  return payload?.instance_id
    ?? payload?.instanceId
    ?? payload?.data?.instance_id
    ?? payload?.data?.instanceId
    ?? payload?.instance
    ?? payload?.data?.instance
    ?? payload?.metadata?.instance_id
    ?? payload?.metadata?.instanceId
    ?? null
}

function isDeliveryEvent(payload: Record<string, any>): boolean {
  const event = String(payload?.event ?? payload?.type ?? '').toLowerCase()
  return event.includes('delivery') || event.includes('delivered') || event.includes('message.update')
}

function parseTimestamp(raw: string | null): number | null {
  if (!raw) return null
  const timestamp = Number(raw)
  if (!Number.isFinite(timestamp)) return null
  return timestamp
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return toHex(digest)
}

async function computeHmacSha256(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  return toHex(signature)
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}

async function reserveReplayNonce(svc: ReturnType<typeof createClient>, nonce: string): Promise<boolean> {
  const nonceHash = await sha256Hex(nonce)
  const expiresAt = new Date(Date.now() + NONCE_TTL_SECONDS * 1000).toISOString()

  const { error } = await svc
    .from('webhook_replay_guard')
    .insert({
      nonce_hash: nonceHash,
      timestamp_seconds: Math.floor(Date.now() / 1000),
      expires_at: expiresAt,
    })

  return !error
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const correlationId = req.headers.get('x-correlation-id') || req.headers.get('x-request-id') || crypto.randomUUID()
  const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const rawBody = await req.text()
  const payload = (() => {
    try {
      return JSON.parse(rawBody || '{}') as Record<string, any>
    } catch {
      return {} as Record<string, any>
    }
  })()

  if (!isDeliveryEvent(payload)) {
    return new Response(JSON.stringify({ ok: true, ignored: true, correlation_id: correlationId }), {
      status: 202,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const providerMessageId = readProviderMessageId(payload)
  const tenantId = readTenantId(payload)
  const instanceId = readInstanceId(payload)

  if (!providerMessageId || !tenantId || !instanceId) {
    await persistWebhookFailure({
      svc,
      source: 'evolution-webhook',
      correlationId,
      tenantId,
      eventName: String(payload?.event ?? payload?.type ?? 'unknown'),
      instanceName: payload?.instance || payload?.data?.instance,
      httpStatus: 400,
      errorMessage: 'missing_cross_validation_fields',
      payload,
    })

    return new Response(JSON.stringify({
      ok: false,
      correlation_id: correlationId,
      error: 'missing_cross_validation_fields',
      required_fields: ['provider_message_id', 'tenant_id', 'instance_id'],
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const webhookSecret = Deno.env.get('EVOLUTION_WEBHOOK_HMAC_SECRET') ?? Deno.env.get('WEBHOOK_HMAC_SECRET')
  if (!webhookSecret) {
    await persistWebhookFailure({
      svc,
      source: 'evolution-webhook',
      correlationId,
      tenantId,
      eventName: String(payload?.event ?? payload?.type ?? 'unknown'),
      instanceName: instanceId,
      httpStatus: 500,
      errorMessage: 'webhook_secret_not_configured',
      payload,
    })

    return new Response(JSON.stringify({ ok: false, correlation_id: correlationId, error: 'webhook_secret_not_configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const timestamp = parseTimestamp(req.headers.get('x-webhook-timestamp'))
  const nonce = req.headers.get('x-webhook-nonce')
  const incomingSignature = req.headers.get('x-webhook-signature')

  if (!timestamp || !nonce || !incomingSignature) {
    await persistWebhookFailure({
      svc,
      source: 'evolution-webhook',
      correlationId,
      tenantId,
      eventName: String(payload?.event ?? payload?.type ?? 'unknown'),
      instanceName: instanceId,
      httpStatus: 401,
      errorMessage: 'missing_hmac_headers',
      payload,
    })

    return new Response(JSON.stringify({ ok: false, correlation_id: correlationId, error: 'missing_hmac_headers' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const nowSeconds = Math.floor(Date.now() / 1000)
  if (Math.abs(nowSeconds - timestamp) > SIGNATURE_DRIFT_SECONDS) {
    await persistWebhookFailure({
      svc,
      source: 'evolution-webhook',
      correlationId,
      tenantId,
      eventName: String(payload?.event ?? payload?.type ?? 'unknown'),
      instanceName: instanceId,
      httpStatus: 401,
      errorMessage: 'timestamp_out_of_range',
      payload,
    })

    return new Response(JSON.stringify({ ok: false, correlation_id: correlationId, error: 'timestamp_out_of_range' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const signedPayload = `${timestamp}.${nonce}.${instanceId}.${rawBody}`
  const expectedSignature = await computeHmacSha256(webhookSecret, signedPayload)

  if (!timingSafeEqual(expectedSignature, incomingSignature)) {
    await persistWebhookFailure({
      svc,
      source: 'evolution-webhook',
      correlationId,
      tenantId,
      eventName: String(payload?.event ?? payload?.type ?? 'unknown'),
      instanceName: instanceId,
      httpStatus: 401,
      errorMessage: 'invalid_signature',
      payload,
    })

    return new Response(JSON.stringify({ ok: false, correlation_id: correlationId, error: 'invalid_signature' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const nonceReserved = await reserveReplayNonce(svc, `${tenantId}:${instanceId}:${nonce}`)
  if (!nonceReserved) {
    await persistWebhookFailure({
      svc,
      source: 'evolution-webhook',
      correlationId,
      tenantId,
      eventName: String(payload?.event ?? payload?.type ?? 'unknown'),
      instanceName: instanceId,
      httpStatus: 409,
      errorMessage: 'replay_detected',
      payload,
    })

    return new Response(JSON.stringify({ ok: false, correlation_id: correlationId, error: 'replay_detected' }), {
      status: 409,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const { data: outboxMatch, error: crossValidationError } = await svc
    .from('message_outbox')
    .select('id')
    .eq('provider_message_id', providerMessageId)
    .eq('tenant_id', tenantId)
    .eq('status', 'accepted')
    .or(`aggregate_id.eq.${instanceId},payload->>instanceId.eq.${instanceId}`)
    .maybeSingle()

  if (crossValidationError || !outboxMatch) {
    await persistWebhookFailure({
      svc,
      source: 'evolution-webhook',
      correlationId,
      tenantId,
      eventName: String(payload?.event ?? payload?.type ?? 'unknown'),
      instanceName: instanceId,
      httpStatus: 404,
      errorMessage: crossValidationError?.message ?? 'cross_validation_failed',
      payload,
    })

    return new Response(JSON.stringify({ ok: false, correlation_id: correlationId, error: 'cross_validation_failed' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const { data, error } = await svc.rpc('mark_outbox_delivered', {
    p_tenant_id: tenantId,
    p_instance_id: instanceId,
    p_provider_message_id: providerMessageId,
    p_provider_response: payload,
  })

  if (error) {
    await persistWebhookFailure({
      svc,
      source: 'evolution-webhook',
      correlationId,
      tenantId,
      eventName: String(payload?.event ?? payload?.type ?? 'unknown'),
      instanceName: instanceId,
      httpStatus: 500,
      errorMessage: error.message,
      payload,
    })
    return new Response(JSON.stringify({ ok: false, correlation_id: correlationId, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({
    ok: true,
    updated: data ?? 0,
    provider_message_id: providerMessageId,
    tenant_id: tenantId,
    instance_id: instanceId,
    correlation_id: correlationId,
  }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
