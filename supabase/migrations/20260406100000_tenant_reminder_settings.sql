-- Tenant reminder interval settings
-- Allows each advogado to configure how many days without movement before
-- a proactive reminder is sent to clients.

CREATE TABLE IF NOT EXISTS tenant_settings (
  user_id       UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  reminder_days INTEGER NOT NULL DEFAULT 7 CHECK (reminder_days BETWEEN 1 AND 90),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS: each user can only read/write their own settings
ALTER TABLE tenant_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_settings_owner" ON tenant_settings
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- RPC to upsert reminder_days (called from frontend)
CREATE OR REPLACE FUNCTION set_reminder_days(p_days INTEGER)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO tenant_settings (user_id, reminder_days, updated_at)
  VALUES (auth.uid(), p_days, NOW())
  ON CONFLICT (user_id)
  DO UPDATE SET reminder_days = p_days, updated_at = NOW();
END;
$$;

REVOKE ALL ON FUNCTION set_reminder_days(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_reminder_days(INTEGER) TO authenticated;

-- RPC to get reminder_days for the current user
CREATE OR REPLACE FUNCTION get_reminder_days()
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days INTEGER;
BEGIN
  SELECT reminder_days INTO v_days
  FROM tenant_settings
  WHERE user_id = auth.uid();
  RETURN COALESCE(v_days, 7);
END;
$$;

REVOKE ALL ON FUNCTION get_reminder_days() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_reminder_days() TO authenticated;

-- Update get_proactive_reminder_candidates to respect per-tenant setting
-- (replaces the hardcoded 7-day cutoff with per-user reminder_days)
CREATE OR REPLACE FUNCTION get_proactive_reminder_candidates(p_cutoff TIMESTAMPTZ DEFAULT NULL)
RETURNS TABLE (
  tenant_id        UUID,
  processo_id      UUID,
  numero_cnj       TEXT,
  cliente_id       UUID,
  cliente_nome     TEXT,
  phone_number     TEXT,
  instance_id      UUID
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cutoff TIMESTAMPTZ;
BEGIN
  -- Default: use 7 days ago if no explicit cutoff provided
  v_cutoff := COALESCE(p_cutoff, NOW() - INTERVAL '7 days');

  RETURN QUERY
  SELECT
    pm.user_id                       AS tenant_id,
    pm.processo_id,
    p.numero_cnj,
    c.id                             AS cliente_id,
    c.nome                           AS cliente_nome,
    wc.phone_number,
    wi.id                            AS instance_id
  FROM processo_monitoramentos pm
  JOIN processos p                ON p.id = pm.processo_id
  JOIN cliente_processos cp       ON cp.processo_id = pm.processo_id AND cp.status = 'ativo'
  JOIN clientes c                 ON c.id = cp.cliente_id
  JOIN whatsapp_contacts wc       ON wc.cliente_id = c.id
                                  AND wc.verified = true
                                  AND wc.notifications_opt_in = true
  JOIN whatsapp_instancias wi     ON wi.user_id = pm.user_id AND wi.status = 'connected'
  WHERE pm.ativo = true
    -- No movement since tenant-specific cutoff (or global p_cutoff)
    AND NOT EXISTS (
      SELECT 1 FROM movimentacoes mv
      WHERE mv.processo_id = pm.processo_id
        AND mv.data_movimentacao >= COALESCE(
          p_cutoff,
          NOW() - (COALESCE(
            (SELECT ts.reminder_days FROM tenant_settings ts WHERE ts.user_id = pm.user_id),
            7
          ) || ' days')::INTERVAL
        )
    )
    -- No notification sent within the same window
    AND (
      wc.last_notification_sent_at IS NULL
      OR wc.last_notification_sent_at < COALESCE(
          p_cutoff,
          NOW() - (COALESCE(
            (SELECT ts.reminder_days FROM tenant_settings ts WHERE ts.user_id = pm.user_id),
            7
          ) || ' days')::INTERVAL
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION get_proactive_reminder_candidates(TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_proactive_reminder_candidates(TIMESTAMPTZ) TO service_role;
