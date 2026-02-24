import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getTenantCapabilities } from "./tenant-capabilities.ts";

export interface TenantUsage {
  total_cadastros_atual: number;
  percentual_uso: number;
  limite_plano: number;
  warning_80_percent: boolean;
  soft_limit_state: "ok" | "warning" | "reached";
  remaining_cadastros: number;
}

interface CacheEntry {
  expiresAt: number;
  value: TenantUsage;
}

const CACHE_TTL_MS = 15_000;
const usageCache = new Map<string, CacheEntry>();

export async function getTenantUsage(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<TenantUsage> {
  const cached = usageCache.get(tenantId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const capabilities = await getTenantCapabilities(supabase, tenantId);

  const { count, error } = await supabase
    .from("clientes")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);

  if (error) {
    throw new Error("tenant_usage_count_failed");
  }

  const totalCadastrosAtual = Number(count ?? 0);
  const limitePlano = Math.max(Number(capabilities.max_cadastros ?? 0), 0);
  const percentualUso = limitePlano === 0
    ? 0
    : Math.min(100, Number(((totalCadastrosAtual / limitePlano) * 100).toFixed(2)));

  const usage: TenantUsage = {
    total_cadastros_atual: totalCadastrosAtual,
    percentual_uso: percentualUso,
    limite_plano: limitePlano,
    warning_80_percent: percentualUso >= 80,
    soft_limit_state: percentualUso >= 100
      ? "reached"
      : percentualUso >= 80
      ? "warning"
      : "ok",
    remaining_cadastros: Math.max(limitePlano - totalCadastrosAtual, 0),
  };

  usageCache.set(tenantId, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    value: usage,
  });

  return usage;
}
