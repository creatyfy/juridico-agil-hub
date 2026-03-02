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
    outbox_id = CASE
      WHEN public.process_movement_notifications.status = 'queued' THEN EXCLUDED.outbox_id
      ELSE public.process_movement_notifications.outbox_id
    END,
    status = CASE
      WHEN public.process_movement_notifications.status = 'queued' THEN 'queued'
      ELSE public.process_movement_notifications.status
    END,
    attempts = CASE
      WHEN public.process_movement_notifications.status = 'queued' THEN 0
      ELSE public.process_movement_notifications.attempts
    END,
    last_error = CASE
      WHEN public.process_movement_notifications.status = 'queued' THEN NULL
      ELSE public.process_movement_notifications.last_error
    END,
    notified_at = EXCLUDED.notified_at,
    updated_at = now();

  outbox_id := v_outbox_id;

  IF NOT v_inserted THEN
    queue_status := 'duplicate';
  END IF;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_process_movement_notification(UUID, UUID, UUID, UUID, TIMESTAMPTZ, TEXT, UUID, TEXT, JSONB, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_process_movement_notification(UUID, UUID, UUID, UUID, TIMESTAMPTZ, TEXT, UUID, TEXT, JSONB, UUID) TO service_role;
