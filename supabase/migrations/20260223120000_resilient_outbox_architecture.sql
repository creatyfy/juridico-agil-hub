CREATE TABLE IF NOT EXISTS public.message_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id UUID NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'retry', 'failed', 'dead_letter')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_message_outbox_claim
  ON public.message_outbox(status, next_retry_at, created_at);

CREATE TABLE IF NOT EXISTS public.outbound_rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('tenant', 'instance')),
  scope_key TEXT NOT NULL,
  tokens NUMERIC NOT NULL,
  capacity INTEGER NOT NULL,
  refill_per_second NUMERIC NOT NULL,
  last_refill_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, scope_type, scope_key)
);

CREATE OR REPLACE FUNCTION public.touch_updated_at_message_outbox()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_updated_at_message_outbox ON public.message_outbox;
CREATE TRIGGER trg_touch_updated_at_message_outbox
BEFORE UPDATE ON public.message_outbox
FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at_message_outbox();

CREATE OR REPLACE FUNCTION public.claim_message_outbox(batch_size INTEGER DEFAULT 20)
RETURNS SETOF public.message_outbox
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
    WITH claim AS (
      SELECT id
      FROM public.message_outbox
      WHERE status IN ('pending', 'retry')
        AND (next_retry_at IS NULL OR next_retry_at <= now())
      ORDER BY created_at
      LIMIT batch_size
      FOR UPDATE SKIP LOCKED
    )
    UPDATE public.message_outbox mo
      SET status = 'sending',
          attempts = mo.attempts + 1,
          updated_at = now()
    FROM claim
    WHERE mo.id = claim.id
    RETURNING mo.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_rate_limit_tokens(
  p_tenant_id UUID,
  p_scope_type TEXT,
  p_scope_key TEXT,
  p_capacity INTEGER,
  p_refill_per_second NUMERIC,
  p_amount NUMERIC DEFAULT 1
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_row public.outbound_rate_limits;
  v_now TIMESTAMPTZ := now();
  v_seconds NUMERIC;
  v_tokens NUMERIC;
BEGIN
  INSERT INTO public.outbound_rate_limits (
    tenant_id, scope_type, scope_key, tokens, capacity, refill_per_second, last_refill_at, updated_at
  )
  VALUES (
    p_tenant_id, p_scope_type, p_scope_key, p_capacity, p_capacity, p_refill_per_second, v_now, v_now
  )
  ON CONFLICT (tenant_id, scope_type, scope_key) DO NOTHING;

  SELECT * INTO v_row
  FROM public.outbound_rate_limits
  WHERE tenant_id = p_tenant_id
    AND scope_type = p_scope_type
    AND scope_key = p_scope_key
  FOR UPDATE;

  v_seconds := EXTRACT(EPOCH FROM (v_now - v_row.last_refill_at));
  v_tokens := LEAST(v_row.capacity, v_row.tokens + (v_seconds * v_row.refill_per_second));

  IF v_tokens < p_amount THEN
    UPDATE public.outbound_rate_limits
    SET tokens = v_tokens,
        last_refill_at = v_now,
        updated_at = v_now
    WHERE id = v_row.id;
    RETURN FALSE;
  END IF;

  UPDATE public.outbound_rate_limits
  SET tokens = v_tokens - p_amount,
      last_refill_at = v_now,
      updated_at = v_now
  WHERE id = v_row.id;

  RETURN TRUE;
END;
$$;
