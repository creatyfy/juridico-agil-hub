-- Security hardening for WhatsApp auth/webhook

CREATE TABLE IF NOT EXISTS public.webhook_replay_guard (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nonce_hash TEXT NOT NULL UNIQUE,
  timestamp_seconds BIGINT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_replay_guard_expires_at ON public.webhook_replay_guard(expires_at);

CREATE TABLE IF NOT EXISTS public.whatsapp_auth_rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('PHONE', 'TENANT_CPF')),
  scope_hash TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, scope_type, scope_hash)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_auth_rate_limits_window
  ON public.whatsapp_auth_rate_limits(tenant_id, scope_type, window_start);

CREATE UNIQUE INDEX IF NOT EXISTS idx_otp_validacoes_tenant_telefone_unique
  ON public.otp_validacoes(tenant_id, telefone);
