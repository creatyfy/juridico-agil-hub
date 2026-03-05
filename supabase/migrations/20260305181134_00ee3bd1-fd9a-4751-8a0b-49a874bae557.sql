-- 1. Recreate cron function (idempotent)
CREATE OR REPLACE FUNCTION public.run_process_campaign_jobs_cron()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_lock_ok BOOLEAN;
BEGIN
  v_lock_ok := pg_try_advisory_lock(hashtext('process-campaign-jobs-cron'));
  IF NOT v_lock_ok THEN RETURN; END IF;
  PERFORM net.http_post(
    url := concat(current_setting('app.settings.supabase_url', true), '/functions/v1/process-campaign-jobs'),
    headers := jsonb_build_object('Content-Type','application/json','Authorization',concat('Bearer ',current_setting('app.settings.service_role_key', true))),
    body := '{}'::jsonb
  );
  PERFORM pg_advisory_unlock(hashtext('process-campaign-jobs-cron'));
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_advisory_unlock(hashtext('process-campaign-jobs-cron')); RAISE;
END; $$;

-- 2. Schedule cron (idempotent)
SELECT cron.schedule('process-campaign-jobs-every-minute','* * * * *',$$SELECT public.run_process_campaign_jobs_cron();$$)
WHERE NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-campaign-jobs-every-minute');

-- 3. Permissions
REVOKE ALL ON FUNCTION public.run_process_campaign_jobs_cron() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_process_campaign_jobs_cron() TO service_role, postgres;

-- 4. Claim campaign recipients RPC
CREATE OR REPLACE FUNCTION public.claim_campaign_recipients(p_campaign_job_id uuid, p_batch_size int DEFAULT 100)
RETURNS SETOF campaign_recipients
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE campaign_recipients
  SET status = 'processing', updated_at = now()
  WHERE id IN (
    SELECT id FROM campaign_recipients
    WHERE campaign_job_id = p_campaign_job_id
      AND sent_at IS NULL
      AND status IN ('pending', 'queued')
    ORDER BY created_at
    LIMIT p_batch_size
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_campaign_recipients(uuid, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_campaign_recipients(uuid, int) TO service_role, postgres;