-- Foundation for tenant usage queries (dashboard + upsell + progressive soft-limit signaling).
-- Ensures tenant scoped count queries remain efficient.

CREATE INDEX IF NOT EXISTS idx_clientes_tenant_id ON public.clientes(tenant_id);
