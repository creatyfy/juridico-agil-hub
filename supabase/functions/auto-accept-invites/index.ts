import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Não autenticado" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Usuário não autenticado" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const cpf = user.user_metadata?.cpf;
    if (!cpf) {
      return new Response(
        JSON.stringify({ linked: 0, message: "CPF não encontrado no perfil" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Find cliente records with matching CPF that are not yet linked
    const { data: clientes, error: clienteError } = await supabase
      .from("clientes")
      .select("id")
      .eq("documento", cpf)
      .is("auth_user_id", null);

    if (clienteError || !clientes || clientes.length === 0) {
      // Also check if already linked - just activate pending invites
      const { data: linkedClientes } = await supabase
        .from("clientes")
        .select("id")
        .eq("documento", cpf)
        .eq("auth_user_id", user.id);

      if (linkedClientes && linkedClientes.length > 0) {
        const clienteIds = linkedClientes.map((c) => c.id);
        const { data: updated } = await supabase
          .from("cliente_processos")
          .update({ status: "ativo", data_aceite: new Date().toISOString() })
          .in("cliente_id", clienteIds)
          .eq("status", "pendente")
          .select("id");

        return new Response(
          JSON.stringify({ linked: 0, activated: updated?.length || 0 }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ linked: 0, message: "Nenhum cliente pendente encontrado" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Link auth_user_id to all matching cliente records
    const clienteIds = clientes.map((c) => c.id);

    await supabase
      .from("clientes")
      .update({ auth_user_id: user.id, status: "ativo" })
      .in("id", clienteIds);

    // Activate all pending invites for these clients
    const { data: activated } = await supabase
      .from("cliente_processos")
      .update({ status: "ativo", data_aceite: new Date().toISOString() })
      .in("cliente_id", clienteIds)
      .eq("status", "pendente")
      .select("id");

    return new Response(
      JSON.stringify({ linked: clienteIds.length, activated: activated?.length || 0 }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("auto-accept-invites error:", e);
    return new Response(
      JSON.stringify({ error: "Erro interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
