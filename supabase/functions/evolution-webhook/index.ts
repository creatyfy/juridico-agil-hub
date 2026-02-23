import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
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

  const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const payload = await req.json().catch(() => ({})) as Record<string, any>

  if (!isDeliveryEvent(payload)) {
    return new Response(JSON.stringify({ ok: true, ignored: true }), {
      status: 202,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const providerMessageId = readProviderMessageId(payload)
  if (!providerMessageId) {
    return new Response(JSON.stringify({ ok: false, error: 'missing_provider_message_id' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const { data, error } = await svc.rpc('mark_outbox_delivered', {
    p_provider_message_id: providerMessageId,
    p_provider_response: payload,
  })

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ ok: true, updated: data ?? 0, provider_message_id: providerMessageId }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
