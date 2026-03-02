import { useMemo } from 'react';
import { User } from '@/contexts/AuthContext';
import { useTenantCapabilities } from './useTenantCapabilities';

export type FeatureKey = string;

export interface PlanAwareUser extends User {
  activePlanFeatures?: Record<string, boolean>;
}

export function canAccess(user: PlanAwareUser | null | undefined, feature: FeatureKey): boolean {
  if (!user?.activePlanFeatures) {
    return false;
  }

  return Boolean(user.activePlanFeatures[feature]);
}

export function useCanAccess(feature: FeatureKey) {
  const { data, isLoading } = useTenantCapabilities();

  const allowed = useMemo(() => {
    const features = (data?.features ?? {}) as Record<string, unknown>;
    return Boolean(features[feature]);
  }, [data?.features, feature]);

  return { allowed, isLoading };
}
