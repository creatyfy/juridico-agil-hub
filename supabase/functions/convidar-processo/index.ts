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
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Validate auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Não autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
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

    await requireFeature(supabase, user.id, "gerente_exclusivo");
    await logTenantAction(supabase, {
      tenantId: user.id,
      userId: user.id,
      action: "premium_feature_used",
      entity: "feature",
      entityId: "gerente_exclusivo",
      metadata: { source: "convidar-processo" },
    });

    const { cliente_id, processo_id } = await req.json();

    const { data: processoScope } = await supabase.from("processos").select("user_id").eq("id", processo_id).maybeSingle();
    assertTenantScope(processoScope?.user_id, user.id);


    if (!cliente_id || !processo_id) {
      return new Response(
        JSON.stringify({ error: "cliente_id e processo_id são obrigatórios" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if link already exists
    const { data: existing } = await supabase
      .from("cliente_processos")
      .select("id, status")
      .eq("cliente_id", cliente_id)
      .eq("processo_id", processo_id)
      .maybeSingle();

    if (existing) {
      return new Response(
        JSON.stringify({ error: "Convite já existe para este processo", status: existing.status }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const nonce = crypto.randomUUID();

    // Create invite
    const { data: invite, error: insertError } = await supabase
      .from("cliente_processos")
      .insert({
        cliente_id,
        processo_id,
        advogado_user_id: user.id,
        status: "pendente",
        invite_nonce: nonce,
        token_expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      })
      .select("id, token, invite_nonce")
      .single();

    if (insertError) {
      console.error("Insert error:", insertError);
      return new Response(
        JSON.stringify({ error: "Erro ao criar convite" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const jwtSecret = Deno.env.get("INVITE_JWT_SECRET") ?? serviceRoleKey;
    const { data: clienteIdent } = await supabase
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
      ttlSeconds: 15 * 60,
    }, jwtSecret);

    await supabase
      .from("cliente_processos")
      .update({ token: inviteToken })
      .eq("id", invite.id);

    await logTenantAction(supabase, {
      tenantId: user.id,
      userId: user.id,
      action: "invite_sent",
      entity: "cliente_processo",
      entityId: invite.id,
      metadata: {
        processo_id,
        cliente_id,
      },
    });

    // Get processo info for notification
    const { data: processo } = await supabase
      .from("processos")
      .select("numero_cnj")
      .eq("id", processo_id)
      .single();

    // Create notification for client if they have auth_user_id
    const { data: clienteForNotif } = await supabase
      .from("clientes")
      .select("auth_user_id, nome")
      .eq("id", cliente_id)
      .single();

    if (clienteForNotif?.auth_user_id) {
      await supabase.from("notificacoes").insert({
        user_id: clienteForNotif.auth_user_id,
        tipo: "convite",
        titulo: "Novo processo vinculado",
        mensagem: `Você foi convidado para acompanhar o processo ${processo?.numero_cnj || ''}`.trim(),
        link: `/dashboard`,
      });
    }

    // Try to send email if client has email
    const { data: cliente } = await supabase
      .from("clientes")
      .select("nome, email")
      .eq("id", cliente_id)
      .single();

    let emailSent = false;
    if (cliente?.email) {
      try {
        const resendKey = Deno.env.get("RESEND_API_KEY");
        if (resendKey) {
          const baseUrl = "https://jarvisjud.online";
          const inviteUrl = `${baseUrl}/convite/${inviteToken}`;

          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${resendKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: "Jarvis Jud <onboarding@resend.dev>",
              to: [cliente.email],
              subject: "Convite para acompanhar processo",
              html: `
                <h2>Olá, ${cliente.nome}!</h2>
                <p>Seu advogado convidou você para acompanhar um processo no Jarvis Jud.</p>
                <p><a href="${inviteUrl}" style="background:#2563eb;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;">Aceitar Convite</a></p>
                <p>Ou copie o link: ${inviteUrl}</p>
              `,
            }),
          });
          emailSent = true;
        }
      } catch (e) {
        console.error("Email send error:", e);
      }
    }

    return new Response(
      JSON.stringify({ success: true, token: inviteToken, emailSent }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
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

    console.error("Unexpected error:", e);
    return new Response(
      JSON.stringify({ error: "Erro interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
