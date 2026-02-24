-- Fundação de métricas de ativação + retenção usando somente public.audit_logs.
-- Objetivo: disponibilizar base para dashboard interno sem duplicar tabela de eventos.

-- 1) Índice parcial focado nos eventos-chave de ativação.
CREATE INDEX IF NOT EXISTS idx_audit_logs_activation_window
  ON public.audit_logs (tenant_id, created_at DESC, user_id)
  WHERE (
    action IN ('cadastro_created', 'primeira_feature_premium', 'primeiro_convite_enviado')
    OR (metadata ? 'event_name' AND metadata->>'event_name' IN ('cadastro_created', 'primeira_feature_premium', 'primeiro_convite_enviado'))
  );

-- 2) View agregada por tenant para o dashboard de produto.
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
  COUNT(DISTINCT ae.user_id) FILTER (
    WHERE ae.created_at >= now() - interval '30 days'
      AND ae.user_id IS NOT NULL
  )::BIGINT AS usuarios_ativos_30d,
  MIN(ae.created_at) AS data_primeiro_evento
FROM activation_events ae
WHERE ae.event_name IN ('cadastro_created', 'primeira_feature_premium', 'primeiro_convite_enviado')
GROUP BY ae.tenant_id;

-- 3) Query de leitura para painel interno (top tenants por atividade 30d).
SELECT
  tenant_id,
  total_eventos_7d,
  total_eventos_30d,
  usuarios_ativos_30d,
  data_primeiro_evento
FROM public.v_tenant_product_metrics_agg
ORDER BY total_eventos_30d DESC;

-- 4) Drill-down operacional para analisar ativação dia a dia por tenant.
SELECT
  tenant_id,
  COALESCE(metadata->>'event_name', action) AS event_name,
  date_trunc('day', created_at) AS dia,
  COUNT(*) AS total_eventos,
  COUNT(DISTINCT user_id) AS usuarios_unicos
FROM public.audit_logs
WHERE created_at >= now() - interval '30 days'
  AND (
    action IN ('cadastro_created', 'primeira_feature_premium', 'primeiro_convite_enviado')
    OR (metadata ? 'event_name' AND metadata->>'event_name' IN ('cadastro_created', 'primeira_feature_premium', 'primeiro_convite_enviado'))
  )
GROUP BY 1, 2, 3
ORDER BY dia DESC, total_eventos DESC;

-- 5) Sugestão opcional para cache de consulta no Postgres (materialized view).
-- Use apenas quando a leitura crescer e TTL de aplicação não for suficiente.
-- CREATE MATERIALIZED VIEW public.mv_tenant_product_metrics_agg AS
-- SELECT * FROM public.v_tenant_product_metrics_agg;
--
-- REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_tenant_product_metrics_agg;
