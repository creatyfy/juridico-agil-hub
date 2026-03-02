CREATE TABLE IF NOT EXISTS public.process_movement_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  process_id UUID NOT NULL REFERENCES public.processos(id) ON DELETE CASCADE,
  movement_id UUID NOT NULL,
  contact_id UUID NOT NULL REFERENCES public.whatsapp_contacts(id) ON DELETE CASCADE,
  notified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_process_movement_notifications UNIQUE (tenant_id, movement_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_process_movement_notifications_lookup
  ON public.process_movement_notifications (tenant_id, process_id, movement_id, contact_id);
