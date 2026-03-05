
-- Fix RLS on email_verification_codes (service-role only, used by edge functions)
CREATE POLICY "Service role access on email_verification_codes" ON public.email_verification_codes FOR ALL USING (true) WITH CHECK (true);

-- Fix RLS on validacoes_otp (service-role only, used by edge functions)
CREATE POLICY "Service role access on validacoes_otp" ON public.validacoes_otp FOR ALL USING (true) WITH CHECK (true);
