import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const svc = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // 1. Domain events stats
  const { data: eventStats, error: eventError } = await svc
    .from('domain_events')
    .select('id, status, last_error, attempts, event_type, created_at, tenant_id')
    .eq('event_type', 'WHATSAPP_MESSAGE_RECEIVED')
    .order('created_at', { ascending: false })
    .limit(10)

  // 2. Message outbox stats
  const { data: outboxStats, error: outboxError } = await svc
    .from('message_outbox')
    .select('id, status, payload, attempts, created_at, updated_at, dead_lettered_at, delivered_at')
    .order('created_at', { ascending: false })
    .limit(10)

  // 3. Whatsapp contacts state
  const { data: contactStats, error: contactError } = await svc
    .from('whatsapp_contacts')
    .select('id, tenant_id, phone_number, conversation_state, verified, notifications_opt_in, client_id, process_id, cpf_attempts, blocked_until')
    .order('updated_at', { ascending: false })
    .limit(10)

  // 4. Conversation logs
  const { data: convLogs, error: convError } = await svc
    .from('conversation_logs')
    .select('id, tenant_id, phone_number, direction, intent, created_at, message')
    .order('created_at', { ascending: false })
    .limit(10)

  // 5. Inbound messages
  const { data: inboundMsgs, error: inboundError } = await svc
    .from('inbound_messages')
    .select('id, tenant_id, phone, instance_id, created_at')
    .order('created_at', { ascending: false })
    .limit(5)

  // 6. Check app settings
  let appSettingsCheck = null
  try {
    const { data } = await svc.rpc('check_app_settings' as any)
    appSettingsCheck = data
  } catch {
    appSettingsCheck = 'rpc not available'
  }

  const result = {
    domain_events: { data: eventStats, error: eventError?.message ?? null },
    message_outbox: { data: outboxStats, error: outboxError?.message ?? null },
    whatsapp_contacts: { data: contactStats, error: contactError?.message ?? null },
    conversation_logs: { data: convLogs, error: convError?.message ?? null },
    inbound_messages: { data: inboundMsgs, error: inboundError?.message ?? null },
    app_settings: appSettingsCheck,
  }

  return new Response(JSON.stringify(result, null, 2), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
