
-- 1. Add lease_version column to message_outbox
ALTER TABLE public.message_outbox ADD COLUMN IF NOT EXISTS lease_version bigint NOT NULL DEFAULT 0;

-- 2. reap_orphaned_outbox_messages: reset stuck messages whose lease expired
CREATE OR REPLACE FUNCTION public.reap_orphaned_outbox_messages(p_limit integer DEFAULT 200, p_retry_delay_seconds integer DEFAULT 5)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_updated INTEGER;
BEGIN
  WITH stuck AS (
    SELECT id FROM public.message_outbox
    WHERE status = 'sending'
      AND lease_until IS NOT NULL
      AND lease_until < now()
    ORDER BY created_at
    LIMIT GREATEST(p_limit, 1)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.message_outbox mo
  SET status = 'retry',
      next_retry_at = now() + make_interval(secs => p_retry_delay_seconds),
      lease_until = NULL,
      worker_id = NULL,
      updated_at = now()
  FROM stuck WHERE mo.id = stuck.id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

-- 3. claim_message_outbox_with_lease: claim pending/retry messages for processing
CREATE OR REPLACE FUNCTION public.claim_message_outbox_with_lease(
  p_batch_size integer DEFAULT 20,
  p_worker_id text DEFAULT 'unknown',
  p_lease_seconds integer DEFAULT 45,
  p_tenant_capacity integer DEFAULT 30,
  p_tenant_refill_per_second numeric DEFAULT 1,
  p_instance_capacity integer DEFAULT 10,
  p_instance_refill_per_second numeric DEFAULT 0.5
)
RETURNS SETOF public.message_outbox
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
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
    LIMIT GREATEST(p_batch_size, 1)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.message_outbox mo
  SET status = 'sending',
      worker_id = p_worker_id,
      lease_until = now() + make_interval(secs => p_lease_seconds),
      lease_version = mo.lease_version + 1,
      updated_at = now()
  FROM candidate
  WHERE mo.id = candidate.id
  RETURNING mo.*;
END;
$$;

-- 4. register_outbox_attempt: increment attempt counter with lease check
CREATE OR REPLACE FUNCTION public.register_outbox_attempt(p_outbox_id uuid, p_lease_version bigint)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_updated INTEGER;
BEGIN
  UPDATE public.message_outbox
  SET attempts = attempts + 1, updated_at = now()
  WHERE id = p_outbox_id
    AND status = 'sending'
    AND lease_version = p_lease_version
    AND lease_until IS NOT NULL
    AND lease_until >= now();
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

-- 5. reschedule_outbox_retry
CREATE OR REPLACE FUNCTION public.reschedule_outbox_retry(
  p_id uuid, p_worker_id text, p_lease_version bigint,
  p_next_retry_at timestamptz, p_error text
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_updated INTEGER;
BEGIN
  UPDATE public.message_outbox
  SET status = 'retry',
      next_retry_at = p_next_retry_at,
      lease_until = NULL,
      worker_id = NULL,
      updated_at = now()
  WHERE id = p_id
    AND status = 'sending'
    AND worker_id = p_worker_id
    AND lease_version = p_lease_version;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

-- 6. move_outbox_dead_letter
CREATE OR REPLACE FUNCTION public.move_outbox_dead_letter(
  p_id uuid, p_worker_id text, p_lease_version bigint, p_error text
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_updated INTEGER;
BEGIN
  UPDATE public.message_outbox
  SET status = 'dead_letter',
      dead_lettered_at = now(),
      lease_until = NULL,
      worker_id = NULL,
      updated_at = now()
  WHERE id = p_id
    AND status = 'sending'
    AND worker_id = p_worker_id
    AND lease_version = p_lease_version;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

-- 7. complete_outbox_accepted
CREATE OR REPLACE FUNCTION public.complete_outbox_accepted(
  p_id uuid, p_worker_id text, p_lease_version bigint,
  p_provider_message_id text, p_provider_response jsonb DEFAULT '{}'::jsonb
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_updated INTEGER;
BEGIN
  UPDATE public.message_outbox
  SET status = 'accepted',
      provider_message_id = p_provider_message_id,
      lease_until = NULL,
      worker_id = NULL,
      updated_at = now()
  WHERE id = p_id
    AND status = 'sending'
    AND worker_id = p_worker_id
    AND lease_version = p_lease_version;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

-- 8. update_process_movement_notification_status (stub)
CREATE OR REPLACE FUNCTION public.update_process_movement_notification_status(
  p_tenant_id uuid, p_outbox_id uuid, p_status text,
  p_attempts integer DEFAULT 0, p_last_error text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  -- Stub: will be implemented when process_movement_notifications table is created
  RETURN;
END;
$$;

-- 9. Operational metrics view (used for logging)
CREATE OR REPLACE VIEW public.v_whatsapp_operational_metrics AS
SELECT
  tenant_id,
  ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'accepted') / NULLIF(COUNT(*), 0), 1) AS success_rate_percent,
  ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'retry') / NULLIF(COUNT(*), 0), 1) AS retry_rate_percent,
  ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'dead_letter') / NULLIF(COUNT(*), 0), 1) AS dead_letter_rate_percent,
  COUNT(*) FILTER (WHERE status IN ('pending', 'retry', 'sending')) AS backlog_count,
  COALESCE(EXTRACT(EPOCH FROM AVG(now() - created_at) FILTER (WHERE status IN ('pending', 'retry'))), 0) AS avg_backlog_age_seconds
FROM public.message_outbox
WHERE created_at > now() - interval '24 hours'
GROUP BY tenant_id;
