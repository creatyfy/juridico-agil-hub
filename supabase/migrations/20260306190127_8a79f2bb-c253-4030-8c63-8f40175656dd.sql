CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

ALTER TABLE public.message_outbox
  ADD COLUMN IF NOT EXISTS accepted_reconciled_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.domain_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  event_type TEXT NOT NULL,
  dedupe_key TEXT,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'processed', 'retry', 'dead_letter')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_retry_at TIMESTAMPTZ,
  last_error TEXT,
  worker_id TEXT,
  lease_until TIMESTAMPTZ,
  lease_version BIGINT NOT NULL DEFAULT 0,
  processing_started_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  dead_lettered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_domain_events_dedupe
  ON public.domain_events(tenant_id, event_type, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_domain_events_claim
  ON public.domain_events(status, next_retry_at, created_at)
  WHERE status IN ('pending', 'retry');

CREATE INDEX IF NOT EXISTS idx_domain_events_tenant_created
  ON public.domain_events(tenant_id, created_at DESC);

ALTER TABLE public.domain_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own tenant domain events" ON public.domain_events;
CREATE POLICY "Users can read own tenant domain events"
ON public.domain_events FOR SELECT
TO authenticated
USING (tenant_id = auth.uid());

DROP POLICY IF EXISTS "Service role full access domain events" ON public.domain_events;
CREATE POLICY "Service role full access domain events"
ON public.domain_events FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.inbound_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  instance_id UUID NOT NULL REFERENCES public.whatsapp_instancias(id) ON DELETE CASCADE,
  provider_message_id TEXT NOT NULL,
  phone TEXT NOT NULL,
  payload_raw JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, instance_id, provider_message_id)
);

CREATE INDEX IF NOT EXISTS idx_inbound_messages_tenant_phone_created
  ON public.inbound_messages(tenant_id, phone, created_at);

ALTER TABLE public.inbound_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own inbound messages" ON public.inbound_messages;
CREATE POLICY "Users can read own inbound messages"
ON public.inbound_messages FOR SELECT
TO authenticated
USING (tenant_id = auth.uid());

DROP POLICY IF EXISTS "Service role full access inbound messages" ON public.inbound_messages;
CREATE POLICY "Service role full access inbound messages"
ON public.inbound_messages FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.conversation_processing_locks (
  tenant_id UUID NOT NULL,
  phone TEXT NOT NULL,
  worker_id TEXT,
  lease_until TIMESTAMPTZ,
  fence_token BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, phone)
);

ALTER TABLE public.conversation_processing_locks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access conversation processing locks" ON public.conversation_processing_locks;
CREATE POLICY "Service role full access conversation processing locks"
ON public.conversation_processing_locks FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.worker_processing_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_name TEXT NOT NULL,
  event_id UUID,
  tenant_id UUID,
  event_type TEXT,
  status TEXT NOT NULL,
  retries INTEGER NOT NULL DEFAULT 0,
  processing_ms INTEGER,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_worker_metrics_worker_created
  ON public.worker_processing_metrics(worker_name, created_at DESC);

ALTER TABLE public.worker_processing_metrics ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access worker metrics" ON public.worker_processing_metrics;
CREATE POLICY "Service role full access worker metrics"
ON public.worker_processing_metrics FOR ALL
TO service_role
USING (true)
WITH CHECK (true);