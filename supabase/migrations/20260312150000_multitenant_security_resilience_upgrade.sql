-- Multi-tenant security and resilience upgrade

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1) Invite token hardening + one-time-use markers
ALTER TABLE public.cliente_processos
  ADD COLUMN IF NOT EXISTS invite_nonce TEXT,
  ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS token_used_at TIMESTAMPTZ;

ALTER TABLE public.convites_vinculacao
  ADD COLUMN IF NOT EXISTS invite_nonce TEXT,
  ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS token_used_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cliente_processos_invite_nonce_unique
  ON public.cliente_processos(invite_nonce)
  WHERE invite_nonce IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_convites_vinculacao_invite_nonce_unique
  ON public.convites_vinculacao(invite_nonce)
  WHERE invite_nonce IS NOT NULL;

-- 2) OTP hardening (hash-only + rate limit source fields)
ALTER TABLE public.email_verification_codes
  ADD COLUMN IF NOT EXISTS code_hash TEXT,
  ADD COLUMN IF NOT EXISTS otp_context TEXT NOT NULL DEFAULT 'email_verification',
  ADD COLUMN IF NOT EXISTS document_hash TEXT,
  ADD COLUMN IF NOT EXISTS source_ip_hash TEXT,
  ADD COLUMN IF NOT EXISTS failed_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS blocked_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMPTZ;

UPDATE public.email_verification_codes
SET code_hash = encode(digest(code, 'sha256'), 'hex')
WHERE code_hash IS NULL AND code IS NOT NULL;

ALTER TABLE public.email_verification_codes
  ALTER COLUMN code DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_otp_lookup_secure
  ON public.email_verification_codes(email, otp_context, verified, expires_at);

CREATE TABLE IF NOT EXISTS public.otp_rate_limit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type TEXT NOT NULL CHECK (scope_type IN ('ip', 'email', 'document')),
  scope_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_otp_rate_limit_events_scope_window
  ON public.otp_rate_limit_events(scope_type, scope_key, created_at DESC);

CREATE TABLE IF NOT EXISTS public.otp_rate_limit_blocks (
  scope_type TEXT NOT NULL CHECK (scope_type IN ('ip', 'email', 'document')),
  scope_key TEXT NOT NULL,
  blocked_until TIMESTAMPTZ NOT NULL,
  level INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_type, scope_key)
);

CREATE OR REPLACE FUNCTION public.register_otp_rate_limit_event(
  p_scope_type TEXT,
  p_scope_key TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INTEGER;
  v_level INTEGER;
  v_block_minutes INTEGER;
BEGIN
  IF p_scope_key IS NULL OR length(trim(p_scope_key)) = 0 THEN
    RETURN;
  END IF;

  INSERT INTO public.otp_rate_limit_events(scope_type, scope_key)
  VALUES (p_scope_type, p_scope_key);

  SELECT COUNT(*) INTO v_count
  FROM public.otp_rate_limit_events
  WHERE scope_type = p_scope_type
    AND scope_key = p_scope_key
    AND created_at >= now() - interval '1 hour';

  IF v_count > 5 THEN
    SELECT COALESCE(level, 0) + 1 INTO v_level
    FROM public.otp_rate_limit_blocks
    WHERE scope_type = p_scope_type
      AND scope_key = p_scope_key
    FOR UPDATE;

    v_level := COALESCE(v_level, 1);
    v_block_minutes := LEAST(60, 2 ^ v_level);

    INSERT INTO public.otp_rate_limit_blocks(scope_type, scope_key, blocked_until, level)
    VALUES (p_scope_type, p_scope_key, now() + make_interval(mins => v_block_minutes), v_level)
    ON CONFLICT (scope_type, scope_key)
    DO UPDATE SET
      blocked_until = EXCLUDED.blocked_until,
      level = EXCLUDED.level,
      updated_at = now();
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_otp_rate_limited(
  p_ip_hash TEXT,
  p_email TEXT,
  p_document_hash TEXT
)
RETURNS TABLE(allowed BOOLEAN, retry_after_seconds INTEGER)
LANGUAGE plpgsql
AS $$
DECLARE
  v_retry INTEGER := 0;
  v_now TIMESTAMPTZ := now();
BEGIN
  allowed := TRUE;

  SELECT GREATEST(v_retry, COALESCE(EXTRACT(EPOCH FROM (blocked_until - v_now))::INTEGER, 0))
    INTO v_retry
  FROM public.otp_rate_limit_blocks
  WHERE scope_type = 'ip' AND scope_key = COALESCE(p_ip_hash, '') AND blocked_until > v_now;

  SELECT GREATEST(v_retry, COALESCE(EXTRACT(EPOCH FROM (blocked_until - v_now))::INTEGER, 0))
    INTO v_retry
  FROM public.otp_rate_limit_blocks
  WHERE scope_type = 'email' AND scope_key = lower(COALESCE(p_email, '')) AND blocked_until > v_now;

  SELECT GREATEST(v_retry, COALESCE(EXTRACT(EPOCH FROM (blocked_until - v_now))::INTEGER, 0))
    INTO v_retry
  FROM public.otp_rate_limit_blocks
  WHERE scope_type = 'document' AND scope_key = COALESCE(p_document_hash, '') AND blocked_until > v_now;

  IF v_retry > 0 THEN
    allowed := FALSE;
    retry_after_seconds := v_retry;
    RETURN NEXT;
    RETURN;
  END IF;

  retry_after_seconds := 0;
  RETURN NEXT;
END;
$$;


ALTER TABLE public.validacoes_otp
  ADD COLUMN IF NOT EXISTS codigo_otp_hash TEXT,
  ADD COLUMN IF NOT EXISTS source_ip_hash TEXT,
  ADD COLUMN IF NOT EXISTS blocked_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMPTZ;

UPDATE public.validacoes_otp
SET codigo_otp_hash = encode(digest(codigo_otp, 'sha256'), 'hex')
WHERE codigo_otp_hash IS NULL AND codigo_otp IS NOT NULL;

-- 3) Fencing token on outbox lease
ALTER TABLE public.message_outbox
  ADD COLUMN IF NOT EXISTS lease_version BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS campaign_job_id UUID;

