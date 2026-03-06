import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  // Return the values so we can configure app.settings
  return new Response(JSON.stringify({
    supabase_url: supabaseUrl,
    service_role_key_preview: serviceRoleKey.substring(0, 20) + '...',
    service_role_key_full: serviceRoleKey,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
