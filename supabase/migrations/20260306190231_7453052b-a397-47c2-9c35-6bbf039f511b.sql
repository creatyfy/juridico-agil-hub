CREATE TABLE IF NOT EXISTS public.whatsapp_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  phone_number VARCHAR(32) NOT NULL,
  client_id UUID REFERENCES public.clientes(id) ON DELETE SET NULL,
  process_id UUID REFERENCES public.processos(id) ON DELETE SET NULL,
  verified BOOLEAN NOT NULL DEFAULT false,
  conversation_state VARCHAR(32) NOT NULL DEFAULT 'IDLE',
  notifications_opt_in BOOLEAN NOT NULL DEFAULT false,
  cpf_attempts SMALLINT NOT NULL DEFAULT 0 CHECK (cpf_attempts >= 0 AND cpf_attempts <= 3),
  otp_attempts SMALLINT NOT NULL DEFAULT 0 CHECK (otp_attempts >= 0 AND otp_attempts <= 3),
  blocked_until TIMESTAMPTZ,
  last_notification_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, phone_number)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_contacts_tenant_client ON public.whatsapp_contacts(tenant_id, client_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_contacts_tenant_process ON public.whatsapp_contacts(tenant_id, process_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_contacts_verified_optin ON public.whatsapp_contacts(tenant_id, verified, notifications_opt_in);

ALTER TABLE public.whatsapp_contacts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'whatsapp_contacts' AND policyname = 'Users can select own tenant whatsapp contacts'
  ) THEN
    CREATE POLICY "Users can select own tenant whatsapp contacts" ON public.whatsapp_contacts FOR SELECT USING (auth.uid() = tenant_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'whatsapp_contacts' AND policyname = 'Users can insert own tenant whatsapp contacts'
  ) THEN
    CREATE POLICY "Users can insert own tenant whatsapp contacts" ON public.whatsapp_contacts FOR INSERT WITH CHECK (auth.uid() = tenant_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'whatsapp_contacts' AND policyname = 'Users can update own tenant whatsapp contacts'
  ) THEN
    CREATE POLICY "Users can update own tenant whatsapp contacts" ON public.whatsapp_contacts FOR UPDATE USING (auth.uid() = tenant_id) WITH CHECK (auth.uid() = tenant_id);
  END IF;
END $$;

DROP POLICY IF EXISTS "Service role full access whatsapp contacts" ON public.whatsapp_contacts;
CREATE POLICY "Service role full access whatsapp contacts"
ON public.whatsapp_contacts FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.conversation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  phone_number VARCHAR(32) NOT NULL,
  message TEXT NOT NULL,
  direction VARCHAR(16) NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  intent VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversation_logs_tenant_phone_created ON public.conversation_logs(tenant_id, phone_number, created_at DESC);

ALTER TABLE public.conversation_logs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'conversation_logs' AND policyname = 'Users can select own tenant conversation logs'
  ) THEN
    CREATE POLICY "Users can select own tenant conversation logs" ON public.conversation_logs FOR SELECT USING (auth.uid() = tenant_id);
  END IF;
END $$;

DROP POLICY IF EXISTS "Service role full access conversation logs" ON public.conversation_logs;
CREATE POLICY "Service role full access conversation logs"
ON public.conversation_logs FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.process_consultation_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  phone_number VARCHAR(32) NOT NULL,
  client_id UUID,
  process_id UUID,
  intent VARCHAR(64) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_process_consultation_audit_tenant_created ON public.process_consultation_audit_logs(tenant_id, created_at DESC);