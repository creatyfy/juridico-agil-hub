import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  featureNotAvailablePayload,
  isFeatureNotAvailableError,
  requireFeature,
} from "../_shared/tenant-capabilities.ts";
import { logTenantAction } from "../_shared/audit-log.ts";
import { assertTenantScope, ForbiddenTenantAccessError } from "../_shared/tenant-guard.ts";
import { maskedIdentity, signInviteJwt } from "../_shared/invite-security.ts";

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
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Não autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Não autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { cliente_id, processo_id } = await req.json();

    const svc = createClient(supabaseUrl, serviceKey);

    const { data: processoScope } = await svc.from("processos").select("user_id").eq("id", processo_id).maybeSingle();
    assertTenantScope(processoScope?.user_id, user.id);

    if (!cliente_id || !processo_id) {
      return new Response(JSON.stringify({ error: "cliente_id e processo_id são obrigatórios" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await requireFeature(svc, user.id, "secretariado");
    await logTenantAction(svc, {
      tenantId: user.id,
      userId: user.id,
      action: "premium_feature_used",
      entity: "feature",
      entityId: "secretariado",
      metadata: { source: "gerar-convite-vinculacao" },
    });

    // Check for existing pending invite
    const { data: existing } = await svc
      .from("convites_vinculacao")
      .select("id, token, status, invite_nonce, token_expires_at")
      .eq("cliente_id", cliente_id)
      .eq("processo_id", processo_id)
      .eq("status", "pendente")
      .gt("expiracao", new Date().toISOString())
      .maybeSingle();

    if (existing) {
      const expiresAt = existing.token_expires_at ? new Date(existing.token_expires_at).getTime() : 0;
      const stillValid = expiresAt > Date.now() + 2 * 60 * 1000;

      if (stillValid) {
        return new Response(JSON.stringify({ token: existing.token, id: existing.id, reused: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const freshNonce = existing.invite_nonce ?? crypto.randomUUID();
      const jwtSecret = Deno.env.get("INVITE_JWT_SECRET") ?? serviceKey;
      const { data: clienteIdent } = await svc
        .from("clientes")
        .select("email, documento")
        .eq("id", cliente_id)
        .single();

      const newToken = await signInviteJwt({
        tenant_id: user.id,
        cliente_id,
        identity_hint: maskedIdentity(clienteIdent?.email ?? null, clienteIdent?.documento ?? null),
        nonce: freshNonce,
        invite_id: existing.id,
        ttlSeconds: 48 * 60 * 60,
      }, jwtSecret);

      await svc.from("convites_vinculacao").update({
        token: newToken,
        invite_nonce: freshNonce,
        token_expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      }).eq("id", existing.id);

      return new Response(JSON.stringify({ token: newToken, id: existing.id, reused: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const nonce = crypto.randomUUID();

    // Create new invite
    const { data: invite, error: insertError } = await svc
      .from("convites_vinculacao")
      .insert({
        cliente_id,
        processo_id,
        advogado_user_id: user.id,
        invite_nonce: nonce,
        token_expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      })
      .select("id, token")
      .single();

    if (insertError) {
      console.error("Insert error:", insertError);
      return new Response(JSON.stringify({ error: "Erro ao criar convite" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const jwtSecret = Deno.env.get("INVITE_JWT_SECRET") ?? serviceKey;
    const { data: clienteIdent } = await svc
      .from("clientes")
      .select("email, documento")
      .eq("id", cliente_id)
      .single();

    const inviteToken = await signInviteJwt({
      tenant_id: user.id,
      cliente_id,
      identity_hint: maskedIdentity(clienteIdent?.email ?? null, clienteIdent?.documento ?? null),
      nonce,
      invite_id: invite.id,
      ttlSeconds: 48 * 60 * 60,
    }, jwtSecret);

    await svc.from("convites_vinculacao").update({ token: inviteToken }).eq("id", invite.id);

    await logTenantAction(svc, {
      tenantId: user.id,
      userId: user.id,
      action: "invite_sent",
      entity: "convite_vinculacao",
      entityId: invite.id,
      metadata: { cliente_id, processo_id },
    });

    return new Response(JSON.stringify({ token: inviteToken, id: invite.id }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    if (e instanceof ForbiddenTenantAccessError) {
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (isFeatureNotAvailableError(e)) {
      return new Response(JSON.stringify(featureNotAvailablePayload(e.feature)), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.error("Error:", e);
    return new Response(JSON.stringify({ error: "Erro interno" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
