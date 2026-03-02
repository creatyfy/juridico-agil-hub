ALTER TABLE public.process_movement_notifications
  ALTER COLUMN outbox_id SET NOT NULL;

DROP INDEX IF EXISTS idx_process_movement_notifications_outbox;
CREATE UNIQUE INDEX IF NOT EXISTS uq_process_movement_notifications_outbox
  ON public.process_movement_notifications (tenant_id, outbox_id);

ALTER TABLE public.process_movement_notifications
  DROP CONSTRAINT IF EXISTS process_movement_notifications_status_check;

ALTER TABLE public.process_movement_notifications
  ADD CONSTRAINT process_movement_notifications_status_check
  CHECK (status IN ('queued', 'sent', 'delivered', 'failed', 'retry', 'dead_letter'));

CREATE OR REPLACE FUNCTION public.validate_process_movement_notification_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'queued' AND NEW.status IN ('sent', 'failed') THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'failed' AND NEW.status IN ('retry', 'dead_letter') THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'retry' AND NEW.status IN ('sent', 'dead_letter') THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'sent' AND NEW.status = 'delivered' THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'invalid_process_movement_notification_transition: % -> %', OLD.status, NEW.status
    USING ERRCODE = '22023';
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_process_movement_notification_transition ON public.process_movement_notifications;
CREATE TRIGGER trg_validate_process_movement_notification_transition
BEFORE UPDATE ON public.process_movement_notifications
FOR EACH ROW
EXECUTE FUNCTION public.validate_process_movement_notification_transition();

CREATE OR REPLACE FUNCTION public.enforce_process_movement_notification_insert_origin()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_setting('app.allow_process_movement_tracking_insert', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'process_movement_notifications_insert_must_use_enqueue_function'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_process_movement_notification_insert_origin ON public.process_movement_notifications;
CREATE TRIGGER trg_enforce_process_movement_notification_insert_origin
BEFORE INSERT ON public.process_movement_notifications
FOR EACH ROW
EXECUTE FUNCTION public.enforce_process_movement_notification_insert_origin();

CREATE OR REPLACE FUNCTION public.validate_process_update_outbox_has_tracking()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF COALESCE(NEW.payload->>'kind', '') = 'process_update' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.process_movement_notifications pmn
      WHERE pmn.tenant_id = NEW.tenant_id
        AND pmn.outbox_id = NEW.id
    ) THEN
      RAISE EXCEPTION 'process_update_outbox_requires_tracking: %', NEW.id
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_process_update_outbox_has_tracking ON public.message_outbox;
CREATE CONSTRAINT TRIGGER trg_validate_process_update_outbox_has_tracking
AFTER INSERT OR UPDATE OF payload ON public.message_outbox
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.validate_process_update_outbox_has_tracking();

