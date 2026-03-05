import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.25.76";
import { juditRequest } from "../_shared/judit-client.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const requestSchema = z.object({
  action: z.enum(['create', 'status', 'results']),
  request_id: z.string().optional(),
  search_key: z.string().optional(),
  search_type: z.string().optional(),
})

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Missing authorization');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } }
    });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error('Unauthorized');

    const tenantApiKey = Deno.env.get('JUDIT_API_KEY');
    if (!tenantApiKey) throw new Error('JUDIT_API_KEY not configured in secrets');

    const parsed = requestSchema.safeParse(await req.json());
    if (!parsed.success) throw new Error(JSON.stringify(parsed.error.flatten()));

    const { action, request_id, search_key, search_type } = parsed.data;

    if (action === 'create') {
      const data = await juditRequest({
        tenantKey: user.id,
        apiKey: tenantApiKey,
        path: '/requests',
        method: 'POST',
        body: {
          search: {
            search_type: search_type || 'oab',
            search_key,
            response_type: (search_type === 'lawsuit_cnj') ? 'lawsuit' : 'lawsuits',
          },
        },
      })
      return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'status') {
      const data = await juditRequest({
        tenantKey: user.id,
        apiKey: tenantApiKey,
        path: `/requests/${request_id}`,
      })
      return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const data = await juditRequest({
      tenantKey: user.id,
      apiKey: tenantApiKey,
      path: `/responses?request_id=${request_id}`,
    })
    return new Response(JSON.stringify(data), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
