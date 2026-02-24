import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logTenantAction } from "../_shared/audit-log.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Não autorizado");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user } } = await authClient.auth.getUser();
    if (!user) throw new Error("Não autorizado");

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { processo_id, cliente_id } = await req.json();

    if (!processo_id || !cliente_id) throw new Error("processo_id e cliente_id são obrigatórios");

    const { data: existing } = await supabase
      .from("cliente_processos")
      .select("id")
      .eq("processo_id", processo_id)
      .eq("cliente_id", cliente_id)
      .maybeSingle();

    if (!existing) {
      const { error } = await supabase.from("cliente_processos").insert({
        processo_id,
        cliente_id,
        advogado_user_id: user.id,
        status: "ativo",
        data_aceite: new Date().toISOString(),
      });
      if (error) throw new Error(error.message);
    }

    await logTenantAction(supabase, {
      tenantId: user.id,
      userId: user.id,
      action: "processo_cliente_vinculado",
      entity: "processo",
      entityId: processo_id,
      metadata: { cliente_id, source: "link-process-client" },
    });

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro interno";
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
