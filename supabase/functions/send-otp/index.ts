import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hashOtpCode, ensureOtpNotRateLimited, registerOtpRateEvent } from "../_shared/otp-security.ts";
import { sha256Hex } from "../_shared/invite-security.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-forwarded-for, x-real-ip, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { email, documento } = await req.json();
    const normalizedEmail = String(email ?? '').trim().toLowerCase();
    if (!normalizedEmail) {
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    const otpPepper = Deno.env.get('OTP_PEPPER') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip') ?? '0.0.0.0';
    const ipHash = await sha256Hex(ip);
    const documentHash = documento ? await sha256Hex(String(documento).replace(/\D/g, '')) : null;

    const rate = await ensureOtpNotRateLimited({ supabase, ipHash, email: normalizedEmail, documentHash });
    if (!rate.allowed) {
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const codeHash = await hashOtpCode(code, otpPepper);

    await supabase
      .from('email_verification_codes')
      .update({ consumed_at: new Date().toISOString(), verified: false })
      .eq('email', normalizedEmail)
      .eq('otp_context', 'email_verification')
      .is('consumed_at', null);

    await supabase.from('email_verification_codes').insert({
      email: normalizedEmail,
      code_hash: codeHash,
      otp_context: 'email_verification',
      document_hash: documentHash,
      source_ip_hash: ipHash,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });

    await registerOtpRateEvent({ supabase, ipHash, email: normalizedEmail, documentHash });

    if (resendApiKey) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Jarvis Jud <onboarding@resend.dev>',
          to: [normalizedEmail],
          subject: 'Código de Verificação - Jarvis Jud',
          html: `<p>Seu código de verificação é: <b>${code}</b></p><p>Expira em 10 minutos.</p>`,
        }),
      });
    }

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
