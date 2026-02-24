import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';

export interface TenantUsage {
  total_cadastros_atual: number;
  percentual_uso: number;
  limite_plano: number;
  warning_80_percent: boolean;
  soft_limit_state: 'ok' | 'warning' | 'reached';
  remaining_cadastros: number;
}

export const TENANT_USAGE_QUERY_KEY = ['tenant-usage'] as const;

async function fetchTenantUsage(): Promise<TenantUsage> {
  const { data, error } = await supabase.functions.invoke('get-tenant-usage', {
    method: 'GET',
  });

  if (error) {
    throw error;
  }

  return data as TenantUsage;
}

export function useTenantUsage(enabled = true) {
  return useQuery({
    queryKey: TENANT_USAGE_QUERY_KEY,
    queryFn: fetchTenantUsage,
    enabled,
    staleTime: 15_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useRefreshTenantUsage() {
  const queryClient = useQueryClient();

  return () => queryClient.invalidateQueries({ queryKey: TENANT_USAGE_QUERY_KEY });
}
