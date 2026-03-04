-- Proactive reminders: RPC to fetch candidates + daily cron at 09:00 BRT (12:00 UTC).
--
-- Candidates = processos monitorados cujo último movimento (ou data de cadastro)
-- é anterior ao cutoff E cujo contato não recebeu notificação recente.

CREATE OR REPLACE FUNCTION public.get_proactive_reminder_candidates(
  p_cutoff TIMESTAMPTZ
)
RETURNS TABLE (
  tenant_id         UUID,
  processo_id       UUID,
  numero_cnj        TEXT,
  contact_id        UUID,
  phone_number      TEXT,
  cliente_nome      TEXT,
  instance_id       UUID,
  instance_name     TEXT,
  escritorio_nome   TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT ON (wc.id)
    p.user_id                                               AS tenant_id,
    p.id                                                    AS processo_id,
    p.numero_cnj,
    wc.id                                                   AS contact_id,
    wc.phone_number,
    c.nome                                                  AS cliente_nome,
    wi.id                                                   AS instance_id,
    wi.instance_name,
    COALESCE(au.raw_user_meta_data->>'full_name', au.email) AS escritorio_nome
  FROM public.processo_monitoramentos pm
  JOIN public.processos p ON p.id = pm.processo_id
  -- cliente vinculado ao processo
  JOIN public.cliente_processos cp
    ON cp.processo_id = p.id
   AND cp.status = 'ativo'
  JOIN public.clientes c ON c.id = cp.cliente_id
  -- contato WhatsApp verificado e com opt-in
  JOIN public.whatsapp_contacts wc
    ON wc.tenant_id = p.user_id
   AND wc.phone_number = REGEXP_REPLACE(COALESCE(c.numero_whatsapp, ''), '\D', '', 'g')
   AND wc.verified = true
   AND wc.notifications_opt_in = true
  -- instância WhatsApp conectada do tenant
  JOIN public.whatsapp_instancias wi
    ON wi.user_id = p.user_id
   AND wi.status = 'connected'
  -- dados do advogado (nome do escritório)
  JOIN auth.users au ON au.id = p.user_id
  WHERE pm.ativo = true
    -- processo sem movimentação recente
    AND NOT EXISTS (
      SELECT 1 FROM public.movimentacoes m
      WHERE m.processo_id = p.id
        AND m.data_movimentacao >= p_cutoff
    )
    -- contato não recebeu notificação recente
    AND (
      wc.last_notification_sent_at IS NULL
      OR wc.last_notification_sent_at < p_cutoff
    )
    -- telefone preenchido
    AND c.numero_whatsapp IS NOT NULL
    AND REGEXP_REPLACE(c.numero_whatsapp, '\D', '', 'g') != ''
  ORDER BY wc.id, wi.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_proactive_reminder_candidates(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_proactive_reminder_candidates(TIMESTAMPTZ) TO service_role;

-- Cron runner com advisory lock para evitar sobreposição
CREATE OR REPLACE FUNCTION public.run_proactive_reminders_cron()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lock_ok BOOLEAN;
BEGIN
  v_lock_ok := pg_try_advisory_lock(hashtext('proactive-reminders-cron'));
  IF NOT v_lock_ok THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := concat(current_setting('app.settings.supabase_url', true), '/functions/v1/proactive-reminders'),
    headers := jsonb_build_object(
      'Content-Type',   'application/json',
      'Authorization',  concat('Bearer ', current_setting('app.settings.service_role_key', true))
    ),
    body    := '{}'::jsonb
  );

  PERFORM pg_advisory_unlock(hashtext('proactive-reminders-cron'));
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_advisory_unlock(hashtext('proactive-reminders-cron'));
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.run_proactive_reminders_cron() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_proactive_reminders_cron() TO service_role;
GRANT EXECUTE ON FUNCTION public.run_proactive_reminders_cron() TO postgres;

-- Agenda diariamente às 12:00 UTC (09:00 BRT)
DO $$
BEGIN
  PERFORM cron.unschedule('proactive-reminders-daily');
EXCEPTION WHEN OTHERS THEN
  NULL;
END;
$$;

SELECT cron.schedule(
  'proactive-reminders-daily',
  '0 12 * * *',
  $$SELECT public.run_proactive_reminders_cron();$$
)
WHERE NOT EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'proactive-reminders-daily'
);
