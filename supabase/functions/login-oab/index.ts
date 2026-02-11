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

      // Upsert credentials
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

    // Action: login - authenticate with OAB + CPF
    if (action === 'login') {
      if (!oab || !uf || !cpf) {
        return new Response(
          JSON.stringify({ error: 'Campos obrigatórios: oab, uf, cpf' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const cleanCpf = cpf.replace(/\D/g, '');
      const cleanOab = oab.replace(/\D/g, '');

      // Look up credentials
      const { data: cred, error: lookupError } = await supabaseAdmin
        .from('advogado_credentials')
        .select('email, user_id')
        .eq('oab', cleanOab)
        .eq('uf', uf)
        .eq('cpf', cleanCpf)
        .maybeSingle();

      if (lookupError || !cred) {
        return new Response(
          JSON.stringify({ error: 'OAB ou CPF não encontrados. Verifique os dados ou cadastre-se.' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Check if user's email is confirmed
      const { data: userData, error: userError } = await supabaseAdmin.auth.admin.getUserById(cred.user_id);
      
      if (userError || !userData?.user) {
        return new Response(
          JSON.stringify({ error: 'Usuário não encontrado no sistema.' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (!userData.user.email_confirmed_at) {
        return new Response(
          JSON.stringify({ error: 'E-mail ainda não confirmado. Verifique sua caixa de entrada.' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Generate a magic link for passwordless sign-in
      const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
        type: 'magiclink',
        email: cred.email,
      });

      if (linkError || !linkData) {
        console.error('Error generating link:', linkError);
        return new Response(
          JSON.stringify({ error: 'Erro ao gerar sessão. Tente novamente.' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Extract token hash from the action link
      const actionLink = linkData.properties?.action_link || '';
      const url = new URL(actionLink);
      const tokenHash = url.searchParams.get('token_hash') || url.hash?.replace('#', '') || '';
      
      // Also get the token from the properties
      const hashedToken = linkData.properties?.hashed_token || '';

      return new Response(
        JSON.stringify({ 
          email: cred.email,
          token_hash: tokenHash || hashedToken,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Ação inválida. Use "login" ou "register".' }),
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
