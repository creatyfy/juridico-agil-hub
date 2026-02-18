-- Hybrid WhatsApp auth + AI orchestration schema

-- 1) Align clientes with tenant/cpf model (without breaking existing user_id/documento usage)
ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS tenant_id UUID,
  ADD COLUMN IF NOT EXISTS cpf TEXT;

UPDATE public.clientes
SET tenant_id = user_id
WHERE tenant_id IS NULL;

UPDATE public.clientes
SET cpf = regexp_replace(coalesce(documento, ''), '\\D', '', 'g')
WHERE (cpf IS NULL OR cpf = '')
  AND tipo_documento = 'CPF'
  AND documento IS NOT NULL;

ALTER TABLE public.clientes
  ALTER COLUMN tenant_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_clientes_tenant_id ON public.clientes(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_tenant_cpf_unique
  ON public.clientes(tenant_id, cpf)
  WHERE cpf IS NOT NULL AND cpf <> '';

-- 2) Dedicated phones table
CREATE TABLE IF NOT EXISTS public.telefones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  cliente_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  numero TEXT NOT NULL,
  verificado BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, numero),
  UNIQUE(cliente_id, numero)
);

CREATE INDEX IF NOT EXISTS idx_telefones_tenant_numero ON public.telefones(tenant_id, numero);
ALTER TABLE public.telefones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own tenant telefones"
  ON public.telefones FOR SELECT
  USING (auth.uid() = tenant_id);

CREATE POLICY "Users can insert own tenant telefones"
  ON public.telefones FOR INSERT
  WITH CHECK (auth.uid() = tenant_id);

CREATE POLICY "Users can update own tenant telefones"
  ON public.telefones FOR UPDATE
  USING (auth.uid() = tenant_id)
  WITH CHECK (auth.uid() = tenant_id);

-- 3) OTP validations (hashed OTP only)
CREATE TABLE IF NOT EXISTS public.otp_validacoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  telefone TEXT NOT NULL,
  otp_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  tentativas SMALLINT NOT NULL DEFAULT 0 CHECK (tentativas >= 0 AND tentativas <= 3),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_otp_validacoes_tenant_telefone ON public.otp_validacoes(tenant_id, telefone);
CREATE INDEX IF NOT EXISTS idx_otp_validacoes_expires_at ON public.otp_validacoes(expires_at);
ALTER TABLE public.otp_validacoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own tenant otp"
  ON public.otp_validacoes FOR SELECT
  USING (auth.uid() = tenant_id);

CREATE POLICY "Users can insert own tenant otp"
  ON public.otp_validacoes FOR INSERT
  WITH CHECK (auth.uid() = tenant_id);

CREATE POLICY "Users can update own tenant otp"
  ON public.otp_validacoes FOR UPDATE
  USING (auth.uid() = tenant_id)
  WITH CHECK (auth.uid() = tenant_id);

CREATE POLICY "Users can delete own tenant otp"
  ON public.otp_validacoes FOR DELETE
  USING (auth.uid() = tenant_id);

-- 4) Conversation state machine
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'estado_conversa') THEN
    CREATE TYPE public.estado_conversa AS ENUM ('UNVERIFIED', 'AWAITING_CPF', 'AWAITING_OTP', 'VERIFIED');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.conversas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  cliente_id UUID REFERENCES public.clientes(id) ON DELETE SET NULL,
  telefone TEXT NOT NULL,
  estado public.estado_conversa NOT NULL DEFAULT 'UNVERIFIED',
  ultima_interacao TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, telefone)
);

CREATE INDEX IF NOT EXISTS idx_conversas_tenant_cliente ON public.conversas(tenant_id, cliente_id);
ALTER TABLE public.conversas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own tenant conversas"
  ON public.conversas FOR SELECT
  USING (auth.uid() = tenant_id);

CREATE POLICY "Users can insert own tenant conversas"
  ON public.conversas FOR INSERT
  WITH CHECK (auth.uid() = tenant_id);

CREATE POLICY "Users can update own tenant conversas"
  ON public.conversas FOR UPDATE
  USING (auth.uid() = tenant_id)
  WITH CHECK (auth.uid() = tenant_id);

-- 5) Number-level rate limit buckets
CREATE TABLE IF NOT EXISTS public.whatsapp_rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  telefone TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  UNIQUE(tenant_id, telefone)
);

ALTER TABLE public.whatsapp_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own tenant rate limits"
  ON public.whatsapp_rate_limits FOR ALL
  USING (auth.uid() = tenant_id)
  WITH CHECK (auth.uid() = tenant_id);
