-- Enforce per-tenant cadastro limits based on tenants.plan_id -> plans.max_cadastros
-- Uses transactional advisory lock to avoid race conditions on concurrent inserts.

CREATE OR REPLACE FUNCTION public.enforce_tenant_cadastro_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_max_cadastros INTEGER;
  v_current_count BIGINT;
BEGIN
  v_tenant_id := COALESCE(NEW.tenant_id, NEW.user_id);

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'tenant_id_required_for_plan_enforcement';
  END IF;

  NEW.tenant_id := v_tenant_id;


  -- Serializes count+insert for the same tenant inside the current transaction.
  PERFORM pg_advisory_xact_lock(hashtextextended('clientes_limit:' || v_tenant_id::text, 0));

  IF EXISTS (
    SELECT 1
    FROM public.clientes c
    WHERE c.user_id = NEW.user_id
      AND c.documento IS NOT DISTINCT FROM NEW.documento
  ) THEN
    RETURN NEW;
  END IF;

  IF NEW.cpf IS NOT NULL AND NEW.cpf <> ''
     AND EXISTS (
       SELECT 1
       FROM public.clientes c
       WHERE c.tenant_id = v_tenant_id
         AND c.cpf = NEW.cpf
     ) THEN
    RETURN NEW;
  END IF;

  SELECT p.max_cadastros
    INTO v_max_cadastros
  FROM public.tenants t
  JOIN public.plans p ON p.id = t.plan_id
  WHERE t.id = v_tenant_id
  FOR UPDATE;

  IF v_max_cadastros IS NULL THEN
    RAISE EXCEPTION USING MESSAGE = 'tenant_plan_not_configured';
  END IF;

  SELECT COUNT(*)
    INTO v_current_count
  FROM public.clientes c
  WHERE c.tenant_id = v_tenant_id;

  IF v_current_count >= v_max_cadastros THEN
    RAISE EXCEPTION USING MESSAGE = 'plan_limit_reached';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_tenant_cadastro_limit ON public.clientes;
CREATE TRIGGER trg_enforce_tenant_cadastro_limit
BEFORE INSERT ON public.clientes
FOR EACH ROW
EXECUTE FUNCTION public.enforce_tenant_cadastro_limit();

GRANT EXECUTE ON FUNCTION public.enforce_tenant_cadastro_limit() TO authenticated, service_role;
