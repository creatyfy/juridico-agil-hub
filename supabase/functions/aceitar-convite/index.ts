import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { assertTenantScope, ForbiddenTenantAccessError } from "../_shared/tenant-guard.ts";
import { hashOtpCode, registerOtpRateEvent, ensureOtpNotRateLimited } from "../_shared/otp-security.ts";
import { sha256Hex, verifyInviteJwt } from "../_shared/invite-security.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-forwarded-for, x-real-ip, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function readIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? req.headers.get("x-real-ip")
    ?? "0.0.0.0";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const inviteSecret = Deno.env.get("INVITE_JWT_SECRET") ?? serviceRoleKey;
    const otpPepper = Deno.env.get("OTP_PEPPER") ?? serviceRoleKey;
    const resendApiKey = Deno.env.get("RESEND_API_KEY");

    const { token, action, code } = await req.json();
    if (!token) return jsonResponse({ error: "Token é obrigatório" }, 400);

    const claims = await verifyInviteJwt(token, inviteSecret);
    const { data: invite, error: fetchError } = await supabase
      .from("cliente_processos")
      .select("*, clientes(id, nome, documento, tipo_documento, auth_user_id, email), processos(id, numero_cnj, classe, tribunal)")
      .eq("id", claims.invite_id)
      .eq("cliente_id", claims.cliente_id)
      .eq("token", token)
      .maybeSingle();

    if (fetchError || !invite) return jsonResponse({ error: "Convite não encontrado" }, 404);
    assertTenantScope(invite.advogado_user_id, claims.tenant_id);

    if (invite.token_used_at || invite.status === "ativo") return jsonResponse({ error: "Convite já utilizado" }, 409);
    if (invite.token_expires_at && new Date(invite.token_expires_at) < new Date()) return jsonResponse({ error: "Convite expirado" }, 410);

    if (action === "fetch") {
      return jsonResponse({
        invite: { id: invite.id, status: invite.status, data_convite: invite.data_convite },
        cliente: invite.clientes,
        processo: invite.processos,
        otpRequired: true,
        needsRegistration: !invite.clientes?.auth_user_id,
      });
    }

    if (action === "send-otp") {
      const email = invite.clientes?.email as string | undefined;
      if (!email || !resendApiKey) return jsonResponse({ success: true });

      const ipHash = await sha256Hex(readIp(req));
      const documentHash = await sha256Hex(String(invite.clientes?.documento ?? ""));
      const rate = await ensureOtpNotRateLimited({ supabase, ipHash, email, documentHash });
      if (!rate.allowed) return jsonResponse({ success: true });

      const otp = String(Math.floor(100000 + Math.random() * 900000));
      const codeHash = await hashOtpCode(otp, otpPepper);

      await supabase.from("email_verification_codes").insert({
        email,
        code_hash: codeHash,
        otp_context: "invite_link",
        document_hash: documentHash,
        source_ip_hash: ipHash,
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      });

      await registerOtpRateEvent({ supabase, ipHash, email, documentHash });

      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: "Jarvis Jud <onboarding@resend.dev>",
          to: [email],
          subject: "Código de confirmação do convite",
          html: `<p>Seu código é <b>${otp}</b>. Expira em 10 minutos.</p>`,
        }),
      });

      return jsonResponse({ success: true });
    }

    if (action === "accept") {
      if (!code) return jsonResponse({ error: "Código OTP obrigatório" }, 400);

      const authHeader = req.headers.get("Authorization");
      if (!authHeader) return jsonResponse({ error: "Login necessário" }, 401);

      const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
      const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
      const { data: { user } } = await userClient.auth.getUser();
      if (!user) return jsonResponse({ error: "Usuário não autenticado" }, 401);

      const email = String(invite.clientes?.email ?? "");
      const ipHash = await sha256Hex(readIp(req));
      const documentHash = await sha256Hex(String(invite.clientes?.documento ?? ""));
      const rate = await ensureOtpNotRateLimited({ supabase, ipHash, email, documentHash });
      if (!rate.allowed) return jsonResponse({ error: "Código inválido ou expirado" }, 400);

      const submittedHash = await hashOtpCode(String(code).trim(), otpPepper);
      const { data: otpRow } = await supabase
        .from("email_verification_codes")
        .select("id")
        .eq("email", email)
        .eq("otp_context", "invite_link")
        .eq("verified", false)
        .is("consumed_at", null)
        .gte("expires_at", new Date().toISOString())
        .eq("code_hash", submittedHash)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      await registerOtpRateEvent({ supabase, ipHash, email, documentHash });
      if (!otpRow) return jsonResponse({ error: "Código inválido ou expirado" }, 400);

      await supabase.from("email_verification_codes").update({ verified: true, consumed_at: new Date().toISOString() }).eq("id", otpRow.id);

      if (!invite.clientes?.auth_user_id) {
        await supabase.from("clientes").update({ auth_user_id: user.id, status: "ativo" }).eq("id", invite.cliente_id);
      }

      await supabase.from("cliente_processos").update({
        status: "ativo",
        data_aceite: new Date().toISOString(),
        token_used_at: new Date().toISOString(),
      }).eq("id", invite.id);

      return jsonResponse({ success: true, status: "ativo" });
    }

    return jsonResponse({ error: "Ação inválida" }, 400);
  } catch (e) {
    if (e instanceof ForbiddenTenantAccessError) return jsonResponse({ error: "forbidden" }, 403);
    console.error("Unexpected error:", e);
    return jsonResponse({ error: "Erro interno" }, 500);
  }
});
