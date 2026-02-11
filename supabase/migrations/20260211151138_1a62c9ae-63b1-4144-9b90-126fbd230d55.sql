
-- Fix: replace overly permissive policy with service_role only
DROP POLICY "Service role can manage movimentacoes" ON public.movimentacoes;

-- Service role bypass RLS by default, so no explicit policy needed for it.
-- Instead, add delete policy for users on their own movimentacoes
CREATE POLICY "Users can delete movimentacoes of own processos" ON public.movimentacoes
  FOR DELETE USING (EXISTS (SELECT 1 FROM public.processos WHERE processos.id = movimentacoes.processo_id AND processos.user_id = auth.uid()));

-- Update policy for movimentacoes
CREATE POLICY "Users can update movimentacoes of own processos" ON public.movimentacoes
  FOR UPDATE USING (EXISTS (SELECT 1 FROM public.processos WHERE processos.id = movimentacoes.processo_id AND processos.user_id = auth.uid()));
