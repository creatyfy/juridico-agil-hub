
-- Fix: Remove permissive policy. Service role bypasses RLS automatically.
DROP POLICY "Service role full access" ON public.advogado_credentials;

-- Only allow authenticated users to read their own credentials
CREATE POLICY "Users can view own credentials"
ON public.advogado_credentials
FOR SELECT
USING (auth.uid() = user_id);
