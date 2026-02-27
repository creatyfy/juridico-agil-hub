-- Enterprise event-driven architecture: domain events, inbox, conversation locks,
-- retry/dead-letter lifecycle, LGPD retention and cron orchestration.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

ALTER TABLE public.message_outbox
  ADD COLUMN IF NOT EXISTS accepted_reconciled_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.domain_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  dedupe_key TEXT,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'processed', 'retry', 'dead_letter')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_retry_at TIMESTAMPTZ,
  last_error TEXT,
  worker_id TEXT,
  lease_until TIMESTAMPTZ,
  lease_version BIGINT NOT NULL DEFAULT 0,
  processing_started_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  dead_lettered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_domain_events_dedupe
  ON public.domain_events(tenant_id, event_type, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_domain_events_claim
  ON public.domain_events(status, next_retry_at, created_at)
  WHERE status IN ('pending', 'retry');

CREATE INDEX IF NOT EXISTS idx_domain_events_tenant_created
  ON public.domain_events(tenant_id, created_at DESC);

ALTER TABLE public.domain_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own tenant domain events" ON public.domain_events;
CREATE POLICY "Users can read own tenant domain events"
ON public.domain_events FOR SELECT
TO authenticated
USING (tenant_id = auth.uid());

DROP POLICY IF EXISTS "Service role full access domain events" ON public.domain_events;
CREATE POLICY "Service role full access domain events"
ON public.domain_events FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.inbound_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  instance_id UUID NOT NULL REFERENCES public.whatsapp_instancias(id) ON DELETE CASCADE,
  provider_message_id TEXT NOT NULL,
  phone TEXT NOT NULL,
  payload_raw JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, instance_id, provider_message_id)
);

CREATE INDEX IF NOT EXISTS idx_inbound_messages_tenant_phone_created
  ON public.inbound_messages(tenant_id, phone, created_at);

ALTER TABLE public.inbound_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own inbound messages" ON public.inbound_messages;
CREATE POLICY "Users can read own inbound messages"
ON public.inbound_messages FOR SELECT
TO authenticated
USING (tenant_id = auth.uid());

DROP POLICY IF EXISTS "Service role full access inbound messages" ON public.inbound_messages;
CREATE POLICY "Service role full access inbound messages"
ON public.inbound_messages FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.conversation_processing_locks (
  tenant_id UUID NOT NULL,
  phone TEXT NOT NULL,
  worker_id TEXT,
  lease_until TIMESTAMPTZ,
  fence_token BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, phone)
);

ALTER TABLE public.conversation_processing_locks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access conversation processing locks" ON public.conversation_processing_locks;
CREATE POLICY "Service role full access conversation processing locks"
ON public.conversation_processing_locks FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.worker_processing_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_name TEXT NOT NULL,
  event_id UUID,
  tenant_id UUID,
  event_type TEXT,
  status TEXT NOT NULL,
  retries INTEGER NOT NULL DEFAULT 0,
  processing_ms INTEGER,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_worker_metrics_worker_created
  ON public.worker_processing_metrics(worker_name, created_at DESC);

