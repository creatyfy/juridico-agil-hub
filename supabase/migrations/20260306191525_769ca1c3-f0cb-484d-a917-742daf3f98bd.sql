
-- Create app_config table to store settings (replaces app.settings GUC)
CREATE TABLE IF NOT EXISTS public.app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: only service role can access
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

-- Helper function to read config
CREATE OR REPLACE FUNCTION public.get_app_config(p_key TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT value FROM public.app_config WHERE key = p_key LIMIT 1;
$$;

-- Update all cron wrapper functions to use app_config table

CREATE OR REPLACE FUNCTION public.run_outbox_worker_cron()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_lock_ok BOOLEAN; v_url TEXT; v_key TEXT;
BEGIN
  v_lock_ok := pg_try_advisory_lock(hashtext('outbox-worker-cron'));
  IF NOT v_lock_ok THEN RETURN; END IF;
  SELECT value INTO v_url FROM public.app_config WHERE key = 'supabase_url';
  SELECT value INTO v_key FROM public.app_config WHERE key = 'service_role_key';
  IF v_url IS NULL OR v_key IS NULL THEN
    PERFORM pg_advisory_unlock(hashtext('outbox-worker-cron'));
    RETURN;
  END IF;
  PERFORM net.http_post(
    url := concat(v_url, '/functions/v1/outbox-worker'),
    headers := jsonb_build_object('Content-Type','application/json','Authorization',concat('Bearer ', v_key)),
    body := '{}'::jsonb
  );
  PERFORM pg_advisory_unlock(hashtext('outbox-worker-cron'));
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_advisory_unlock(hashtext('outbox-worker-cron')); RAISE;
END; $function$;

CREATE OR REPLACE FUNCTION public.run_process_domain_events_cron()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_lock_ok BOOLEAN; v_url TEXT; v_key TEXT;
BEGIN
  v_lock_ok := pg_try_advisory_lock(hashtext('process-domain-events-cron'));
  IF NOT v_lock_ok THEN RETURN; END IF;
  SELECT value INTO v_url FROM public.app_config WHERE key = 'supabase_url';
  SELECT value INTO v_key FROM public.app_config WHERE key = 'service_role_key';
  IF v_url IS NULL OR v_key IS NULL THEN
    PERFORM pg_advisory_unlock(hashtext('process-domain-events-cron'));
    RETURN;
  END IF;
  PERFORM net.http_post(
    url := concat(v_url, '/functions/v1/process-domain-events'),
    headers := jsonb_build_object('Content-Type','application/json','Authorization',concat('Bearer ', v_key)),
    body := '{}'::jsonb
  );
  PERFORM pg_advisory_unlock(hashtext('process-domain-events-cron'));
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_advisory_unlock(hashtext('process-domain-events-cron')); RAISE;
END; $function$;

CREATE OR REPLACE FUNCTION public.run_process_whatsapp_inbound_cron()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_lock_ok BOOLEAN; v_url TEXT; v_key TEXT;
BEGIN
  v_lock_ok := pg_try_advisory_lock(hashtext('process-whatsapp-inbound-cron'));
  IF NOT v_lock_ok THEN RETURN; END IF;
  SELECT value INTO v_url FROM public.app_config WHERE key = 'supabase_url';
  SELECT value INTO v_key FROM public.app_config WHERE key = 'service_role_key';
  IF v_url IS NULL OR v_key IS NULL THEN
    PERFORM pg_advisory_unlock(hashtext('process-whatsapp-inbound-cron'));
    RETURN;
  END IF;
  PERFORM net.http_post(
    url := concat(v_url, '/functions/v1/process-whatsapp-inbound'),
    headers := jsonb_build_object('Content-Type','application/json','Authorization',concat('Bearer ', v_key)),
    body := '{}'::jsonb
  );
  PERFORM pg_advisory_unlock(hashtext('process-whatsapp-inbound-cron'));
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_advisory_unlock(hashtext('process-whatsapp-inbound-cron')); RAISE;
END; $function$;

CREATE OR REPLACE FUNCTION public.run_sync_movements_cron()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_lock_ok BOOLEAN; v_url TEXT; v_key TEXT;
BEGIN
  v_lock_ok := pg_try_advisory_lock(hashtext('sync-movements-cron'));
  IF NOT v_lock_ok THEN RETURN; END IF;
  SELECT value INTO v_url FROM public.app_config WHERE key = 'supabase_url';
  SELECT value INTO v_key FROM public.app_config WHERE key = 'service_role_key';
  IF v_url IS NULL OR v_key IS NULL THEN
    PERFORM pg_advisory_unlock(hashtext('sync-movements-cron'));
    RETURN;
  END IF;
  PERFORM net.http_post(
    url := concat(v_url, '/functions/v1/sync-movements'),
    headers := jsonb_build_object('Content-Type','application/json','Authorization',concat('Bearer ', v_key)),
    body := '{}'::jsonb
  );
  PERFORM pg_advisory_unlock(hashtext('sync-movements-cron'));
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_advisory_unlock(hashtext('sync-movements-cron')); RAISE;
END; $function$;

CREATE OR REPLACE FUNCTION public.run_process_campaign_jobs_cron()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_lock_ok BOOLEAN; v_url TEXT; v_key TEXT;
BEGIN
  v_lock_ok := pg_try_advisory_lock(hashtext('process-campaign-jobs-cron'));
  IF NOT v_lock_ok THEN RETURN; END IF;
  SELECT value INTO v_url FROM public.app_config WHERE key = 'supabase_url';
  SELECT value INTO v_key FROM public.app_config WHERE key = 'service_role_key';
  IF v_url IS NULL OR v_key IS NULL THEN
    PERFORM pg_advisory_unlock(hashtext('process-campaign-jobs-cron'));
    RETURN;
  END IF;
  PERFORM net.http_post(
    url := concat(v_url, '/functions/v1/process-campaign-jobs'),
    headers := jsonb_build_object('Content-Type','application/json','Authorization',concat('Bearer ', v_key)),
    body := '{}'::jsonb
  );
  PERFORM pg_advisory_unlock(hashtext('process-campaign-jobs-cron'));
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_advisory_unlock(hashtext('process-campaign-jobs-cron')); RAISE;
END; $function$;