CREATE OR REPLACE FUNCTION public.enqueue_process_movement_notification(
  p_tenant_id UUID,
  p_process_id UUID,
  p_movement_id UUID,
  p_contact_id UUID,
  p_notified_at TIMESTAMPTZ,
  p_aggregate_type TEXT,
  p_aggregate_id UUID,
  p_idempotency_key TEXT,
  p_payload JSONB,
  p_campaign_job_id UUID DEFAULT NULL
)
RETURNS TABLE(outbox_id UUID, queue_status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_outbox_id UUID;
  v_inserted BOOLEAN := FALSE;
BEGIN
  INSERT INTO public.message_outbox (
    tenant_id,
    aggregate_type,
    aggregate_id,
    idempotency_key,
    payload,
    status,
    campaign_job_id
  )
  VALUES (
    p_tenant_id,
    p_aggregate_type,
    p_aggregate_id,
    p_idempotency_key,
    p_payload,
    'pending',
    p_campaign_job_id
  )
  ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
  RETURNING id INTO v_outbox_id;

  IF v_outbox_id IS NULL THEN
    SELECT mo.id
      INTO v_outbox_id
    FROM public.message_outbox mo
    WHERE mo.tenant_id = p_tenant_id
      AND mo.idempotency_key = p_idempotency_key
    LIMIT 1;

    IF v_outbox_id IS NULL THEN
      RAISE EXCEPTION 'process_movement_notification_outbox_resolution_failed'
        USING ERRCODE = '23505';
    END IF;

    queue_status := 'duplicate';
  ELSE
    v_inserted := TRUE;
    queue_status := 'queued';
  END IF;

  PERFORM set_config('app.allow_process_movement_tracking_insert', 'on', true);

  INSERT INTO public.process_movement_notifications (
    tenant_id,
    process_id,
    movement_id,
    contact_id,
    outbox_id,
    status,
    attempts,
    last_error,
    notified_at,
    updated_at
  )
  VALUES (
    p_tenant_id,
    p_process_id,
    p_movement_id,
    p_contact_id,
    v_outbox_id,
    'queued',
    0,
    NULL,
    COALESCE(p_notified_at, now()),
    now()
  )
  ON CONFLICT (tenant_id, movement_id, contact_id)
  DO UPDATE SET
    outbox_id = EXCLUDED.outbox_id,
    status = 'queued',
    attempts = 0,
    last_error = NULL,
    notified_at = EXCLUDED.notified_at,
    updated_at = now();

  outbox_id := v_outbox_id;

  IF NOT v_inserted THEN
    queue_status := 'duplicate';
  END IF;

  RETURN NEXT;
END;
$$;

ALTER FUNCTION public.update_process_movement_notification_status(UUID, UUID, TEXT, INTEGER, TEXT)
  SET search_path = public, pg_temp;

ALTER FUNCTION public.get_process_movement_notification_stats(UUID, UUID)
  SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.enqueue_process_movement_notification(UUID, UUID, UUID, UUID, TIMESTAMPTZ, TEXT, UUID, TEXT, JSONB, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_process_movement_notification(UUID, UUID, UUID, UUID, TIMESTAMPTZ, TEXT, UUID, TEXT, JSONB, UUID) TO service_role;

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
SET search_path = public, pg_temp
AS $$
DECLARE
  v_current_status TEXT;
  v_count INTEGER := 0;
BEGIN
  IF p_status NOT IN ('sent', 'delivered', 'failed', 'retry', 'dead_letter') THEN
    RAISE EXCEPTION 'invalid_status_transition' USING ERRCODE = '22023';
  END IF;

  SELECT pmn.status
    INTO v_current_status
  FROM public.process_movement_notifications pmn
  WHERE pmn.tenant_id = p_tenant_id
    AND pmn.outbox_id = p_outbox_id
  FOR UPDATE;

  IF v_current_status IS NULL THEN
    RETURN 0;
  END IF;

  IF p_status = v_current_status THEN
    RETURN 1;
  END IF;

  IF p_status = 'failed' THEN
    UPDATE public.process_movement_notifications pmn
    SET status = 'failed',
        attempts = COALESCE(p_attempts, pmn.attempts),
        last_error = COALESCE(p_last_error, pmn.last_error),
        updated_at = now()
    WHERE pmn.tenant_id = p_tenant_id
      AND pmn.outbox_id = p_outbox_id;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
  END IF;

  IF p_status = 'retry' THEN
    IF v_current_status = 'queued' THEN
      UPDATE public.process_movement_notifications pmn
      SET status = 'failed',
          attempts = COALESCE(p_attempts, pmn.attempts),
          last_error = COALESCE(p_last_error, pmn.last_error),
          updated_at = now()
      WHERE pmn.tenant_id = p_tenant_id
        AND pmn.outbox_id = p_outbox_id;
      v_current_status := 'failed';
    ELSIF v_current_status = 'sent' THEN
      UPDATE public.process_movement_notifications pmn
      SET status = 'failed',
          attempts = COALESCE(p_attempts, pmn.attempts),
          last_error = COALESCE(p_last_error, pmn.last_error),
          updated_at = now()
      WHERE pmn.tenant_id = p_tenant_id
        AND pmn.outbox_id = p_outbox_id;
      v_current_status := 'failed';
    END IF;

    IF v_current_status = 'failed' THEN
      UPDATE public.process_movement_notifications pmn
      SET status = 'retry',
          attempts = COALESCE(p_attempts, pmn.attempts),
          last_error = COALESCE(p_last_error, pmn.last_error),
          updated_at = now()
      WHERE pmn.tenant_id = p_tenant_id
        AND pmn.outbox_id = p_outbox_id;

      GET DIAGNOSTICS v_count = ROW_COUNT;
      RETURN v_count;
    END IF;

    RETURN 0;
  END IF;

  IF p_status = 'dead_letter' THEN
    IF v_current_status = 'queued' OR v_current_status = 'sent' THEN
      UPDATE public.process_movement_notifications pmn
      SET status = 'failed',
          attempts = COALESCE(p_attempts, pmn.attempts),
          last_error = COALESCE(p_last_error, pmn.last_error),
          updated_at = now()
      WHERE pmn.tenant_id = p_tenant_id
        AND pmn.outbox_id = p_outbox_id;
      v_current_status := 'failed';
    END IF;

    IF v_current_status = 'failed' OR v_current_status = 'retry' THEN
      UPDATE public.process_movement_notifications pmn
      SET status = 'dead_letter',
          attempts = COALESCE(p_attempts, pmn.attempts),
          last_error = COALESCE(p_last_error, pmn.last_error),
          updated_at = now()
      WHERE pmn.tenant_id = p_tenant_id
        AND pmn.outbox_id = p_outbox_id;

      GET DIAGNOSTICS v_count = ROW_COUNT;
      RETURN v_count;
    END IF;

    RETURN 0;
  END IF;

  IF p_status = 'sent' THEN
    UPDATE public.process_movement_notifications pmn
    SET status = 'sent',
        attempts = COALESCE(p_attempts, pmn.attempts),
        last_error = NULL,
        updated_at = now()
    WHERE pmn.tenant_id = p_tenant_id
      AND pmn.outbox_id = p_outbox_id;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
  END IF;

  IF p_status = 'delivered' THEN
    UPDATE public.process_movement_notifications pmn
    SET status = 'delivered',
        attempts = COALESCE(p_attempts, pmn.attempts),
        last_error = NULL,
        updated_at = now()
    WHERE pmn.tenant_id = p_tenant_id
      AND pmn.outbox_id = p_outbox_id;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
  END IF;

  RETURN v_count;
END;
$$;
