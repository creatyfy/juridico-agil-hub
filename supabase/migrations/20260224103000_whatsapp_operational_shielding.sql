-- Operational shielding: health checks, webhook failure observability and baseline metrics

ALTER TABLE public.whatsapp_instancias
  ADD COLUMN IF NOT EXISTS is_available BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS unavailable_reason TEXT,
  ADD COLUMN IF NOT EXISTS last_health_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS availability_changed_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS public.webhook_failures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  instance_name TEXT,
  webhook_source TEXT NOT NULL,
  event_name TEXT,
  correlation_id TEXT NOT NULL,
  http_status INTEGER NOT NULL,
  error_message TEXT NOT NULL,
  error_stack TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_failures_tenant_created_at
  ON public.webhook_failures (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_webhook_failures_correlation
  ON public.webhook_failures (correlation_id);

CREATE OR REPLACE VIEW public.v_whatsapp_operational_metrics AS
WITH base AS (
  SELECT
    tenant_id,
    COUNT(*) FILTER (WHERE status IN ('accepted', 'delivered'))::numeric AS success_count,
    COUNT(*) FILTER (WHERE attempts > 0)::numeric AS retry_count,
    COUNT(*) FILTER (WHERE status = 'dead_letter')::numeric AS dead_letter_count,
    COUNT(*) FILTER (WHERE status IN ('pending', 'retry', 'sending', 'accepted'))::numeric AS backlog_count,
    COALESCE(
      AVG(EXTRACT(EPOCH FROM (now() - created_at))) FILTER (WHERE status IN ('pending', 'retry', 'sending', 'accepted')),
      0
    )::numeric AS avg_backlog_age_seconds,
    COUNT(*)::numeric AS total
  FROM public.message_outbox
  GROUP BY tenant_id
)
SELECT
  tenant_id,
  COALESCE(ROUND((success_count / NULLIF(total, 0)) * 100, 2), 0) AS success_rate_percent,
  COALESCE(ROUND((retry_count / NULLIF(total, 0)) * 100, 2), 0) AS retry_rate_percent,
  COALESCE(ROUND((dead_letter_count / NULLIF(total, 0)) * 100, 2), 0) AS dead_letter_rate_percent,
  backlog_count,
  avg_backlog_age_seconds,
  now() AS measured_at
FROM base;
