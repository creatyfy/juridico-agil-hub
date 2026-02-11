import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, oab, uf, cpf, email, user_id } = await req.json();

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Action: register - store credentials after signup
    if (action === 'register') {
      if (!oab || !uf || !cpf || !email || !user_id) {
        return new Response(
          JSON.stringify({ error: 'Campos obrigatórios: oab, uf, cpf, email, user_id' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const cleanCpf = cpf.replace(/\D/g, '');
      const cleanOab = oab.replace(/\D/g, '');

      const { error } = await supabaseAdmin
        .from('advogado_credentials')
        .upsert(
          { oab: cleanOab, uf, cpf: cleanCpf, email, user_id },
          { onConflict: 'oab,uf' }
        );

      if (error) {
        console.error('Error storing credentials:', error);
        return new Response(
          JSON.stringify({ error: 'Erro ao salvar credenciais' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Action: lookup - find email by OAB+UF (used for OAB+Password login)
    if (action === 'lookup') {
      if (!oab || !uf) {
        return new Response(
          JSON.stringify({ error: 'Campos obrigatórios: oab, uf' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const cleanOab = oab.replace(/\D/g, '');

      const { data: cred, error: lookupError } = await supabaseAdmin
        .from('advogado_credentials')
        .select('email')
        .eq('oab', cleanOab)
        .eq('uf', uf)
        .maybeSingle();

      if (lookupError || !cred) {
        return new Response(
          JSON.stringify({ error: 'OAB não encontrada. Verifique os dados ou cadastre-se.' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ email: cred.email }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Ação inválida. Use "lookup" ou "register".' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: 'Erro interno do servidor' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
