-- Tenant Health Score (0-100)
-- Baseado em: eventos 30d, usuários ativos 30d, uso de feature premium e percentual de uso do plano.

-- 1) View com métricas brutas + score normalizado por tenant.
CREATE OR REPLACE VIEW public.v_tenant_health_score AS
WITH usage_base AS (
  SELECT
    tu.tenant_id,
    COALESCE(tu.current_usage, 0)::numeric AS current_usage,
    COALESCE(tu.max_usage, 0)::numeric AS max_usage
  FROM public.tenant_usage tu
),
metrics_30d AS (
  SELECT
    al.tenant_id,
    COUNT(*) FILTER (
      WHERE al.created_at >= now() - interval '30 days'
    )::numeric AS eventos_30d,
    COUNT(DISTINCT al.user_id) FILTER (
      WHERE al.created_at >= now() - interval '30 days'
        AND al.user_id IS NOT NULL
    )::numeric AS usuarios_ativos_30d,
    COUNT(*) FILTER (
      WHERE al.created_at >= now() - interval '30 days'
        AND (
          COALESCE(al.metadata->>'plan_tier', '') = 'premium'
          OR COALESCE(al.metadata->>'feature_tier', '') = 'premium'
          OR COALESCE(al.metadata->>'event_name', '') IN (
            'primeira_feature_premium',
            'feature_premium_used'
          )
        )
    )::numeric AS eventos_premium_30d
  FROM public.audit_logs al
  GROUP BY al.tenant_id
),
prepared AS (
  SELECT
    ub.tenant_id,
    COALESCE(m.eventos_30d, 0) AS eventos_30d,
    COALESCE(m.usuarios_ativos_30d, 0) AS usuarios_ativos_30d,
    COALESCE(m.eventos_premium_30d, 0) AS eventos_premium_30d,
    CASE
      WHEN ub.max_usage > 0
        THEN LEAST((ub.current_usage / ub.max_usage) * 100, 100)
      ELSE 0
    END AS percentual_uso_plano
  FROM usage_base ub
  LEFT JOIN metrics_30d m ON m.tenant_id = ub.tenant_id
),
normalized AS (
  SELECT
    p.*,
    LEAST(p.eventos_30d / 100.0, 1.0) AS eventos_norm,
    LEAST(p.usuarios_ativos_30d / 20.0, 1.0) AS ativos_norm,
    LEAST(p.eventos_premium_30d / 15.0, 1.0) AS premium_norm,
    LEAST(p.percentual_uso_plano / 100.0, 1.0) AS plano_norm
  FROM prepared p
)
SELECT
  n.tenant_id,
  n.eventos_30d,
  n.usuarios_ativos_30d,
  n.eventos_premium_30d,
  ROUND(n.percentual_uso_plano, 2) AS percentual_uso_plano,
  ROUND(
    100 * (
      0.30 * n.eventos_norm +
      0.25 * n.ativos_norm +
      0.20 * n.premium_norm +
      0.25 * n.plano_norm
    )
  )::int AS health_score,
  CASE
    WHEN (
      100 * (
        0.30 * n.eventos_norm +
        0.25 * n.ativos_norm +
        0.20 * n.premium_norm +
        0.25 * n.plano_norm
      )
    ) >= 70 THEN 'healthy'
    WHEN (
      100 * (
        0.30 * n.eventos_norm +
        0.25 * n.ativos_norm +
        0.20 * n.premium_norm +
        0.25 * n.plano_norm
      )
    ) >= 40 THEN 'at-risk'
    ELSE 'churn-risk'
  END AS health_category
FROM normalized n;

-- 2) Consulta principal para CRM/CS (score + categoria).
SELECT
  tenant_id,
  eventos_30d,
  usuarios_ativos_30d,
  eventos_premium_30d,
  percentual_uso_plano,
  health_score,
  health_category
FROM public.v_tenant_health_score
ORDER BY health_score DESC;

-- 3) Ações automáticas sugeridas por categoria.
SELECT
  v.tenant_id,
  v.health_score,
  v.health_category,
  CASE v.health_category
    WHEN 'healthy' THEN 'upsell_nudge_and_advocacy_campaign'
    WHEN 'at-risk' THEN 'activation_nudge_and_csm_followup_if_14d'
    ELSE 'urgent_csm_recovery_playbook'
  END AS recommended_automation
FROM public.v_tenant_health_score v
ORDER BY v.health_score ASC;
