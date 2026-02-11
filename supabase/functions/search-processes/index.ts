import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const JUDIT_REQUESTS_URL = "https://requests.prod.judit.io";

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const JUDIT_API_KEY = Deno.env.get('JUDIT_API_KEY');
    if (!JUDIT_API_KEY) throw new Error('JUDIT_API_KEY not configured');

    // Verify auth
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Missing authorization');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } }
    });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error('Unauthorized');

    const { action, request_id, search_key, search_type } = await req.json();

    if (action === 'create') {
      // Create a search request on Judit
      const response = await fetch(`${JUDIT_REQUESTS_URL}/requests`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'api-key': JUDIT_API_KEY,
        },
         body: JSON.stringify({
          search: {
            search_type: search_type || 'oab',
            search_key: search_key,
            response_type: (search_type === 'lawsuit_cnj') ? 'lawsuit' : 'lawsuits',
          },
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(`Judit API error [${response.status}]: ${JSON.stringify(data)}`);
      }

      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'status') {
      // Check request status
      const response = await fetch(`${JUDIT_REQUESTS_URL}/requests/${request_id}`, {
        headers: { 'api-key': JUDIT_API_KEY },
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(`Judit API error [${response.status}]: ${JSON.stringify(data)}`);
      }

      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'results') {
      // Get results with pagination
      const url = new URL(`${JUDIT_REQUESTS_URL}/requests/${request_id}/responses`);
      const response = await fetch(url.toString(), {
        headers: { 'api-key': JUDIT_API_KEY },
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(`Judit API error [${response.status}]: ${JSON.stringify(data)}`);
      }

      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    throw new Error('Invalid action. Use: create, status, results');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
