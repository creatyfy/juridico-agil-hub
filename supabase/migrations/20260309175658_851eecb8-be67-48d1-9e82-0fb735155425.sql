
-- Fix view to use security invoker (default) instead of security definer
DROP VIEW IF EXISTS public.v_whatsapp_operational_metrics;
CREATE VIEW public.v_whatsapp_operational_metrics WITH (security_invoker = true) AS
SELECT
  tenant_id,
  ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'accepted') / NULLIF(COUNT(*), 0), 1) AS success_rate_percent,
  ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'retry') / NULLIF(COUNT(*), 0), 1) AS retry_rate_percent,
  ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'dead_letter') / NULLIF(COUNT(*), 0), 1) AS dead_letter_rate_percent,
  COUNT(*) FILTER (WHERE status IN ('pending', 'retry', 'sending')) AS backlog_count,
  COALESCE(EXTRACT(EPOCH FROM AVG(now() - created_at) FILTER (WHERE status IN ('pending', 'retry'))), 0) AS avg_backlog_age_seconds
FROM public.message_outbox
WHERE created_at > now() - interval '24 hours'
GROUP BY tenant_id;