ALTER TABLE public.worker_processing_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access worker metrics" ON public.worker_processing_metrics;
CREATE POLICY "Service role full access worker metrics"
ON public.worker_processing_metrics FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.claim_domain_events(
  p_worker_id TEXT,
  p_batch_size INTEGER DEFAULT 20,
  p_lease_seconds INTEGER DEFAULT 45,
  p_event_types TEXT[] DEFAULT NULL
)
RETURNS SETOF public.domain_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH candidate AS (
    SELECT de.id
    FROM public.domain_events de
    WHERE de.status IN ('pending', 'retry')
      AND (de.next_retry_at IS NULL OR de.next_retry_at <= now())
      AND (de.lease_until IS NULL OR de.lease_until < now())
      AND (p_event_types IS NULL OR de.event_type = ANY(p_event_types))
    ORDER BY de.created_at
    LIMIT GREATEST(p_batch_size, 1)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.domain_events de
  SET status = 'processing',
      attempts = de.attempts + 1,
      worker_id = p_worker_id,
      lease_until = now() + make_interval(secs => p_lease_seconds),
      lease_version = de.lease_version + 1,
      processing_started_at = now(),
      last_error = NULL
  FROM candidate
  WHERE de.id = candidate.id
  RETURNING de.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_domain_event(
  p_event_id UUID,
  p_worker_id TEXT,
  p_lease_version BIGINT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  UPDATE public.domain_events
  SET status = 'processed',
      processed_at = now(),
      lease_until = NULL,
      worker_id = NULL,
      next_retry_at = NULL,
      last_error = NULL
  WHERE id = p_event_id
    AND status = 'processing'
    AND worker_id = p_worker_id
    AND lease_version = p_lease_version
    AND lease_until IS NOT NULL
    AND lease_until >= now();

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.reschedule_domain_event_retry(
  p_event_id UUID,
  p_worker_id TEXT,
  p_lease_version BIGINT,
  p_next_retry_at TIMESTAMPTZ,
  p_error TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  UPDATE public.domain_events
  SET status = 'retry',
      next_retry_at = p_next_retry_at,
      last_error = p_error,
      lease_until = NULL,
      worker_id = NULL
  WHERE id = p_event_id
    AND status = 'processing'
    AND worker_id = p_worker_id
    AND lease_version = p_lease_version
    AND lease_until IS NOT NULL
    AND lease_until >= now();

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.dead_letter_domain_event(
  p_event_id UUID,
  p_worker_id TEXT,
  p_lease_version BIGINT,
  p_error TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  UPDATE public.domain_events
  SET status = 'dead_letter',
      dead_lettered_at = now(),
      last_error = p_error,
      lease_until = NULL,
      worker_id = NULL
  WHERE id = p_event_id
    AND status = 'processing'
    AND worker_id = p_worker_id
    AND lease_version = p_lease_version
    AND lease_until IS NOT NULL
    AND lease_until >= now();

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.acquire_conversation_lock(
  p_tenant_id UUID,
  p_phone TEXT,
  p_worker_id TEXT,
  p_lease_seconds INTEGER DEFAULT 60
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_token BIGINT;
BEGIN
  INSERT INTO public.conversation_processing_locks(tenant_id, phone, worker_id, lease_until, fence_token, updated_at)
  VALUES (p_tenant_id, p_phone, p_worker_id, now() + make_interval(secs => p_lease_seconds), 1, now())
  ON CONFLICT (tenant_id, phone) DO NOTHING;

  UPDATE public.conversation_processing_locks l
  SET worker_id = p_worker_id,
      lease_until = now() + make_interval(secs => p_lease_seconds),
      fence_token = l.fence_token + 1,
      updated_at = now()
  WHERE l.tenant_id = p_tenant_id
    AND l.phone = p_phone
    AND (l.lease_until IS NULL OR l.lease_until < now() OR l.worker_id = p_worker_id)
  RETURNING l.fence_token INTO v_token;

  RETURN v_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_conversation_lock(
  p_tenant_id UUID,
  p_phone TEXT,
  p_worker_id TEXT,
  p_fence_token BIGINT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  UPDATE public.conversation_processing_locks
  SET lease_until = now() - interval '1 second',
      worker_id = NULL,
      updated_at = now()
  WHERE tenant_id = p_tenant_id
    AND phone = p_phone
    AND worker_id = p_worker_id
    AND fence_token = p_fence_token;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_worker_metric(
  p_worker_name TEXT,
  p_status TEXT,
  p_event_id UUID DEFAULT NULL,
  p_tenant_id UUID DEFAULT NULL,
  p_event_type TEXT DEFAULT NULL,
  p_retries INTEGER DEFAULT 0,
  p_processing_ms INTEGER DEFAULT NULL,
  p_error_code TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.worker_processing_metrics(
    worker_name,
    event_id,
    tenant_id,
    event_type,
    status,
    retries,
    processing_ms,
    error_code
  ) VALUES (
    p_worker_name,
    p_event_id,
    p_tenant_id,
    p_event_type,
    p_status,
    GREATEST(p_retries, 0),
    p_processing_ms,
    p_error_code
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reconcile_stuck_outbox_accepted(
  p_age_minutes INTEGER DEFAULT 30,
  p_limit INTEGER DEFAULT 200
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  WITH stuck AS (
    SELECT id
    FROM public.message_outbox
    WHERE status = 'accepted'
      AND delivered_at IS NULL
      AND accepted_at IS NOT NULL
      AND accepted_at < now() - make_interval(mins => GREATEST(p_age_minutes, 1))
    ORDER BY accepted_at
    LIMIT GREATEST(p_limit, 1)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.message_outbox mo
  SET status = 'retry',
      next_retry_at = now(),
      accepted_reconciled_at = now(),
      last_error = COALESCE(mo.last_error, 'accepted_stuck_reconciled'),
      updated_at = now()
  FROM stuck
  WHERE mo.id = stuck.id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

CREATE OR REPLACE FUNCTION public.purge_inbound_messages(
  p_retention_days INTEGER DEFAULT 90
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM public.inbound_messages
  WHERE created_at < now() - make_interval(days => GREATEST(p_retention_days, 1));

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

CREATE OR REPLACE FUNCTION public.run_sync_movements_cron()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lock_ok BOOLEAN;
BEGIN
  v_lock_ok := pg_try_advisory_lock(hashtext('sync-movements-cron'));
  IF NOT v_lock_ok THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := concat(current_setting('app.settings.supabase_url', true), '/functions/v1/sync-movements'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', concat('Bearer ', current_setting('app.settings.service_role_key', true))
    ),
    body := '{}'::jsonb
  );

  PERFORM pg_advisory_unlock(hashtext('sync-movements-cron'));
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_advisory_unlock(hashtext('sync-movements-cron'));
  RAISE;
END;
$$;

DO $$
BEGIN
  PERFORM cron.unschedule('sync-movements-every-5-minutes');
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

SELECT cron.schedule(
  'sync-movements-every-5-minutes',
  '*/5 * * * *',
  $$SELECT public.run_sync_movements_cron();$$
)
WHERE NOT EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'sync-movements-every-5-minutes'
);

DO $$
BEGIN
  PERFORM cron.unschedule('inbound-messages-retention-daily');
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

SELECT cron.schedule(
  'inbound-messages-retention-daily',
  '5 3 * * *',
  $$SELECT public.purge_inbound_messages(90);$$
)
WHERE NOT EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'inbound-messages-retention-daily'
);

REVOKE ALL ON FUNCTION public.claim_domain_events(TEXT, INTEGER, INTEGER, TEXT[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_domain_event(UUID, TEXT, BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reschedule_domain_event_retry(UUID, TEXT, BIGINT, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dead_letter_domain_event(UUID, TEXT, BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.acquire_conversation_lock(UUID, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_conversation_lock(UUID, TEXT, TEXT, BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_worker_metric(TEXT, TEXT, UUID, UUID, TEXT, INTEGER, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_stuck_outbox_accepted(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.purge_inbound_messages(INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.run_sync_movements_cron() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_domain_events(TEXT, INTEGER, INTEGER, TEXT[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_domain_event(UUID, TEXT, BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION public.reschedule_domain_event_retry(UUID, TEXT, BIGINT, TIMESTAMPTZ, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.dead_letter_domain_event(UUID, TEXT, BIGINT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.acquire_conversation_lock(UUID, TEXT, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_conversation_lock(UUID, TEXT, TEXT, BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_worker_metric(TEXT, TEXT, UUID, UUID, TEXT, INTEGER, INTEGER, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_stuck_outbox_accepted(INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_inbound_messages(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.run_sync_movements_cron() TO postgres;
