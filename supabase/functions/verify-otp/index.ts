import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hashOtpCode } from "../_shared/otp-security.ts";
import { sha256Hex } from "../_shared/invite-security.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-forwarded-for, x-real-ip, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const { email, code } = await req.json();
    const normalizedEmail = String(email ?? '').trim().toLowerCase();
    const normalizedCode = String(code ?? '').trim();
    if (!normalizedEmail || !normalizedCode) {
      return new Response(JSON.stringify({ error: 'Código inválido ou expirado' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const otpPepper = Deno.env.get('OTP_PEPPER') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip') ?? '0.0.0.0';
    const ipHash = await sha256Hex(ip);
    const submittedHash = await hashOtpCode(normalizedCode, otpPepper);

    const { data: otpResult, error: otpError } = await supabase.rpc('verify_and_consume_otp', {
      p_identifier: normalizedEmail,
      p_hash: submittedHash,
      p_source_ip_hash: ipHash,
    });

    if (otpError || !otpResult?.[0]?.ok) {
      return new Response(JSON.stringify({ error: 'Código inválido ou expirado' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

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
