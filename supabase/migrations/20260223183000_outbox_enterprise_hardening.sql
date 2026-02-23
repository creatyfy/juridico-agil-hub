-- Outbox enterprise hardening: lease ownership, two-phase confirmation, atomic throttling,
-- distributed circuit breaker, dead-letter lifecycle.

ALTER TABLE public.message_outbox
  ADD COLUMN IF NOT EXISTS lease_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS worker_id TEXT,
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS provider_message_id TEXT,
  ADD COLUMN IF NOT EXISTS provider_response JSONB,
  ADD COLUMN IF NOT EXISTS dead_lettered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dead_letter_reason TEXT;

DO $$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT conname INTO v_constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.message_outbox'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%status IN%';

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.message_outbox DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END $$;

ALTER TABLE public.message_outbox
  ADD CONSTRAINT message_outbox_status_check
  CHECK (status IN ('pending', 'sending', 'accepted', 'delivered', 'retry', 'dead_letter'));

CREATE INDEX IF NOT EXISTS idx_message_outbox_delivery_lookup
  ON public.message_outbox(provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_message_outbox_lease
  ON public.message_outbox(status, lease_until, next_retry_at, created_at);

CREATE TABLE IF NOT EXISTS public.outbox_dead_letter_reprocess_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  outbox_id UUID NOT NULL REFERENCES public.message_outbox(id) ON DELETE CASCADE,
  reprocessed_by UUID,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.provider_circuit_breaker_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,
  tenant_id UUID NOT NULL,
  success BOOLEAN NOT NULL,
  status_code INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.provider_circuit_breakers (
  provider TEXT NOT NULL,
  tenant_id UUID NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('closed', 'open', 'half_open')),
  window_seconds INTEGER NOT NULL DEFAULT 60,
  failure_threshold INTEGER NOT NULL DEFAULT 8,
  cool_down_seconds INTEGER NOT NULL DEFAULT 30,
  half_open_probe_limit INTEGER NOT NULL DEFAULT 3,
  opened_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_provider_circuit_events_query
  ON public.provider_circuit_breaker_events(provider, tenant_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.consume_rate_limit_tokens_pair(
  p_tenant_id UUID,
  p_instance_key TEXT,
  p_tenant_capacity INTEGER,
  p_tenant_refill_per_second NUMERIC,
  p_instance_capacity INTEGER,
  p_instance_refill_per_second NUMERIC,
  p_amount NUMERIC DEFAULT 1
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_now TIMESTAMPTZ := now();
  v_tenant public.outbound_rate_limits;
  v_instance public.outbound_rate_limits;
  v_tenant_tokens NUMERIC;
  v_instance_tokens NUMERIC;
  v_tenant_seconds NUMERIC;
  v_instance_seconds NUMERIC;
BEGIN
  INSERT INTO public.outbound_rate_limits (tenant_id, scope_type, scope_key, tokens, capacity, refill_per_second, last_refill_at, updated_at)
  VALUES (p_tenant_id, 'instance', p_instance_key, p_instance_capacity, p_instance_capacity, p_instance_refill_per_second, v_now, v_now)
  ON CONFLICT (tenant_id, scope_type, scope_key) DO NOTHING;

  INSERT INTO public.outbound_rate_limits (tenant_id, scope_type, scope_key, tokens, capacity, refill_per_second, last_refill_at, updated_at)
  VALUES (p_tenant_id, 'tenant', p_tenant_id::text, p_tenant_capacity, p_tenant_capacity, p_tenant_refill_per_second, v_now, v_now)
  ON CONFLICT (tenant_id, scope_type, scope_key) DO NOTHING;

  SELECT * INTO v_instance
  FROM public.outbound_rate_limits
  WHERE tenant_id = p_tenant_id AND scope_type = 'instance' AND scope_key = p_instance_key
  FOR UPDATE;

  SELECT * INTO v_tenant
  FROM public.outbound_rate_limits
  WHERE tenant_id = p_tenant_id AND scope_type = 'tenant' AND scope_key = p_tenant_id::text
  FOR UPDATE;

  v_instance_seconds := EXTRACT(EPOCH FROM (v_now - v_instance.last_refill_at));
  v_tenant_seconds := EXTRACT(EPOCH FROM (v_now - v_tenant.last_refill_at));

  v_instance_tokens := LEAST(v_instance.capacity, v_instance.tokens + (v_instance_seconds * v_instance.refill_per_second));
  v_tenant_tokens := LEAST(v_tenant.capacity, v_tenant.tokens + (v_tenant_seconds * v_tenant.refill_per_second));

  IF v_instance_tokens < p_amount OR v_tenant_tokens < p_amount THEN
    UPDATE public.outbound_rate_limits
    SET tokens = v_instance_tokens, last_refill_at = v_now, updated_at = v_now
    WHERE id = v_instance.id;

    UPDATE public.outbound_rate_limits
    SET tokens = v_tenant_tokens, last_refill_at = v_now, updated_at = v_now
    WHERE id = v_tenant.id;

    RETURN FALSE;
  END IF;

  UPDATE public.outbound_rate_limits
  SET tokens = v_instance_tokens - p_amount, last_refill_at = v_now, updated_at = v_now
  WHERE id = v_instance.id;

  UPDATE public.outbound_rate_limits
  SET tokens = v_tenant_tokens - p_amount, last_refill_at = v_now, updated_at = v_now
  WHERE id = v_tenant.id;

  RETURN TRUE;
END;
$$;

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
    WHERE mo.status IN ('pending', 'retry')
      AND (mo.next_retry_at IS NULL OR mo.next_retry_at <= now())
      AND (mo.lease_until IS NULL OR mo.lease_until < now())
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
      last_error = NULL,
      updated_at = now()
  FROM allowed
  WHERE mo.id = allowed.id
  RETURNING mo.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.reap_orphaned_outbox_messages(
  p_limit INTEGER DEFAULT 100,
  p_retry_delay_seconds INTEGER DEFAULT 5
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  WITH orphaned AS (
    SELECT id
    FROM public.message_outbox
    WHERE status = 'sending'
      AND lease_until IS NOT NULL
      AND lease_until < now()
    ORDER BY lease_until
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.message_outbox mo
  SET status = 'retry',
      worker_id = NULL,
      lease_until = NULL,
      next_retry_at = now() + make_interval(secs => p_retry_delay_seconds),
      last_error = COALESCE(mo.last_error, 'lease_expired_reaped'),
      updated_at = now()
  FROM orphaned
  WHERE mo.id = orphaned.id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_outbox_accepted(
  p_id UUID,
  p_worker_id TEXT,
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
    AND lease_until IS NOT NULL
    AND lease_until >= now();

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.reschedule_outbox_retry(
  p_id UUID,
  p_worker_id TEXT,
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
    AND lease_until IS NOT NULL
    AND lease_until >= now();

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.move_outbox_dead_letter(
  p_id UUID,
  p_worker_id TEXT,
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
    AND lease_until IS NOT NULL
    AND lease_until >= now();

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_outbox_delivered(
  p_provider_message_id TEXT,
  p_provider_response JSONB DEFAULT '{}'::jsonb
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE v_count INTEGER;
BEGIN
  UPDATE public.message_outbox
  SET status = 'delivered',
      delivered_at = now(),
      provider_response = COALESCE(provider_response, '{}'::jsonb) || p_provider_response,
      updated_at = now()
  WHERE provider_message_id = p_provider_message_id
    AND status = 'accepted';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.reprocess_outbox_dead_letter(
  p_id UUID,
  p_user_id UUID,
  p_reason TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE v_updated INTEGER;
BEGIN
  UPDATE public.message_outbox
  SET status = 'retry',
      next_retry_at = now(),
      last_error = NULL,
      dead_lettered_at = NULL,
      dead_letter_reason = NULL,
      worker_id = NULL,
      lease_until = NULL,
      updated_at = now()
  WHERE id = p_id
    AND status = 'dead_letter';

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 1 THEN
    INSERT INTO public.outbox_dead_letter_reprocess_log (outbox_id, reprocessed_by, reason)
    VALUES (p_id, p_user_id, p_reason);
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

CREATE OR REPLACE VIEW public.v_outbox_dead_letter_growth AS
SELECT tenant_id,
       date_trunc('hour', dead_lettered_at) AS bucket,
       COUNT(*) AS dead_letter_count
FROM public.message_outbox
WHERE status = 'dead_letter'
  AND dead_lettered_at IS NOT NULL
GROUP BY tenant_id, date_trunc('hour', dead_lettered_at);

CREATE OR REPLACE FUNCTION public.prune_outbox_dead_letters(p_retention_days INTEGER)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE v_count INTEGER;
BEGIN
  DELETE FROM public.message_outbox
  WHERE status = 'dead_letter'
    AND dead_lettered_at IS NOT NULL
    AND dead_lettered_at < now() - make_interval(days => p_retention_days);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.judit_circuit_allow(p_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_state public.provider_circuit_breakers;
BEGIN
  INSERT INTO public.provider_circuit_breakers (provider, tenant_id, state)
  VALUES ('judit', p_tenant_id, 'closed')
  ON CONFLICT (provider, tenant_id) DO NOTHING;

  SELECT * INTO v_state
  FROM public.provider_circuit_breakers
  WHERE provider = 'judit' AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF v_state.state = 'open' AND v_state.opened_at IS NOT NULL
     AND now() - v_state.opened_at < make_interval(secs => v_state.cool_down_seconds) THEN
    RETURN FALSE;
  END IF;

  IF v_state.state = 'open' THEN
    UPDATE public.provider_circuit_breakers
    SET state = 'half_open', updated_at = now()
    WHERE provider = 'judit' AND tenant_id = p_tenant_id;
  END IF;

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.judit_circuit_record(
  p_tenant_id UUID,
  p_success BOOLEAN,
  p_status_code INTEGER DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_state public.provider_circuit_breakers;
  v_failures INTEGER;
  v_half_open_failures INTEGER;
BEGIN
  INSERT INTO public.provider_circuit_breaker_events(provider, tenant_id, success, status_code)
  VALUES ('judit', p_tenant_id, p_success, p_status_code);

  INSERT INTO public.provider_circuit_breakers (provider, tenant_id, state)
  VALUES ('judit', p_tenant_id, 'closed')
  ON CONFLICT (provider, tenant_id) DO NOTHING;

  SELECT * INTO v_state
  FROM public.provider_circuit_breakers
  WHERE provider = 'judit' AND tenant_id = p_tenant_id
  FOR UPDATE;

  SELECT COUNT(*) INTO v_failures
  FROM public.provider_circuit_breaker_events
  WHERE provider = 'judit'
    AND tenant_id = p_tenant_id
    AND success = FALSE
    AND created_at >= now() - make_interval(secs => v_state.window_seconds);

  IF p_success THEN
    IF v_state.state = 'half_open' THEN
      UPDATE public.provider_circuit_breakers
      SET state = 'closed', opened_at = NULL, updated_at = now()
      WHERE provider = 'judit' AND tenant_id = p_tenant_id;
    ELSIF v_failures = 0 THEN
      UPDATE public.provider_circuit_breakers
      SET state = 'closed', opened_at = NULL, updated_at = now()
      WHERE provider = 'judit' AND tenant_id = p_tenant_id;
    END IF;
    RETURN;
  END IF;

  IF v_state.state = 'half_open' THEN
    SELECT COUNT(*) INTO v_half_open_failures
    FROM public.provider_circuit_breaker_events
    WHERE provider = 'judit'
      AND tenant_id = p_tenant_id
      AND success = FALSE
      AND created_at >= now() - make_interval(secs => v_state.cool_down_seconds);

    IF v_half_open_failures >= 1 THEN
      UPDATE public.provider_circuit_breakers
      SET state = 'open', opened_at = now(), updated_at = now()
      WHERE provider = 'judit' AND tenant_id = p_tenant_id;
    END IF;
    RETURN;
  END IF;

  IF v_failures >= v_state.failure_threshold THEN
    UPDATE public.provider_circuit_breakers
    SET state = 'open', opened_at = now(), updated_at = now()
    WHERE provider = 'judit' AND tenant_id = p_tenant_id;
  END IF;
END;
$$;
