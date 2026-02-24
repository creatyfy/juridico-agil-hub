import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';

export interface TenantCapabilities {
  plan_name: string;
  max_cadastros: number;
  features: Record<string, unknown>;
}

export const TENANT_CAPABILITIES_QUERY_KEY = ['tenant-capabilities'] as const;

async function fetchTenantCapabilities(): Promise<TenantCapabilities> {
  const { data, error } = await supabase.functions.invoke('get-tenant-capabilities', {
    method: 'GET',
  });

  if (error) {
    throw error;
  }

  return data as TenantCapabilities;
}

export function useTenantCapabilities(enabled = true) {
  return useQuery({
    queryKey: TENANT_CAPABILITIES_QUERY_KEY,
    queryFn: fetchTenantCapabilities,
    enabled,
    staleTime: 15_000,
    gcTime: 5 * 60_000,
    refetchOnWindowFocus: true,
  });
}

export function useRefreshTenantCapabilities() {
  const queryClient = useQueryClient();

  return () => queryClient.invalidateQueries({ queryKey: TENANT_CAPABILITIES_QUERY_KEY });
}
