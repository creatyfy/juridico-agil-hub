import { Client } from "https://deno.land/x/postgres@v0.19.3/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const token = url.searchParams.get("token")?.trim() ?? "";

  if (!token) {
    return new Response(
      JSON.stringify({ error: "token é obrigatório" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const databaseUrl = Deno.env.get("SUPABASE_DB_URL");
  if (!databaseUrl) {
    return new Response(
      JSON.stringify({ error: "SUPABASE_DB_URL não configurada" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const client = new Client(databaseUrl);

  try {
    await client.connect();
    await client.queryArray("BEGIN");

    // Escopo da transação atual (true = LOCAL).
    await client.queryArray("SELECT set_config('app.invite_token', $1, true)", [token]);

    const result = await client.queryObject<{
      id: string;
      cliente_id: string;
      processo_id: string;
      status: string;
      expiracao: string;
      created_at: string;
    }>(`
      SELECT id, cliente_id, processo_id, status, expiracao, created_at
      FROM public.convites_vinculacao
      LIMIT 1
    `);

    // Limpeza explícita antes do COMMIT (defesa em profundidade).
    await client.queryArray("SELECT set_config('app.invite_token', '', true)");
    await client.queryArray("COMMIT");

    return new Response(
      JSON.stringify({ convite: result.rows[0] ?? null }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    try {
      await client.queryArray("ROLLBACK");
    } catch {
      // noop
    }

    return new Response(
      JSON.stringify({ error: "erro interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } finally {
    try {
      // Limpeza redundante para garantir ausência de configuração residual.
      await client.queryArray("SELECT set_config('app.invite_token', '', true)");
    } catch {
      // noop
    }

    await client.end();
  }
});
