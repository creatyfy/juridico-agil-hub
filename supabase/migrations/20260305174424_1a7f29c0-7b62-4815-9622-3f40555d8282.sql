
-- Create cron function for campaign jobs processing
CREATE OR REPLACE FUNCTION public.run_process_campaign_jobs_cron()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_lock_ok BOOLEAN;
BEGIN
  v_lock_ok := pg_try_advisory_lock(hashtext('process-campaign-jobs-cron'));
  IF NOT v_lock_ok THEN RETURN; END IF;
  PERFORM net.http_post(
    url := concat(current_setting('app.settings.supabase_url', true), '/functions/v1/process-campaign-jobs'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', concat('Bearer ', current_setting('app.settings.service_role_key', true))),
    body := '{}'::jsonb
  );
  PERFORM pg_advisory_unlock(hashtext('process-campaign-jobs-cron'));
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_advisory_unlock(hashtext('process-campaign-jobs-cron')); RAISE;
END; $$;

-- Schedule cron job every minute
SELECT cron.schedule('process-campaign-jobs-every-minute', '* * * * *', $$SELECT public.run_process_campaign_jobs_cron();$$);

-- Restrict function access
REVOKE ALL ON FUNCTION public.run_process_campaign_jobs_cron() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_process_campaign_jobs_cron() TO service_role;
GRANT EXECUTE ON FUNCTION public.run_process_campaign_jobs_cron() TO postgres;
