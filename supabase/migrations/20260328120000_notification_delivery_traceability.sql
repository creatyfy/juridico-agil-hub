ALTER TABLE public.process_movement_notifications
  ADD COLUMN IF NOT EXISTS status TEXT,
  ADD COLUMN IF NOT EXISTS outbox_id UUID REFERENCES public.message_outbox(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_error TEXT,
  ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

UPDATE public.process_movement_notifications
SET status = COALESCE(status, 'delivered'),
    updated_at = now()
WHERE status IS NULL;

ALTER TABLE public.process_movement_notifications
  ALTER COLUMN status SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'process_movement_notifications_status_check'
      AND conrelid = 'public.process_movement_notifications'::regclass
  ) THEN
    ALTER TABLE public.process_movement_notifications
      ADD CONSTRAINT process_movement_notifications_status_check
      CHECK (status IN ('queued', 'sent', 'delivered', 'failed', 'dead_letter'));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_process_movement_notifications_outbox
  ON public.process_movement_notifications (tenant_id, outbox_id)
  WHERE outbox_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_process_movement_notifications_status
  ON public.process_movement_notifications (tenant_id, process_id, status);

CREATE OR REPLACE FUNCTION public.touch_updated_at_process_movement_notifications()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_updated_at_process_movement_notifications ON public.process_movement_notifications;
CREATE TRIGGER trg_touch_updated_at_process_movement_notifications
BEFORE UPDATE ON public.process_movement_notifications
FOR EACH ROW
EXECUTE FUNCTION public.touch_updated_at_process_movement_notifications();

CREATE OR REPLACE FUNCTION public.update_process_movement_notification_status(
  p_tenant_id UUID,
  p_outbox_id UUID,
  p_status TEXT,
  p_attempts INTEGER DEFAULT NULL,
  p_last_error TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF p_status NOT IN ('sent', 'delivered', 'failed', 'dead_letter') THEN
    RAISE EXCEPTION 'invalid_status_transition' USING ERRCODE = '22023';
  END IF;

  UPDATE public.process_movement_notifications pmn
  SET status = p_status,
      attempts = COALESCE(p_attempts, pmn.attempts),
      last_error = CASE
        WHEN p_status IN ('failed', 'dead_letter') THEN COALESCE(p_last_error, pmn.last_error)
        ELSE NULL
      END,
      updated_at = now()
  WHERE pmn.tenant_id = p_tenant_id
    AND pmn.outbox_id = p_outbox_id
    AND (
      p_status = 'delivered'
      OR pmn.status <> 'delivered'
    )
    AND (
      p_status <> 'sent'
      OR pmn.status IN ('queued', 'failed')
    )
    AND (
      p_status <> 'failed'
      OR pmn.status IN ('queued', 'sent', 'failed')
    )
    AND (
      p_status <> 'dead_letter'
      OR pmn.status IN ('queued', 'sent', 'failed', 'dead_letter')
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_outbox_delivered(
  p_tenant_id UUID,
  p_instance_id UUID,
  p_provider_message_id TEXT,
  p_provider_response JSONB DEFAULT '{}'::jsonb
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  WITH delivered AS (
    UPDATE public.message_outbox mo
    SET status = 'delivered',
        delivered_at = now(),
        provider_response = COALESCE(mo.provider_response, '{}'::jsonb) || p_provider_response,
        updated_at = now()
    WHERE mo.tenant_id = p_tenant_id
      AND mo.provider_message_id = p_provider_message_id
      AND mo.status = 'accepted'
      AND (
        mo.aggregate_id = p_instance_id
        OR mo.payload->>'instanceId' = p_instance_id::text
      )
    RETURNING mo.id
  )
  UPDATE public.process_movement_notifications pmn
  SET status = 'delivered',
      last_error = NULL,
      updated_at = now()
  FROM delivered
  WHERE pmn.tenant_id = p_tenant_id
    AND pmn.outbox_id = delivered.id
    AND pmn.status <> 'delivered';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_process_movement_notification_stats(
  p_tenant_id UUID,
  p_process_id UUID
)
RETURNS TABLE(
  total_notifications BIGINT,
  queued_count BIGINT,
  sent_count BIGINT,
  delivered_count BIGINT,
  failed_count BIGINT,
  dead_letter_count BIGINT
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    COUNT(*) AS total_notifications,
    COUNT(*) FILTER (WHERE status = 'queued') AS queued_count,
    COUNT(*) FILTER (WHERE status = 'sent') AS sent_count,
    COUNT(*) FILTER (WHERE status = 'delivered') AS delivered_count,
    COUNT(*) FILTER (WHERE status = 'failed') AS failed_count,
    COUNT(*) FILTER (WHERE status = 'dead_letter') AS dead_letter_count
  FROM public.process_movement_notifications
  WHERE tenant_id = p_tenant_id
    AND process_id = p_process_id;
$$;

REVOKE ALL ON FUNCTION public.update_process_movement_notification_status(UUID, UUID, TEXT, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_process_movement_notification_status(UUID, UUID, TEXT, INTEGER, TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.get_process_movement_notification_stats(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_process_movement_notification_stats(UUID, UUID) TO service_role;
