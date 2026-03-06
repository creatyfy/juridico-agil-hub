ALTER TABLE public.process_consultation_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access audit logs" ON public.process_consultation_audit_logs;
CREATE POLICY "Service role full access audit logs"
ON public.process_consultation_audit_logs FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.run_outbox_worker_cron()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_lock_ok BOOLEAN;
BEGIN
  v_lock_ok := pg_try_advisory_lock(hashtext('outbox-worker-cron'));
  IF NOT v_lock_ok THEN RETURN; END IF;
  PERFORM net.http_post(
    url := concat(current_setting('app.settings.supabase_url', true), '/functions/v1/outbox-worker'),
    headers := jsonb_build_object('Content-Type','application/json','Authorization',concat('Bearer ',current_setting('app.settings.service_role_key', true))),
    body := '{}'::jsonb
  );
  PERFORM pg_advisory_unlock(hashtext('outbox-worker-cron'));
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_advisory_unlock(hashtext('outbox-worker-cron'));
  RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION public.run_process_domain_events_cron()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_lock_ok BOOLEAN;
BEGIN
  v_lock_ok := pg_try_advisory_lock(hashtext('process-domain-events-cron'));
  IF NOT v_lock_ok THEN RETURN; END IF;
  PERFORM net.http_post(
    url := concat(current_setting('app.settings.supabase_url', true), '/functions/v1/process-domain-events'),
    headers := jsonb_build_object('Content-Type','application/json','Authorization',concat('Bearer ',current_setting('app.settings.service_role_key', true))),
    body := '{}'::jsonb
  );
  PERFORM pg_advisory_unlock(hashtext('process-domain-events-cron'));
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_advisory_unlock(hashtext('process-domain-events-cron'));
  RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION public.run_process_whatsapp_inbound_cron()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_lock_ok BOOLEAN;
BEGIN
  v_lock_ok := pg_try_advisory_lock(hashtext('process-whatsapp-inbound-cron'));
  IF NOT v_lock_ok THEN RETURN; END IF;
  PERFORM net.http_post(
    url := concat(current_setting('app.settings.supabase_url', true), '/functions/v1/process-whatsapp-inbound'),
    headers := jsonb_build_object('Content-Type','application/json','Authorization',concat('Bearer ',current_setting('app.settings.service_role_key', true))),
    body := '{}'::jsonb
  );
  PERFORM pg_advisory_unlock(hashtext('process-whatsapp-inbound-cron'));
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_advisory_unlock(hashtext('process-whatsapp-inbound-cron'));
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.run_outbox_worker_cron() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.run_process_domain_events_cron() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.run_process_whatsapp_inbound_cron() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.run_outbox_worker_cron() TO service_role;
GRANT EXECUTE ON FUNCTION public.run_process_domain_events_cron() TO service_role;
GRANT EXECUTE ON FUNCTION public.run_process_whatsapp_inbound_cron() TO service_role;
GRANT EXECUTE ON FUNCTION public.run_outbox_worker_cron() TO postgres;
GRANT EXECUTE ON FUNCTION public.run_process_domain_events_cron() TO postgres;
GRANT EXECUTE ON FUNCTION public.run_process_whatsapp_inbound_cron() TO postgres;