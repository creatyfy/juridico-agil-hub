CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Notification architecture v2: immutable event intent + attempts + lease-based claiming + robust retries.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'notification_delivery_state'
  ) THEN
    CREATE TYPE public.notification_delivery_state AS ENUM (
      'pending',
      'processing',
      'retry_scheduled',
      'sent',
      'dead_letter'
    );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.notification_events (
  event_id TEXT PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  process_id UUID NOT NULL REFERENCES public.processos(id) ON DELETE CASCADE,
  movement_id UUID,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  state public.notification_delivery_state NOT NULL DEFAULT 'pending',
  correlation_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  provider_message_id TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  max_retries INTEGER NOT NULL DEFAULT 10 CHECK (max_retries >= 1),
  next_retry_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_until TIMESTAMPTZ,
  claimed_by TEXT,
  claimed_at TIMESTAMPTZ,
  last_error TEXT,
  error_class TEXT,
  unknown_outcome BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ,
  CONSTRAINT uq_notification_events_idempotency_key UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_notification_events_claim
  ON public.notification_events (tenant_id, next_retry_at, created_at)
  WHERE state IN ('pending', 'retry_scheduled');

CREATE INDEX IF NOT EXISTS idx_notification_events_processing_lease
  ON public.notification_events (lease_until)
  WHERE state = 'processing';

CREATE INDEX IF NOT EXISTS idx_notification_events_state_created
  ON public.notification_events (state, created_at);

CREATE INDEX IF NOT EXISTS idx_notification_events_correlation
  ON public.notification_events (correlation_id);

CREATE INDEX IF NOT EXISTS idx_notification_events_provider_message
  ON public.notification_events (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.notification_attempts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES public.notification_events(event_id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  attempt_no INTEGER NOT NULL CHECK (attempt_no >= 1),
  worker_id TEXT NOT NULL,
  lease_until TIMESTAMPTZ,
  request_payload JSONB,
  response_payload JSONB,
  http_status INTEGER,
  provider_message_id TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('sent', 'retry_scheduled', 'dead_letter', 'unknown_outcome')),
  error_class TEXT,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  latency_ms INTEGER,
  correlation_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_notification_attempts_event_attempt UNIQUE (event_id, attempt_no)
);

CREATE INDEX IF NOT EXISTS idx_notification_attempts_event ON public.notification_attempts (event_id, attempt_no DESC);
CREATE INDEX IF NOT EXISTS idx_notification_attempts_tenant_created ON public.notification_attempts (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_attempts_outcome ON public.notification_attempts (outcome, created_at DESC);

CREATE TABLE IF NOT EXISTS public.notification_reconciliation_issues (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id UUID,
  event_id TEXT,
  issue_type TEXT NOT NULL,
  issue_detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_notification_reconciliation_open
  ON public.notification_reconciliation_issues (issue_type, detected_at)
  WHERE resolved_at IS NULL;

CREATE OR REPLACE FUNCTION public.touch_notification_event_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_notification_events_updated_at ON public.notification_events;
CREATE TRIGGER trg_touch_notification_events_updated_at
BEFORE UPDATE ON public.notification_events
FOR EACH ROW
EXECUTE FUNCTION public.touch_notification_event_updated_at();

CREATE OR REPLACE FUNCTION public.compute_notification_backoff_seconds(p_retry_count INTEGER)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT LEAST(
    3600,
    GREATEST(5, (2 ^ LEAST(GREATEST(p_retry_count, 0), 12))::INTEGER)
  ) + FLOOR(random() * 10)::INTEGER;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_process_movement_event(
  p_tenant_id UUID,
  p_process_id UUID,
  p_movement_id UUID,
  p_payload JSONB,
  p_correlation_id TEXT
)
RETURNS TABLE(event_id TEXT, inserted BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id TEXT;
  v_idempotency_key TEXT;
BEGIN
  v_event_id := encode(
    digest(
      concat_ws(':', p_tenant_id::text, p_process_id::text, coalesce(p_movement_id::text, 'nomovement'), 'nova_movimentacao'),
      'sha256'
    ),
    'hex'
  );

  v_idempotency_key := v_event_id;

  INSERT INTO public.notification_events (
    event_id,
    tenant_id,
    process_id,
    movement_id,
    event_type,
    payload,
    state,
    correlation_id,
    idempotency_key,
    next_retry_at
  )
  VALUES (
    v_event_id,
    p_tenant_id,
    p_process_id,
    p_movement_id,
    'process_movement_detected',
    COALESCE(p_payload, '{}'::jsonb),
    'pending',
    COALESCE(NULLIF(p_correlation_id, ''), v_event_id),
    v_idempotency_key,
    now()
  )
  ON CONFLICT (event_id) DO NOTHING;

  RETURN QUERY
  SELECT v_event_id, FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_notification_events(
  p_worker_id TEXT,
  p_batch_size INTEGER DEFAULT 100,
  p_lease_seconds INTEGER DEFAULT 60
)
RETURNS SETOF public.notification_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT ne.event_id
    FROM public.notification_events ne
    WHERE ne.state IN ('pending', 'retry_scheduled')
      AND ne.next_retry_at <= now()
    ORDER BY ne.next_retry_at ASC, ne.created_at ASC
    LIMIT GREATEST(1, p_batch_size)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.notification_events ne
  SET
    state = 'processing',
    lease_until = now() + make_interval(secs => GREATEST(5, p_lease_seconds)),
    claimed_by = p_worker_id,
    claimed_at = now()
  FROM candidates
  WHERE ne.event_id = candidates.event_id
  RETURNING ne.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_notification_attempt(
  p_event_id TEXT,
  p_worker_id TEXT,
  p_outcome TEXT,
  p_http_status INTEGER DEFAULT NULL,
  p_provider_message_id TEXT DEFAULT NULL,
  p_error_class TEXT DEFAULT NULL,
  p_error_message TEXT DEFAULT NULL,
  p_request_payload JSONB DEFAULT NULL,
  p_response_payload JSONB DEFAULT NULL,
  p_started_at TIMESTAMPTZ DEFAULT now(),
  p_finished_at TIMESTAMPTZ DEFAULT now()
)
RETURNS public.notification_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event public.notification_events;
  v_new_state public.notification_delivery_state;
  v_next_retry_at TIMESTAMPTZ;
  v_attempt_no INTEGER;
BEGIN
  SELECT * INTO v_event
  FROM public.notification_events
  WHERE event_id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'notification event % not found', p_event_id;
  END IF;

  IF v_event.state <> 'processing' THEN
    RAISE EXCEPTION 'event % is not in processing state (current %)', p_event_id, v_event.state;
  END IF;

  IF v_event.claimed_by IS DISTINCT FROM p_worker_id THEN
    RAISE EXCEPTION 'event % claimed by %, cannot be finalized by %', p_event_id, v_event.claimed_by, p_worker_id;
  END IF;

  v_attempt_no := v_event.retry_count + 1;

  IF p_outcome = 'sent' THEN
    v_new_state := 'sent';
    v_next_retry_at := NULL;
  ELSIF p_outcome = 'retry_scheduled' THEN
    v_new_state := CASE WHEN v_event.retry_count + 1 >= v_event.max_retries THEN 'dead_letter' ELSE 'retry_scheduled' END;
    v_next_retry_at := now() + make_interval(secs => public.compute_notification_backoff_seconds(v_event.retry_count + 1));
  ELSIF p_outcome = 'dead_letter' THEN
    v_new_state := 'dead_letter';
    v_next_retry_at := NULL;
  ELSIF p_outcome = 'unknown_outcome' THEN
    v_new_state := CASE WHEN v_event.retry_count + 1 >= v_event.max_retries THEN 'dead_letter' ELSE 'retry_scheduled' END;
    v_next_retry_at := now() + make_interval(secs => public.compute_notification_backoff_seconds(v_event.retry_count + 1));
  ELSE
    RAISE EXCEPTION 'invalid outcome: %', p_outcome;
  END IF;

  INSERT INTO public.notification_attempts (
    event_id,
    tenant_id,
    attempt_no,
    worker_id,
    lease_until,
    request_payload,
    response_payload,
    http_status,
    provider_message_id,
    outcome,
    error_class,
    error_message,
    started_at,
    finished_at,
    latency_ms,
    correlation_id
  )
  VALUES (
    v_event.event_id,
    v_event.tenant_id,
    v_attempt_no,
    p_worker_id,
    v_event.lease_until,
    p_request_payload,
    p_response_payload,
    p_http_status,
    p_provider_message_id,
    p_outcome,
    p_error_class,
    p_error_message,
    p_started_at,
    p_finished_at,
    GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (p_finished_at - p_started_at)) * 1000)::INTEGER),
    v_event.correlation_id
  );

  UPDATE public.notification_events
  SET
    state = v_new_state,
    retry_count = CASE WHEN p_outcome = 'sent' THEN retry_count ELSE retry_count + 1 END,
    next_retry_at = COALESCE(v_next_retry_at, next_retry_at),
    provider_message_id = COALESCE(p_provider_message_id, provider_message_id),
    error_class = p_error_class,
    last_error = p_error_message,
    unknown_outcome = (p_outcome = 'unknown_outcome'),
    sent_at = CASE WHEN v_new_state = 'sent' THEN now() ELSE sent_at END,
    lease_until = NULL,
    claimed_by = NULL,
    claimed_at = NULL
  WHERE event_id = v_event.event_id
  RETURNING * INTO v_event;

  RETURN v_event;
END;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_notification_events(
  p_processing_timeout_seconds INTEGER DEFAULT 300
)
RETURNS TABLE(expired_reclaimed INTEGER, stuck_marked INTEGER, duplicate_sent_detected INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expired_reclaimed INTEGER := 0;
  v_stuck_marked INTEGER := 0;
  v_duplicate_sent INTEGER := 0;
BEGIN
  WITH reclaimed AS (
    UPDATE public.notification_events ne
    SET
      state = 'retry_scheduled',
      lease_until = NULL,
      claimed_by = NULL,
      claimed_at = NULL,
      error_class = COALESCE(ne.error_class, 'lease_expired'),
      last_error = COALESCE(ne.last_error, 'lease expired and event was reclaimed'),
      next_retry_at = now() + interval '5 seconds'
    WHERE ne.state = 'processing'
      AND ne.lease_until IS NOT NULL
      AND ne.lease_until < now()
    RETURNING 1
  )
  SELECT count(*) INTO v_expired_reclaimed FROM reclaimed;

  WITH stuck AS (
    UPDATE public.notification_events ne
    SET
      state = 'retry_scheduled',
      lease_until = NULL,
      claimed_by = NULL,
      claimed_at = NULL,
      error_class = COALESCE(ne.error_class, 'processing_timeout'),
      last_error = COALESCE(ne.last_error, 'processing timeout detected by reconciler'),
      next_retry_at = now() + interval '10 seconds'
    WHERE ne.state = 'processing'
      AND ne.claimed_at < now() - make_interval(secs => GREATEST(60, p_processing_timeout_seconds))
    RETURNING 1
  )
  SELECT count(*) INTO v_stuck_marked FROM stuck;

  INSERT INTO public.notification_reconciliation_issues (tenant_id, event_id, issue_type, issue_detail)
  SELECT
    ne.tenant_id,
    ne.event_id,
    'duplicate_sent_attempt',
    jsonb_build_object(
      'provider_message_id', ne.provider_message_id,
      'attempts', count(*)
    )
  FROM public.notification_attempts na
  JOIN public.notification_events ne ON ne.event_id = na.event_id
  WHERE na.outcome = 'sent'
  GROUP BY ne.tenant_id, ne.event_id, ne.provider_message_id
  HAVING count(*) > 1;

  GET DIAGNOSTICS v_duplicate_sent = ROW_COUNT;

  RETURN QUERY SELECT v_expired_reclaimed, v_stuck_marked, v_duplicate_sent;
END;
$$;
