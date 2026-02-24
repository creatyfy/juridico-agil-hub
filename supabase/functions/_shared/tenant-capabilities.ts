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

const DEFAULT_CAPABILITIES: TenantCapabilities = {
  plan_name: "free",
  max_cadastros: 50,
  features: {
    lembrete_monitoramento: true,
    whatsapp_chat: true,
    importacao_processos: true,
  },
};

export async function getTenantCapabilities(
  _supabase: SupabaseClient,
  tenantId: string,
): Promise<TenantCapabilities> {
  const cached = capabilitiesCache.get(tenantId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  // TODO: query tenants/plans tables once they exist.
  // For now, return default capabilities for all tenants.
  const capabilities = { ...DEFAULT_CAPABILITIES };

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
