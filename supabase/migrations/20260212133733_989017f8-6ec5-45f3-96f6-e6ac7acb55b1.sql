
-- Add numero_whatsapp and status_vinculo to clientes
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS numero_whatsapp text;
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS status_vinculo text DEFAULT 'pendente';

-- Add unique constraint on numero_whatsapp (non-null only)
CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_numero_whatsapp_unique 
ON public.clientes (numero_whatsapp) WHERE numero_whatsapp IS NOT NULL;

-- Create convites_vinculacao table
CREATE TABLE public.convites_vinculacao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  processo_id uuid NOT NULL REFERENCES public.processos(id) ON DELETE CASCADE,
  advogado_user_id uuid NOT NULL,
  token text NOT NULL DEFAULT encode(extensions.gen_random_bytes(32), 'hex'),
  expiracao timestamp with time zone NOT NULL DEFAULT (now() + interval '24 hours'),
  status text NOT NULL DEFAULT 'pendente',
  ip_aceite text,
  data_aceite timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(token)
);

ALTER TABLE public.convites_vinculacao ENABLE ROW LEVEL SECURITY;

-- Advogado can manage own invites
CREATE POLICY "Advogado can manage own convites_vinculacao"
ON public.convites_vinculacao FOR ALL
USING (auth.uid() = advogado_user_id)
WITH CHECK (auth.uid() = advogado_user_id);

-- Public read by token (for the public page)
CREATE POLICY "Anyone can read convite by token"
ON public.convites_vinculacao FOR SELECT
USING (true);

-- Create validacoes_otp table
CREATE TABLE public.validacoes_otp (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  convite_id uuid NOT NULL REFERENCES public.convites_vinculacao(id) ON DELETE CASCADE,
  numero_informado text NOT NULL,
  codigo_otp text NOT NULL,
  expiracao timestamp with time zone NOT NULL DEFAULT (now() + interval '5 minutes'),
  validado boolean NOT NULL DEFAULT false,
  tentativas integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.validacoes_otp ENABLE ROW LEVEL SECURITY;

-- Only edge functions (service role) will interact with this table
-- No direct client access needed
