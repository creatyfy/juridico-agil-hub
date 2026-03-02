DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.process_movement_notifications
    WHERE outbox_id IS NULL
  ) THEN
    RAISE EXCEPTION 'process_movement_notifications contains rows with NULL outbox_id; migration aborted';
  END IF;
END;
$$;

DO $$
DECLARE
  v_fk_name TEXT;
BEGIN
  FOR v_fk_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.process_movement_notifications'::regclass
      AND contype = 'f'
      AND conkey = ARRAY[
        (SELECT attnum
         FROM pg_attribute
         WHERE attrelid = 'public.process_movement_notifications'::regclass
           AND attname = 'outbox_id'
           AND NOT attisdropped)
      ]
  LOOP
    EXECUTE format('ALTER TABLE public.process_movement_notifications DROP CONSTRAINT %I', v_fk_name);
  END LOOP;
END;
$$;

ALTER TABLE public.process_movement_notifications
  ALTER COLUMN outbox_id SET NOT NULL;

ALTER TABLE public.process_movement_notifications
  ADD CONSTRAINT process_movement_notifications_outbox_id_fkey
  FOREIGN KEY (outbox_id)
  REFERENCES public.message_outbox(id)
  ON DELETE CASCADE;

ALTER TABLE public.process_movement_notifications
  DROP CONSTRAINT IF EXISTS process_movement_notifications_status_check;

ALTER TABLE public.process_movement_notifications
  ADD CONSTRAINT process_movement_notifications_status_check
  CHECK (status IN ('queued', 'retry', 'sent', 'delivered', 'failed', 'dead_letter'));

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
  IF p_status NOT IN ('retry', 'sent', 'delivered', 'failed', 'dead_letter') THEN
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
      (pmn.status = 'queued' AND p_status IN ('sent', 'failed'))
      OR (pmn.status = 'failed' AND p_status IN ('retry', 'dead_letter'))
      OR (pmn.status = 'retry' AND p_status IN ('sent', 'dead_letter'))
      OR (pmn.status = 'sent' AND p_status = 'delivered')
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
  v_outbox_id UUID;
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
    AND pmn.outbox_id = delivered.id;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  IF v_count = 0 THEN
    SELECT mo.id
    INTO v_outbox_id
    FROM public.message_outbox mo
    WHERE mo.tenant_id = p_tenant_id
      AND mo.provider_message_id = p_provider_message_id
      AND mo.status = 'delivered'
      AND (
        mo.aggregate_id = p_instance_id
        OR mo.payload->>'instanceId' = p_instance_id::text
      )
    ORDER BY mo.delivered_at DESC NULLS LAST
    LIMIT 1;

    IF v_outbox_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM public.process_movement_notifications pmn
      WHERE pmn.tenant_id = p_tenant_id
        AND pmn.outbox_id = v_outbox_id
    ) THEN
      RAISE EXCEPTION 'tracking_not_found_for_outbox_delivery' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN v_count;
END;
$$;
