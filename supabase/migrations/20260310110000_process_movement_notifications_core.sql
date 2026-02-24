-- Core architecture for process movement notifications.
-- Decoupled from delivery channels (WhatsApp/AI) and focused on robust, auditable internal flow.

ALTER TABLE public.processos
  ADD COLUMN IF NOT EXISTS last_movement_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_notified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS notification_pending BOOLEAN NOT NULL DEFAULT false;


UPDATE public.processos p
SET last_movement_at = m.max_movement_at
FROM (
  SELECT processo_id, MAX(COALESCE(data_movimentacao, created_at)) AS max_movement_at
  FROM public.movimentacoes
  GROUP BY processo_id
) m
WHERE p.id = m.processo_id
  AND (p.last_movement_at IS NULL OR p.last_movement_at < m.max_movement_at);

CREATE INDEX IF NOT EXISTS idx_processos_notification_pending
  ON public.processos(notification_pending)
  WHERE notification_pending = true;

CREATE INDEX IF NOT EXISTS idx_processos_last_movement_notified
  ON public.processos(last_movement_at, last_notified_at);

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  process_id UUID NOT NULL REFERENCES public.processos(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own tenant notifications" ON public.notifications;
CREATE POLICY "Users can view own tenant notifications"
ON public.notifications
FOR SELECT
TO authenticated
USING (tenant_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own tenant notifications" ON public.notifications;
CREATE POLICY "Users can insert own tenant notifications"
ON public.notifications
FOR INSERT
TO authenticated
WITH CHECK (tenant_id = auth.uid());

DROP POLICY IF EXISTS "Service role can manage all notifications" ON public.notifications;
CREATE POLICY "Service role can manage all notifications"
ON public.notifications
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_notifications_status
  ON public.notifications(status);

CREATE INDEX IF NOT EXISTS idx_notifications_tenant_id
  ON public.notifications(tenant_id);

CREATE INDEX IF NOT EXISTS idx_notifications_process_id
  ON public.notifications(process_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_unique_pending_per_process_type
  ON public.notifications(process_id, type)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_notifications_pending_created_at
  ON public.notifications(created_at)
  WHERE status = 'pending';

CREATE OR REPLACE FUNCTION public.refresh_processo_last_movement()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_timestamp TIMESTAMPTZ;
BEGIN
  v_timestamp := COALESCE(NEW.data_movimentacao, now());

  UPDATE public.processos
  SET
    last_movement_at = GREATEST(COALESCE(last_movement_at, '-infinity'::timestamptz), v_timestamp),
    notification_pending = true
  WHERE id = NEW.processo_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_refresh_processo_last_movement ON public.movimentacoes;
CREATE TRIGGER trg_refresh_processo_last_movement
AFTER INSERT ON public.movimentacoes
FOR EACH ROW
EXECUTE FUNCTION public.refresh_processo_last_movement();

CREATE OR REPLACE FUNCTION public.check_recent_movements()
RETURNS TABLE(
  notifications_created INTEGER,
  processes_marked_pending INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_created INTEGER := 0;
  v_marked INTEGER := 0;
BEGIN
  WITH candidates AS (
    SELECT p.id AS process_id, p.user_id AS tenant_id
    FROM public.processos p
    WHERE p.last_movement_at IS NOT NULL
      AND (p.last_notified_at IS NULL OR p.last_movement_at > p.last_notified_at)
  ), inserted AS (
    INSERT INTO public.notifications (tenant_id, process_id, type, status)
    SELECT c.tenant_id, c.process_id, 'nova_movimentacao', 'pending'
    FROM candidates c
    ON CONFLICT (process_id, type) WHERE status = 'pending' DO NOTHING
    RETURNING id, tenant_id, process_id, created_at
  ), marked AS (
    UPDATE public.processos p
    SET notification_pending = true
    WHERE p.id IN (SELECT process_id FROM candidates)
      AND p.notification_pending = false
    RETURNING p.id
  )
  SELECT
    (SELECT COUNT(*) FROM inserted),
    (SELECT COUNT(*) FROM marked)
  INTO v_created, v_marked;

  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity, entity_id, metadata)
  SELECT
    i.tenant_id,
    NULL,
    'notificacao_criada',
    'notification',
    i.id::text,
    jsonb_build_object(
      'notification_id', i.id,
      'process_id', i.process_id,
      'type', 'nova_movimentacao',
      'source', 'check_recent_movements'
    )
  FROM inserted i;

  RETURN QUERY SELECT v_created, v_marked;
END;
$$;

REVOKE ALL ON FUNCTION public.check_recent_movements() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_recent_movements() TO service_role;

CREATE OR REPLACE FUNCTION public.process_pending_notifications(
  p_batch_size INTEGER DEFAULT 100,
  p_fail_rate NUMERIC DEFAULT 0
)
RETURNS TABLE(
  processed_total INTEGER,
  sent_total INTEGER,
  failed_total INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sent INTEGER := 0;
  v_failed INTEGER := 0;
  v_now TIMESTAMPTZ := now();
  rec RECORD;
  v_error TEXT;
BEGIN
  FOR rec IN
    SELECT n.id, n.tenant_id, n.process_id, n.retry_count
    FROM public.notifications n
    WHERE n.status = 'pending'
    ORDER BY n.created_at ASC
    LIMIT GREATEST(p_batch_size, 1)
    FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      IF random() < GREATEST(LEAST(p_fail_rate, 1), 0) THEN
        RAISE EXCEPTION 'simulated_delivery_failure';
      END IF;

      UPDATE public.notifications
      SET status = 'sent', sent_at = v_now, error_message = NULL
      WHERE id = rec.id;

      UPDATE public.processos
      SET
        last_notified_at = v_now,
        notification_pending = false
      WHERE id = rec.process_id;

      INSERT INTO public.audit_logs (tenant_id, user_id, action, entity, entity_id, metadata)
      VALUES (
        rec.tenant_id,
        NULL,
        'notificacao_enviada',
        'notification',
        rec.id::text,
        jsonb_build_object(
          'notification_id', rec.id,
          'process_id', rec.process_id,
          'status', 'sent',
          'source', 'process_pending_notifications'
        )
      );

      v_sent := v_sent + 1;
    EXCEPTION WHEN OTHERS THEN
      v_error := SQLERRM;

      UPDATE public.notifications
      SET
        status = 'failed',
        retry_count = retry_count + 1,
        error_message = v_error
      WHERE id = rec.id;

      INSERT INTO public.audit_logs (tenant_id, user_id, action, entity, entity_id, metadata)
      VALUES (
        rec.tenant_id,
        NULL,
        'notificacao_falhou',
        'notification',
        rec.id::text,
        jsonb_build_object(
          'notification_id', rec.id,
          'process_id', rec.process_id,
          'status', 'failed',
          'retry_count', rec.retry_count + 1,
          'error_message', v_error,
          'source', 'process_pending_notifications'
        )
      );

      v_failed := v_failed + 1;
    END;
  END LOOP;

  RETURN QUERY SELECT v_sent + v_failed, v_sent, v_failed;
END;
$$;

REVOKE ALL ON FUNCTION public.process_pending_notifications(INTEGER, NUMERIC) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_pending_notifications(INTEGER, NUMERIC) TO service_role;
