
-- message_outbox table
CREATE TABLE IF NOT EXISTS public.message_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  aggregate_type TEXT NOT NULL DEFAULT 'whatsapp',
  aggregate_id UUID,
  idempotency_key TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending',
  campaign_job_id UUID,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ,
  lease_until TIMESTAMPTZ,
  worker_id TEXT,
  provider_message_id TEXT,
  dead_lettered_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_message_outbox_status ON public.message_outbox(status, created_at);
CREATE INDEX IF NOT EXISTS idx_message_outbox_tenant ON public.message_outbox(tenant_id, status);

-- campaign_jobs table
CREATE TABLE IF NOT EXISTS public.campaign_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  instance_id UUID NOT NULL REFERENCES public.whatsapp_instancias(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payload_template JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_campaign_jobs_tenant_status
  ON public.campaign_jobs(tenant_id, status, created_at DESC);

-- campaign_recipients table
CREATE TABLE IF NOT EXISTS public.campaign_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_job_id UUID NOT NULL REFERENCES public.campaign_jobs(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,
  destination TEXT NOT NULL,
  reference TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  outbox_id UUID REFERENCES public.message_outbox(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_job_id, reference)
);

CREATE INDEX IF NOT EXISTS idx_campaign_recipients_claim
  ON public.campaign_recipients(campaign_job_id, status, created_at);

-- FK from message_outbox to campaign_jobs
ALTER TABLE public.message_outbox
  ADD CONSTRAINT fk_message_outbox_campaign_job
  FOREIGN KEY (campaign_job_id) REFERENCES public.campaign_jobs(id) ON DELETE SET NULL;

-- RLS
ALTER TABLE public.message_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_recipients ENABLE ROW LEVEL SECURITY;

-- message_outbox: service role only (edge functions use service role)
CREATE POLICY "Service role full access on message_outbox" ON public.message_outbox FOR ALL USING (true) WITH CHECK (true);

-- campaign_jobs: users can manage their own
CREATE POLICY "Users can view own campaign_jobs" ON public.campaign_jobs FOR SELECT USING (auth.uid() = tenant_id);
CREATE POLICY "Users can insert own campaign_jobs" ON public.campaign_jobs FOR INSERT WITH CHECK (auth.uid() = tenant_id);
CREATE POLICY "Users can update own campaign_jobs" ON public.campaign_jobs FOR UPDATE USING (auth.uid() = tenant_id);

-- campaign_recipients: users can manage their own
CREATE POLICY "Users can view own campaign_recipients" ON public.campaign_recipients FOR SELECT USING (auth.uid() = tenant_id);
CREATE POLICY "Users can insert own campaign_recipients" ON public.campaign_recipients FOR INSERT WITH CHECK (auth.uid() = tenant_id);
CREATE POLICY "Users can update own campaign_recipients" ON public.campaign_recipients FOR UPDATE USING (auth.uid() = tenant_id);
