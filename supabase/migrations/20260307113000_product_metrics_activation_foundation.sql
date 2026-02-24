-- Product metrics foundation for activation + retention analysis.
-- Reuses public.audit_logs as source of truth (no duplicated events table).

-- 1) Targeted partial index for activation-event windows.
CREATE INDEX IF NOT EXISTS idx_audit_logs_activation_window
  ON public.audit_logs (tenant_id, created_at DESC, user_id)
  WHERE (
    action IN ('cadastro_created', 'primeira_feature_premium', 'primeiro_convite_enviado')
    OR (metadata ? 'event_name' AND metadata->>'event_name' IN ('cadastro_created', 'primeira_feature_premium', 'primeiro_convite_enviado'))
  );

-- 2) Aggregated per-tenant product metrics view (7d/30d + MAU proxy + first event).
CREATE OR REPLACE VIEW public.v_tenant_product_metrics_agg AS
WITH activation_events AS (
  SELECT
    al.tenant_id,
    al.user_id,
    al.created_at,
    COALESCE(
      NULLIF(al.metadata->>'event_name', ''),
      CASE
        WHEN al.action = 'cadastro_created' THEN 'cadastro_created'
        WHEN al.action = 'primeira_feature_premium' THEN 'primeira_feature_premium'
        WHEN al.action = 'primeiro_convite_enviado' THEN 'primeiro_convite_enviado'
        ELSE NULL
      END
    ) AS event_name
  FROM public.audit_logs al
  WHERE
    al.action IN ('cadastro_created', 'primeira_feature_premium', 'primeiro_convite_enviado')
    OR (al.metadata ? 'event_name' AND al.metadata->>'event_name' IN ('cadastro_created', 'primeira_feature_premium', 'primeiro_convite_enviado'))
)
SELECT
  ae.tenant_id,
  COUNT(*) FILTER (WHERE ae.created_at >= now() - interval '7 days')::BIGINT AS total_eventos_7d,
  COUNT(*) FILTER (WHERE ae.created_at >= now() - interval '30 days')::BIGINT AS total_eventos_30d,
  COUNT(DISTINCT ae.user_id) FILTER (WHERE ae.created_at >= now() - interval '30 days' AND ae.user_id IS NOT NULL)::BIGINT AS usuarios_ativos_30d,
  MIN(ae.created_at) AS data_primeiro_evento
FROM activation_events ae
WHERE ae.event_name IN ('cadastro_created', 'primeira_feature_premium', 'primeiro_convite_enviado')
GROUP BY ae.tenant_id;

COMMENT ON VIEW public.v_tenant_product_metrics_agg IS
'Per-tenant activation metrics based on audit_logs: total_eventos_7d, total_eventos_30d, usuarios_ativos_30d, data_primeiro_evento.';
