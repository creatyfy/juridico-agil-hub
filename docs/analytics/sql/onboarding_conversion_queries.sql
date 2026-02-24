-- Onboarding analytics
-- 1) % de advogados/tenants que concluíram o onboarding
SELECT
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE t.onboarding_completed) / NULLIF(COUNT(*), 0),
    2
  ) AS pct_onboarding_completo
FROM public.tenants t;

-- 2) Tempo médio para completar onboarding (da criação do tenant ao evento onboarding_completed)
SELECT
  AVG(al.created_at - t.created_at) AS tempo_medio_onboarding,
  AVG(EXTRACT(EPOCH FROM (al.created_at - t.created_at)))::bigint AS tempo_medio_onboarding_segundos
FROM public.tenants t
JOIN LATERAL (
  SELECT MIN(created_at) AS created_at
  FROM public.audit_logs
  WHERE tenant_id = t.id
    AND action = 'onboarding_completed'
) al ON al.created_at IS NOT NULL;
