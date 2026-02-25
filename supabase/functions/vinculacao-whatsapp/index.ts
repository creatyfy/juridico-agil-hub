import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { enqueueMessage } from "../_shared/message-outbox-enqueue.ts";
import { assertTenantScope, ForbiddenTenantAccessError, tenantWriteGuard } from "../_shared/tenant-guard.ts";
import { hashOtpCode } from "../_shared/otp-security.ts";
import { sha256Hex } from "../_shared/invite-security.ts";
import { verifyInviteJwt } from "../_shared/invite-security.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-forwarded-for, x-real-ip, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const inviteSecret = Deno.env.get("INVITE_JWT_SECRET") ?? serviceKey;
    const otpPepper = Deno.env.get("OTP_PEPPER") ?? serviceKey;
    const svc = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const { action, token } = body;

    if (!token) return json({ error: "Token obrigatório" }, 400);
    const claims = await verifyInviteJwt(token, inviteSecret);

    const { data: convite, error } = await svc
      .from("convites_vinculacao")
      .select("*, clientes(id, nome, documento, tipo_documento, numero_whatsapp, status_vinculo), processos(id, numero_cnj, classe, tribunal)")
      .eq("id", claims.invite_id)
      .eq("cliente_id", claims.cliente_id)
      .eq("token", token)
      .maybeSingle();

    if (error || !convite) return json({ error: "Convite não encontrado" }, 404);
    assertTenantScope(convite.advogado_user_id, claims.tenant_id);

    if (convite.invite_nonce !== claims.nonce) return json({ error: "Convite inválido" }, 401);
    if (convite.token_expires_at && new Date(convite.token_expires_at).getTime() + 30000 < Date.now()) return json({ error: "Convite expirado" }, 410);


    if (action === "fetch") {
      return json({
        convite: { id: convite.id, status: convite.status, expiracao: convite.expiracao },
        cliente: convite.clientes,
        processo: convite.processos,
      });
    }

    if (action === "send-otp") {
      const { numero_whatsapp } = body;
      if (!numero_whatsapp) return json({ error: "numero_whatsapp é obrigatório" }, 400);
      const cleanNumber = numero_whatsapp.replace(/\D/g, "");
      if (cleanNumber.length < 10 || cleanNumber.length > 13) return json({ error: "Número inválido" }, 400);

      const otp = String(Math.floor(100000 + Math.random() * 900000));
      const otpHash = await hashOtpCode(otp, otpPepper);

      await svc.from("validacoes_otp").insert({
        cliente_id: convite.cliente_id,
        convite_id: convite.id,
        numero_informado: cleanNumber,
        codigo_otp_hash: otpHash,
        codigo_otp: null,
      });

      const { data: instance } = await svc
        .from("whatsapp_instancias")
        .select("id, instance_name, status")
        .eq("user_id", convite.advogado_user_id)
        .eq("status", "connected")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!instance) return json({ error: "WhatsApp do escritório não está conectado" }, 503);

      const whatsappNumber = cleanNumber.startsWith("55") ? cleanNumber : `55${cleanNumber}`;
      const messageText = `🔐 Seu código de confirmação é: *${otp}*\n\nCódigo expira em 5 minutos.`;

      const enqueue = await enqueueMessage({
        supabase: svc,
        tenantId: convite.advogado_user_id,
        destination: whatsappNumber,
        event: "vinculacao_otp",
        reference: `${convite.id}:${convite.cliente_id}:${Date.now()}`,
        aggregateType: "convite_vinculacao",
        aggregateId: convite.id,
        payload: {
          kind: "vinculacao_otp",
          destinationNumber: whatsappNumber,
          messageText,
          instanceName: instance.instance_name,
          instanceId: instance.id,
          userId: convite.advogado_user_id,
        },
      });

      if (!enqueue.ok) return json({ error: "Falha ao enfileirar mensagem OTP" }, enqueue.status === "rate_limited" ? 429 : 500);
      return json({ success: true, status: enqueue.status });
    }

    if (action === "verify-otp") {
      const { codigo, ip } = body;
      if (!codigo) return json({ error: "codigo é obrigatório" }, 400);

      const otpHash = await hashOtpCode(String(codigo).trim(), otpPepper);
      const ipHash = await sha256Hex(String(ip ?? "0.0.0.0"));
      const { data: otpResult, error: otpError } = await svc.rpc("verify_and_consume_otp", {
        p_identifier: convite.id,
        p_hash: otpHash,
        p_source_ip_hash: ipHash,
      });
      if (otpError || !otpResult?.[0]?.ok) return json({ error: "Código inválido ou expirado" }, 400);

      const { error: claimError } = await svc.rpc("claim_and_accept_invite", {
        p_invite_id: convite.id,
        p_token: token,
        p_nonce: claims.nonce,
        p_expected_tenant: claims.tenant_id,
        p_invite_kind: "convite_vinculacao",
        p_ip_aceite: ip || null,
      });
      if (claimError) return json({ error: "Convite inválido, expirado ou já utilizado" }, 409);

      await tenantWriteGuard({
        supabase: svc,
        tenantIdFromContext: claims.tenant_id,
        resourceId: convite.id,
        resourceTable: "convites_vinculacao",
      });

      const otpId = otpResult?.[0]?.otp_id as string | undefined;
      const { data: consumedOtp } = await svc.from("validacoes_otp").select("numero_informado,cliente_id").eq("id", otpId).maybeSingle();
      await svc.from("clientes").update({ numero_whatsapp: consumedOtp?.numero_informado ?? convite.clientes?.numero_whatsapp ?? null, status_vinculo: "ativo" }).eq("id", convite.cliente_id);
      return json({ success: true, message: "Número validado com sucesso." });
    }

    return json({ error: "Ação inválida" }, 400);
  } catch (e) {
    if (e instanceof ForbiddenTenantAccessError) return json({ error: "forbidden" }, 403);
    console.error("Unexpected error:", e);
    return json({ error: "Erro interno" }, 500);
  }
});
