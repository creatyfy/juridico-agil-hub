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
    const { email, code, documento } = await req.json();
    const normalizedEmail = String(email ?? '').trim().toLowerCase();
    const normalizedCode = String(code ?? '').trim();
    if (!normalizedEmail || !normalizedCode) {
      return new Response(JSON.stringify({ error: 'Código inválido ou expirado' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const otpPepper = Deno.env.get('OTP_PEPPER') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip') ?? '0.0.0.0';
    const ipHash = await sha256Hex(ip);
    const documentHash = documento ? await sha256Hex(String(documento).replace(/\D/g, '')) : null;

    const rate = await ensureOtpNotRateLimited({ supabase, ipHash, email: normalizedEmail, documentHash });
    if (!rate.allowed) {
      return new Response(JSON.stringify({ error: 'Código inválido ou expirado' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const submittedHash = await hashOtpCode(normalizedCode, otpPepper);
    const { data: otp } = await supabase
      .from('email_verification_codes')
      .select('id')
      .eq('email', normalizedEmail)
      .eq('otp_context', 'email_verification')
      .eq('verified', false)
      .is('consumed_at', null)
      .gte('expires_at', new Date().toISOString())
      .eq('code_hash', submittedHash)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    await registerOtpRateEvent({ supabase, ipHash, email: normalizedEmail, documentHash });

    if (!otp) {
      return new Response(JSON.stringify({ error: 'Código inválido ou expirado' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    await supabase.from('email_verification_codes').update({ verified: true, consumed_at: new Date().toISOString() }).eq('id', otp.id);

    const { data: users } = await supabase.auth.admin.listUsers();
    const user = users?.users?.find((u) => u.email === normalizedEmail);
    if (user) {
      await supabase.auth.admin.updateUserById(user.id, { email_confirm: true });
    }

    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: 'Código inválido ou expirado' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
