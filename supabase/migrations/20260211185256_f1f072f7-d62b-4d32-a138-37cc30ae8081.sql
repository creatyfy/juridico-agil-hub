
-- Add fields to clientes table
ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS auth_user_id UUID,
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pendente';

-- Create cliente_processos link table
CREATE TABLE public.cliente_processos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  processo_id UUID NOT NULL REFERENCES processos(id) ON DELETE CASCADE,
  advogado_user_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente',
  token TEXT NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  data_convite TIMESTAMPTZ NOT NULL DEFAULT now(),
  data_aceite TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(cliente_id, processo_id)
);

ALTER TABLE public.cliente_processos ENABLE ROW LEVEL SECURITY;

-- RLS: advogado manages own invites
CREATE POLICY "Advogado can manage own invites"
  ON public.cliente_processos FOR ALL
  TO authenticated
  USING (auth.uid() = advogado_user_id);

-- RLS: cliente views invites directed to them
CREATE POLICY "Cliente can view own invites"
  ON public.cliente_processos FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM clientes
      WHERE clientes.id = cliente_processos.cliente_id
      AND clientes.auth_user_id = auth.uid()
    )
  );

-- RLS: cliente can update invite status
CREATE POLICY "Cliente can accept invites"
  ON public.cliente_processos FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM clientes
      WHERE clientes.id = cliente_processos.cliente_id
      AND clientes.auth_user_id = auth.uid()
    )
  );

-- Allow anonymous access to read invites by token (for the accept page)
CREATE POLICY "Anyone can view invite by token"
  ON public.cliente_processos FOR SELECT
  TO anon
  USING (true);