-- 4) Inbox pattern for inbound webhook dedupe
CREATE TABLE IF NOT EXISTS public.inbound_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  instance_id UUID NOT NULL,
  provider_message_id TEXT NOT NULL,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, instance_id, provider_message_id)
);

CREATE INDEX IF NOT EXISTS idx_inbound_events_created_at
  ON public.inbound_events(created_at DESC);

-- 5) Tenant + instance token bucket
CREATE TABLE IF NOT EXISTS public.tenant_rate_limits (
  tenant_id UUID NOT NULL,
  instance_id UUID NOT NULL,
  tokens INTEGER NOT NULL DEFAULT 0,
  capacity INTEGER NOT NULL DEFAULT 20,
  refill_per_second NUMERIC NOT NULL DEFAULT 2,
  last_refill TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, instance_id)
);

CREATE OR REPLACE FUNCTION public.consume_token(
  p_tenant_id UUID,
  p_instance_id UUID,
  p_amount INTEGER DEFAULT 1
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_now TIMESTAMPTZ := now();
  v_row public.tenant_rate_limits;
  v_elapsed NUMERIC;
  v_refilled NUMERIC;
BEGIN
  INSERT INTO public.tenant_rate_limits(tenant_id, instance_id, tokens, capacity, refill_per_second, last_refill, updated_at)
  VALUES (p_tenant_id, p_instance_id, 20, 20, 2, v_now, v_now)
  ON CONFLICT (tenant_id, instance_id) DO NOTHING;

  SELECT * INTO v_row
  FROM public.tenant_rate_limits
  WHERE tenant_id = p_tenant_id
    AND instance_id = p_instance_id
  FOR UPDATE;

  v_elapsed := GREATEST(0, EXTRACT(EPOCH FROM (v_now - v_row.last_refill)));
  v_refilled := LEAST(v_row.capacity::NUMERIC, v_row.tokens::NUMERIC + (v_elapsed * v_row.refill_per_second));

  IF v_refilled < p_amount THEN
    UPDATE public.tenant_rate_limits
    SET tokens = floor(v_refilled)::INTEGER,
        last_refill = v_now,
        updated_at = v_now
    WHERE tenant_id = p_tenant_id AND instance_id = p_instance_id;
    RETURN FALSE;
  END IF;

  UPDATE public.tenant_rate_limits
  SET tokens = floor(v_refilled - p_amount)::INTEGER,
      last_refill = v_now,
      updated_at = v_now
  WHERE tenant_id = p_tenant_id AND instance_id = p_instance_id;

  RETURN TRUE;
END;
$$;

-- 6) Massive campaign structures
CREATE TABLE IF NOT EXISTS public.campaign_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  instance_id UUID NOT NULL REFERENCES public.whatsapp_instancias(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'paused', 'cancelled', 'completed')),
  payload_template JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.campaign_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_job_id UUID NOT NULL REFERENCES public.campaign_jobs(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,
  destination TEXT NOT NULL,
  reference TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  outbox_id UUID REFERENCES public.message_outbox(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'queued', 'sending', 'sent', 'failed', 'cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_job_id, reference)
);

CREATE INDEX IF NOT EXISTS idx_campaign_jobs_tenant_status
  ON public.campaign_jobs(tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_campaign_recipients_claim
  ON public.campaign_recipients(campaign_job_id, status, created_at);

ALTER TABLE public.message_outbox
  ADD CONSTRAINT fk_message_outbox_campaign_job
  FOREIGN KEY (campaign_job_id) REFERENCES public.campaign_jobs(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.claim_message_outbox_with_lease(
  p_batch_size INTEGER,
  p_worker_id TEXT,
  p_lease_seconds INTEGER,
  p_tenant_capacity INTEGER,
  p_tenant_refill_per_second NUMERIC,
  p_instance_capacity INTEGER,
  p_instance_refill_per_second NUMERIC
)
RETURNS SETOF public.message_outbox
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH candidate AS (
    SELECT mo.id
    FROM public.message_outbox mo
    LEFT JOIN public.campaign_jobs cj ON cj.id = mo.campaign_job_id
    WHERE mo.status IN ('pending', 'retry')
      AND (mo.next_retry_at IS NULL OR mo.next_retry_at <= now())
      AND (mo.lease_until IS NULL OR mo.lease_until < now())
      AND (cj.id IS NULL OR cj.status IN ('pending', 'running'))
    ORDER BY mo.created_at
    LIMIT (p_batch_size * 3)
    FOR UPDATE SKIP LOCKED
  ), allowed AS (
    SELECT mo.id
    FROM public.message_outbox mo
    JOIN candidate c ON c.id = mo.id
    WHERE public.consume_rate_limit_tokens_pair(
      mo.tenant_id,
      COALESCE(mo.payload->>'instanceId', 'default'),
      p_tenant_capacity,
      p_tenant_refill_per_second,
      p_instance_capacity,
      p_instance_refill_per_second,
      1
    )
    LIMIT p_batch_size
  )
  UPDATE public.message_outbox mo
  SET status = 'sending',
      attempts = mo.attempts + 1,
      worker_id = p_worker_id,
      lease_until = now() + make_interval(secs => p_lease_seconds),
      lease_version = mo.lease_version + 1,
      last_error = NULL,
      updated_at = now()
  FROM allowed
  WHERE mo.id = allowed.id
  RETURNING mo.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_outbox_accepted(
  p_id UUID,
  p_worker_id TEXT,
  p_lease_version BIGINT,
  p_provider_message_id TEXT,
  p_provider_response JSONB DEFAULT '{}'::jsonb
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE v_updated INTEGER;
BEGIN
  UPDATE public.message_outbox
  SET status = 'accepted',
      provider_message_id = COALESCE(p_provider_message_id, provider_message_id),
      provider_response = p_provider_response,
      accepted_at = now(),
      lease_until = NULL,
      worker_id = NULL,
      next_retry_at = NULL,
      last_error = NULL,
      updated_at = now()
  WHERE id = p_id
    AND status = 'sending'
    AND worker_id = p_worker_id
    AND lease_version = p_lease_version
    AND lease_until IS NOT NULL
    AND lease_until >= now();

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.reschedule_outbox_retry(
  p_id UUID,
  p_worker_id TEXT,
  p_lease_version BIGINT,
  p_next_retry_at TIMESTAMPTZ,
  p_error TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE v_updated INTEGER;
BEGIN
  UPDATE public.message_outbox
  SET status = 'retry',
      next_retry_at = p_next_retry_at,
      last_error = p_error,
      lease_until = NULL,
      worker_id = NULL,
      updated_at = now()
  WHERE id = p_id
    AND status = 'sending'
    AND worker_id = p_worker_id
    AND lease_version = p_lease_version
    AND lease_until IS NOT NULL
    AND lease_until >= now();

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.move_outbox_dead_letter(
  p_id UUID,
  p_worker_id TEXT,
  p_lease_version BIGINT,
  p_error TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE v_updated INTEGER;
BEGIN
  UPDATE public.message_outbox
  SET status = 'dead_letter',
      dead_lettered_at = now(),
      dead_letter_reason = p_error,
      last_error = p_error,
      lease_until = NULL,
      worker_id = NULL,
      updated_at = now()
  WHERE id = p_id
    AND status = 'sending'
    AND worker_id = p_worker_id
    AND lease_version = p_lease_version
    AND lease_until IS NOT NULL
    AND lease_until >= now();

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;


CREATE OR REPLACE FUNCTION public.finalize_completed_campaign_jobs()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  WITH done AS (
    SELECT cj.id
    FROM public.campaign_jobs cj
    WHERE cj.status IN ('running', 'pending')
      AND NOT EXISTS (
        SELECT 1
        FROM public.campaign_recipients cr
        WHERE cr.campaign_job_id = cj.id
          AND cr.status IN ('pending', 'queued', 'sending')
      )
  )
  UPDATE public.campaign_jobs cj
  SET status = 'completed',
      completed_at = now(),
      updated_at = now()
  FROM done
  WHERE cj.id = done.id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
