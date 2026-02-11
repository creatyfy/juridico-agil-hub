
-- Allow clients to view their own cliente record via auth_user_id
CREATE POLICY "Clientes can view own record"
ON public.clientes
FOR SELECT
USING (auth.uid() = auth_user_id);

-- Allow clients to view processes linked to them via cliente_processos
CREATE POLICY "Clientes can view linked processos"
ON public.processos
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM cliente_processos cp
    JOIN clientes c ON c.id = cp.cliente_id
    WHERE cp.processo_id = processos.id
      AND cp.status = 'ativo'
      AND c.auth_user_id = auth.uid()
  )
);

-- Allow clients to view movimentacoes of linked processos
CREATE POLICY "Clientes can view linked movimentacoes"
ON public.movimentacoes
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM cliente_processos cp
    JOIN clientes c ON c.id = cp.cliente_id
    WHERE cp.processo_id = movimentacoes.processo_id
      AND cp.status = 'ativo'
      AND c.auth_user_id = auth.uid()
  )
);
