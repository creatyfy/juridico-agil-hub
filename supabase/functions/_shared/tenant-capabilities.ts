import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface TenantCapabilities {
  plan_name: string;
  max_cadastros: number;
  features: Record<string, unknown>;
}

export interface FeatureNotAvailableErrorPayload {
  error: "feature_not_available";
  feature: string;
}

export class FeatureNotAvailableError extends Error {
  readonly code = "feature_not_available";
  readonly feature: string;

  constructor(feature: string) {
    super("feature_not_available");
    this.name = "FeatureNotAvailableError";
    this.feature = feature;
  }
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

export async function hasFeature(
  supabase: SupabaseClient,
  tenantId: string,
  featureKey: string,
): Promise<boolean> {
  const capabilities = await getTenantCapabilities(supabase, tenantId);
  return capabilities.features[featureKey] === true;
}

export async function requireFeature(
  supabase: SupabaseClient,
  tenantId: string,
  featureKey: string,
): Promise<void> {
  const enabled = await hasFeature(supabase, tenantId, featureKey);
  if (!enabled) {
    throw new FeatureNotAvailableError(featureKey);
  }
}

export function isFeatureNotAvailableError(
  error: unknown,
): error is FeatureNotAvailableError {
  return error instanceof FeatureNotAvailableError;
}

export function featureNotAvailablePayload(
  feature: string,
): FeatureNotAvailableErrorPayload {
  return {
    error: "feature_not_available",
    feature,
  };
}
