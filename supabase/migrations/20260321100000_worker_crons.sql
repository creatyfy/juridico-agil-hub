/*
  After deploying this migration, configure the following in Supabase Dashboard:

  Edge Functions → Secrets:
    - EVOLUTION_API_URL
    - EVOLUTION_API_KEY
    - OPENAI_API_KEY
    - JUDIT_API_KEY

  Database → Configuration (app.settings):
    - app.settings.supabase_url
    - app.settings.service_role_key
*/

CREATE OR REPLACE FUNCTION public.run_outbox_worker_cron()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lock_ok BOOLEAN;
BEGIN
  v_lock_ok := pg_try_advisory_lock(hashtext('outbox-worker-cron'));
  IF NOT v_lock_ok THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://kbnnydiiwtoeeqtijygj.supabase.co/functions/v1/outbox-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtibm55ZGlpd3RvZWVxdGlqeWdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2NjU1NTAsImV4cCI6MjA4NjI0MTU1MH0.jmo9Sq2ppfUq3yzRXXxjF5KYW3Y3fd2kYKPlVdIYarg'
    ),
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
DECLARE
  v_lock_ok BOOLEAN;
BEGIN
  v_lock_ok := pg_try_advisory_lock(hashtext('process-domain-events-cron'));
  IF NOT v_lock_ok THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://kbnnydiiwtoeeqtijygj.supabase.co/functions/v1/process-domain-events',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtibm55ZGlpd3RvZWVxdGlqeWdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2NjU1NTAsImV4cCI6MjA4NjI0MTU1MH0.jmo9Sq2ppfUq3yzRXXxjF5KYW3Y3fd2kYKPlVdIYarg'
    ),
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
DECLARE
  v_lock_ok BOOLEAN;
BEGIN
  v_lock_ok := pg_try_advisory_lock(hashtext('process-whatsapp-inbound-cron'));
  IF NOT v_lock_ok THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://kbnnydiiwtoeeqtijygj.supabase.co/functions/v1/process-whatsapp-inbound',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtibm55ZGlpd3RvZWVxdGlqeWdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2NjU1NTAsImV4cCI6MjA4NjI0MTU1MH0.jmo9Sq2ppfUq3yzRXXxjF5KYW3Y3fd2kYKPlVdIYarg'
    ),
    body := '{}'::jsonb
  );

  PERFORM pg_advisory_unlock(hashtext('process-whatsapp-inbound-cron'));
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_advisory_unlock(hashtext('process-whatsapp-inbound-cron'));
  RAISE;
END;
$$;

SELECT cron.schedule(
  'outbox-worker-every-minute',
  '* * * * *',
  $$SELECT public.run_outbox_worker_cron();$$
)
WHERE NOT EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'outbox-worker-every-minute'
);

SELECT cron.schedule(
  'process-domain-events-every-minute',
  '* * * * *',
  $$SELECT public.run_process_domain_events_cron();$$
)
WHERE NOT EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'process-domain-events-every-minute'
);

SELECT cron.schedule(
  'process-whatsapp-inbound-every-minute',
  '* * * * *',
  $$SELECT public.run_process_whatsapp_inbound_cron();$$
)
WHERE NOT EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'process-whatsapp-inbound-every-minute'
);

REVOKE ALL ON FUNCTION public.run_outbox_worker_cron() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.run_process_domain_events_cron() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.run_process_whatsapp_inbound_cron() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.run_outbox_worker_cron() TO service_role;
GRANT EXECUTE ON FUNCTION public.run_process_domain_events_cron() TO service_role;
GRANT EXECUTE ON FUNCTION public.run_process_whatsapp_inbound_cron() TO service_role;
GRANT EXECUTE ON FUNCTION public.run_outbox_worker_cron() TO postgres;
GRANT EXECUTE ON FUNCTION public.run_process_domain_events_cron() TO postgres;
GRANT EXECUTE ON FUNCTION public.run_process_whatsapp_inbound_cron() TO postgres;
