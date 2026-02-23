import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id, x-correlation-id',
}

const EVOLUTION_API_URL = Deno.env.get('EVOLUTION_API_URL')!
const EVOLUTION_API_KEY = Deno.env.get('EVOLUTION_API_KEY')!
const STALE_BACKLOG_HOURS = Number(Deno.env.get('OUTBOX_STALE_UNAVAILABLE_HOURS') ?? '6')
const RECONNECT_WHEN_UNAVAILABLE = String(Deno.env.get('WHATSAPP_HEALTH_RECONNECT') ?? 'false').toLowerCase() === 'true'

function log(level: 'info' | 'warn' | 'error', event: string, payload: Record<string, unknown>) {
  const writer = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  writer(JSON.stringify({ level, event, service: 'whatsapp-health-check', ...payload }))
}

function mapStateToStatus(state: string): 'connected' | 'connecting' | 'disconnected' {
  if (state === 'open') return 'connected'
  if (state === 'connecting') return 'connecting'
  return 'disconnected'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const correlationId = req.headers.get('x-correlation-id') || req.headers.get('x-request-id') || crypto.randomUUID()
  const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { data: instances, error: instanceError } = await svc
    .from('whatsapp_instancias')
    .select('id, user_id, instance_name, status, is_available')

  if (instanceError) {
    log('error', 'healthcheck_instances_query_failed', { correlation_id: correlationId, error: instanceError.message })
    return new Response(JSON.stringify({ ok: false, correlation_id: correlationId, error: instanceError.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const processed: Array<Record<string, unknown>> = []
  let unavailableCount = 0

  for (const instance of instances ?? []) {
    try {
      const evoRes = await fetch(`${EVOLUTION_API_URL}/instance/connectionState/${instance.instance_name}`, {
        headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
      })
      const evoData = await evoRes.json().catch(() => ({})) as Record<string, any>
      const state = String(evoData.instance?.state ?? 'close')
      const newStatus = mapStateToStatus(state)
      const isAvailable = newStatus === 'connected'
      const unavailableReason = isAvailable ? null : `healthcheck:${state}`

      if (!isAvailable) unavailableCount += 1

      await svc
        .from('whatsapp_instancias')
        .update({
          status: newStatus,
          is_available: isAvailable,
          unavailable_reason: unavailableReason,
          last_health_checked_at: new Date().toISOString(),
          availability_changed_at: !isAvailable || !instance.is_available ? new Date().toISOString() : undefined,
        })
        .eq('id', instance.id)

      if (!isAvailable) {
        const staleBoundary = new Date(Date.now() - STALE_BACKLOG_HOURS * 60 * 60 * 1000).toISOString()
        const { error: backlogError } = await svc
          .from('message_outbox')
          .update({
            status: 'dead_letter',
            dead_lettered_at: new Date().toISOString(),
            dead_letter_reason: unavailableReason,
            updated_at: new Date().toISOString(),
          })
          .eq('tenant_id', instance.user_id)
          .eq('aggregate_id', instance.id)
          .in('status', ['pending', 'retry', 'sending'])
          .lt('created_at', staleBoundary)

        if (backlogError) {
          log('error', 'healthcheck_backlog_deadletter_failed', {
            correlation_id: correlationId,
            tenant_id: instance.user_id,
            instance_id: instance.id,
            error: backlogError.message,
          })
        } else {
          log('warn', 'instance_marked_unavailable', {
            correlation_id: correlationId,
            tenant_id: instance.user_id,
            instance_id: instance.id,
            instance_name: instance.instance_name,
            reason: unavailableReason,
          })
        }

        if (RECONNECT_WHEN_UNAVAILABLE) {
          await fetch(`${EVOLUTION_API_URL}/instance/connect/${instance.instance_name}`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json', apikey: EVOLUTION_API_KEY },
          }).catch((error) => {
            log('error', 'healthcheck_reconnect_failed', {
              correlation_id: correlationId,
              tenant_id: instance.user_id,
              instance_id: instance.id,
              error: String(error),
            })
          })
        }
      }

      processed.push({
        tenant_id: instance.user_id,
        instance_id: instance.id,
        instance_name: instance.instance_name,
        status: newStatus,
        available: isAvailable,
      })
    } catch (error) {
      log('error', 'healthcheck_instance_failed', {
        correlation_id: correlationId,
        tenant_id: instance.user_id,
        instance_id: instance.id,
        error: String(error),
      })
      processed.push({ instance_id: instance.id, status: 'error', error: String(error) })
    }
  }

  return new Response(JSON.stringify({ ok: true, correlation_id: correlationId, instances: processed.length, unavailable: unavailableCount, processed }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
