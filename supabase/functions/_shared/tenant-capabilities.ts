import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface TenantCapabilities {
  plan_name: string;
  max_cadastros: number;
  features: Record<string, unknown>;
}

interface CacheEntry {
  expiresAt: number;
  value: TenantCapabilities;
}

const CACHE_TTL_MS = 30_000;
const capabilitiesCache = new Map<string, CacheEntry>();

export async function getTenantCapabilities(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<TenantCapabilities> {
  const cached = capabilitiesCache.get(tenantId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const { data, error } = await supabase
    .from("tenants")
    .select("plan_id, plans!inner(name, max_cadastros, features)")
    .eq("id", tenantId)
    .single();

  if (error || !data || !data.plans) {
    throw new Error("tenant_capabilities_not_found");
  }

  const planRow = Array.isArray(data.plans) ? data.plans[0] : data.plans;
  const capabilities: TenantCapabilities = {
    plan_name: String(planRow.name),
    max_cadastros: Number(planRow.max_cadastros),
    features: (planRow.features ?? {}) as Record<string, unknown>,
  };

  capabilitiesCache.set(tenantId, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    value: capabilities,
  });

  return capabilities;
}
