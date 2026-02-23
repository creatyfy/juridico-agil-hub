import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-request-id, x-correlation-id',
}

async function persistWebhookFailure(input: {
  svc: ReturnType<typeof createClient>
  source: string
  correlationId: string
  eventName?: string
  instanceName?: string
  httpStatus: number
  errorMessage: string
  payload?: unknown
}) {
  await input.svc.from('webhook_failures').insert({
    tenant_id: null,
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
  return payload?.data?.key?.id
    ?? payload?.data?.id
    ?? payload?.key?.id
    ?? payload?.id
    ?? null
}

function isDeliveryEvent(payload: Record<string, any>): boolean {
  const event = String(payload?.event ?? payload?.type ?? '').toLowerCase()
  return event.includes('delivery') || event.includes('delivered') || event.includes('message.update')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const correlationId = req.headers.get('x-correlation-id') || req.headers.get('x-request-id') || crypto.randomUUID()
  const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const payload = await req.json().catch(() => ({})) as Record<string, any>

  if (!isDeliveryEvent(payload)) {
    return new Response(JSON.stringify({ ok: true, ignored: true, correlation_id: correlationId }), {
      status: 202,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const providerMessageId = readProviderMessageId(payload)
  if (!providerMessageId) {
    await persistWebhookFailure({
      svc,
      source: 'evolution-webhook',
      correlationId,
      eventName: String(payload?.event ?? payload?.type ?? 'unknown'),
      instanceName: payload?.instance || payload?.data?.instance,
      httpStatus: 400,
      errorMessage: 'missing_provider_message_id',
      payload,
    })
    return new Response(JSON.stringify({ ok: false, correlation_id: correlationId, error: 'missing_provider_message_id' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const { data, error } = await svc.rpc('mark_outbox_delivered', {
    p_provider_message_id: providerMessageId,
    p_provider_response: payload,
  })

  if (error) {
    await persistWebhookFailure({
      svc,
      source: 'evolution-webhook',
      correlationId,
      eventName: String(payload?.event ?? payload?.type ?? 'unknown'),
      instanceName: payload?.instance || payload?.data?.instance,
      httpStatus: 500,
      errorMessage: error.message,
      payload,
    })
    return new Response(JSON.stringify({ ok: false, correlation_id: correlationId, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ ok: true, updated: data ?? 0, provider_message_id: providerMessageId, correlation_id: correlationId }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
