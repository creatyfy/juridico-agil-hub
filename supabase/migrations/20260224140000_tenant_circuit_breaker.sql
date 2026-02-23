-- Automatic tenant-level circuit breaker based on operational metrics

CREATE TABLE IF NOT EXISTS public.tenants (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'degraded', 'suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tenant_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('circuit_open', 'circuit_close')),
  reason JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenant_events_tenant_created_at
  ON public.tenant_events(tenant_id, created_at DESC);

INSERT INTO public.tenants (id)
SELECT DISTINCT user_id
FROM public.whatsapp_instancias
WHERE user_id IS NOT NULL
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.tenants (id)
SELECT DISTINCT tenant_id
FROM public.message_outbox
WHERE tenant_id IS NOT NULL
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.set_tenants_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_tenants_updated_at ON public.tenants;
CREATE TRIGGER trg_tenants_updated_at
BEFORE UPDATE ON public.tenants
FOR EACH ROW
EXECUTE FUNCTION public.set_tenants_updated_at();

CREATE OR REPLACE FUNCTION public.apply_tenant_circuit_breaker(
  p_tenant_id UUID,
  p_correlation_id TEXT,
  p_success_rate_percent NUMERIC,
  p_dead_letter_rate_percent NUMERIC,
  p_retry_rate_percent NUMERIC,
  p_backlog_age_seconds NUMERIC,
  p_cooldown_seconds INTEGER DEFAULT 600
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
  v_opened_at TIMESTAMPTZ;
  v_degraded BOOLEAN;
  v_reason JSONB;
  v_now TIMESTAMPTZ := now();
  v_result JSONB := jsonb_build_object('tenant_id', p_tenant_id, 'action', 'noop');
BEGIN
  IF p_tenant_id IS NULL THEN
    RETURN jsonb_build_object('action', 'noop', 'reason', 'missing_tenant_id');
  END IF;

  INSERT INTO public.tenants (id, status)
  VALUES (p_tenant_id, 'active')
  ON CONFLICT (id) DO NOTHING;

  SELECT status
  INTO v_status
  FROM public.tenants
  WHERE id = p_tenant_id
  FOR UPDATE;

  v_degraded := (
    COALESCE(p_success_rate_percent, 100) < 95
    OR COALESCE(p_dead_letter_rate_percent, 0) > 2
    OR COALESCE(p_retry_rate_percent, 0) > 5
    OR COALESCE(p_backlog_age_seconds, 0) > 120
  );

  v_reason := jsonb_build_object(
    'correlation_id', p_correlation_id,
    'thresholds', jsonb_build_object(
      'success_rate_min_percent', 95,
      'dead_letter_rate_max_percent', 2,
      'retry_rate_max_percent', 5,
      'backlog_age_max_seconds', 120
    ),
    'metrics', jsonb_build_object(
      'success_rate_percent', p_success_rate_percent,
      'dead_letter_rate_percent', p_dead_letter_rate_percent,
      'retry_rate_percent', p_retry_rate_percent,
      'backlog_age_seconds', p_backlog_age_seconds
    )
  );

  IF v_status = 'suspended' THEN
    RETURN jsonb_build_object('tenant_id', p_tenant_id, 'action', 'noop', 'status', v_status, 'reason', 'tenant_suspended');
  END IF;

  IF v_degraded AND v_status <> 'degraded' THEN
    UPDATE public.tenants
    SET status = 'degraded'
    WHERE id = p_tenant_id
      AND status <> 'degraded';

    INSERT INTO public.tenant_events (tenant_id, type, reason)
    VALUES (p_tenant_id, 'circuit_open', v_reason);

    RETURN jsonb_build_object('tenant_id', p_tenant_id, 'action', 'opened', 'status', 'degraded', 'reason', v_reason);
  END IF;

  IF NOT v_degraded AND v_status = 'degraded' THEN
    SELECT created_at
    INTO v_opened_at
    FROM public.tenant_events
    WHERE tenant_id = p_tenant_id
      AND type = 'circuit_open'
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_opened_at IS NOT NULL AND (v_now - v_opened_at) >= make_interval(secs => p_cooldown_seconds) THEN
      UPDATE public.tenants
      SET status = 'active'
      WHERE id = p_tenant_id
        AND status = 'degraded';

      INSERT INTO public.tenant_events (tenant_id, type, reason)
      VALUES (p_tenant_id, 'circuit_close', v_reason || jsonb_build_object('opened_at', v_opened_at));

      RETURN jsonb_build_object('tenant_id', p_tenant_id, 'action', 'closed', 'status', 'active', 'reason', v_reason);
    END IF;
  END IF;

  RETURN jsonb_build_object('tenant_id', p_tenant_id, 'action', 'noop', 'status', v_status, 'degraded', v_degraded);
END;
$$;

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own tenant" ON public.tenants;
CREATE POLICY "Users can view own tenant"
ON public.tenants
FOR SELECT
USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can view own tenant events" ON public.tenant_events;
CREATE POLICY "Users can view own tenant events"
ON public.tenant_events
FOR SELECT
USING (auth.uid() = tenant_id);

GRANT EXECUTE ON FUNCTION public.apply_tenant_circuit_breaker(UUID, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, INTEGER) TO service_role;
