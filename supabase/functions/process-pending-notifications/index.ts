import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const body = await req.json().catch(() => ({}))
  const batchSize = Number(body.batch_size ?? Deno.env.get('NOTIFICATIONS_BATCH_SIZE') ?? 100)
  const failRate = Number(body.fail_rate ?? Deno.env.get('NOTIFICATIONS_SIMULATED_FAIL_RATE') ?? 0)

  const { data, error } = await supabase.rpc('process_pending_notifications', {
    p_batch_size: Number.isFinite(batchSize) ? batchSize : 100,
    p_fail_rate: Number.isFinite(failRate) ? failRate : 0,
  })

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({
    success: true,
    worker: 'process-pending-notifications',
    result: data?.[0] ?? { processed_total: 0, sent_total: 0, failed_total: 0 },
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
