/*
  Garantia operacional da sincronização Judit:
  - Recria/normaliza a função de cron para sync-movements.
  - Reagenda o job para cada 5 minutos de forma idempotente.
*/

CREATE OR REPLACE FUNCTION public.run_sync_movements_cron()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lock_ok BOOLEAN;
BEGIN
  v_lock_ok := pg_try_advisory_lock(hashtext('sync-movements-cron'));
  IF NOT v_lock_ok THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := concat(current_setting('app.settings.supabase_url', true), '/functions/v1/sync-movements'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', concat('Bearer ', current_setting('app.settings.service_role_key', true))
    ),
    body := '{}'::jsonb
  );

  PERFORM pg_advisory_unlock(hashtext('sync-movements-cron'));
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_advisory_unlock(hashtext('sync-movements-cron'));
  RAISE;
END;
$$;

DO $$
BEGIN
  PERFORM cron.unschedule('sync-movements-every-5-minutes');
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

SELECT cron.schedule(
  'sync-movements-every-5-minutes',
  '*/5 * * * *',
  $$SELECT public.run_sync_movements_cron();$$
)
WHERE NOT EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'sync-movements-every-5-minutes'
);

REVOKE ALL ON FUNCTION public.run_sync_movements_cron() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_sync_movements_cron() TO service_role;
GRANT EXECUTE ON FUNCTION public.run_sync_movements_cron() TO postgres;
