-- Tenant-scoped audit log foundation.
-- Supports period/user filters and enterprise CSV export workloads.

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT audit_logs_action_not_blank CHECK (length(trim(action)) > 0),
  CONSTRAINT audit_logs_entity_not_blank CHECK (length(trim(entity)) > 0),
  CONSTRAINT audit_logs_metadata_is_object CHECK (jsonb_typeof(metadata) = 'object')
);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own tenant audit logs" ON public.audit_logs;
CREATE POLICY "Users can read own tenant audit logs"
ON public.audit_logs
FOR SELECT
TO authenticated
USING (tenant_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own tenant audit logs" ON public.audit_logs;
CREATE POLICY "Users can insert own tenant audit logs"
ON public.audit_logs
FOR INSERT
TO authenticated
WITH CHECK (tenant_id = auth.uid() AND (user_id IS NULL OR user_id = auth.uid()));

DROP POLICY IF EXISTS "Service role can read all audit logs" ON public.audit_logs;
CREATE POLICY "Service role can read all audit logs"
ON public.audit_logs
FOR SELECT
TO service_role
USING (true);

-- Index strategy focused on common filters and enterprise export.
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_created_at
  ON public.audit_logs(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_user_created_at
  ON public.audit_logs(tenant_id, user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_action_created_at
  ON public.audit_logs(tenant_id, action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_metadata_gin
  ON public.audit_logs USING GIN (metadata);

-- Plan upgrades/downgrades are critical events; auto-log whenever plan_id changes.
CREATE OR REPLACE FUNCTION public.audit_log_tenant_plan_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_old_plan_name TEXT;
  v_new_plan_name TEXT;
  v_old_price NUMERIC;
  v_new_price NUMERIC;
  v_action TEXT;
BEGIN
  IF NEW.plan_id IS NOT DISTINCT FROM OLD.plan_id THEN
    RETURN NEW;
  END IF;

  SELECT name, price_monthly INTO v_old_plan_name, v_old_price FROM public.plans WHERE id = OLD.plan_id;
  SELECT name, price_monthly INTO v_new_plan_name, v_new_price FROM public.plans WHERE id = NEW.plan_id;

  v_action := CASE
    WHEN OLD.plan_id IS NULL THEN 'plan_assigned'
    WHEN NEW.plan_id IS NULL THEN 'plan_removed'
    WHEN COALESCE(v_new_price, 0) > COALESCE(v_old_price, 0) THEN 'plan_upgraded'
    WHEN COALESCE(v_new_price, 0) < COALESCE(v_old_price, 0) THEN 'plan_downgraded'
    ELSE 'plan_changed'
  END;

  INSERT INTO public.audit_logs (
    tenant_id,
    user_id,
    action,
    entity,
    entity_id,
    metadata
  ) VALUES (
    NEW.id,
    auth.uid(),
    v_action,
    'tenant',
    NEW.id::text,
    jsonb_build_object(
      'old_plan_id', OLD.plan_id,
      'new_plan_id', NEW.plan_id,
      'old_plan_name', v_old_plan_name,
      'new_plan_name', v_new_plan_name,
      'old_price_monthly', v_old_price,
      'new_price_monthly', v_new_price
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_log_tenant_plan_change ON public.tenants;
CREATE TRIGGER trg_audit_log_tenant_plan_change
AFTER UPDATE OF plan_id ON public.tenants
FOR EACH ROW
EXECUTE FUNCTION public.audit_log_tenant_plan_change();
