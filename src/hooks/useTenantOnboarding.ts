import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export type OnboardingStepKey =
  | 'import_first_process_judit'
  | 'link_first_client_to_process'
  | 'activate_notifications';

type OnboardingStatus = {
  is_first_access: boolean;
  onboarding_completed: boolean;
  steps: Array<{ step: OnboardingStepKey; completed: boolean }>;
};

const STEP_ORDER: OnboardingStepKey[] = [
  'import_first_process_judit',
  'link_first_client_to_process',
  'activate_notifications',
];

const DEFAULT_STATUS: OnboardingStatus = {
  is_first_access: true,
  onboarding_completed: false,
  steps: STEP_ORDER.map((step) => ({ step, completed: false })),
};

export function useTenantOnboarding() {
  const { user } = useAuth();
  const [status, setStatus] = useState<OnboardingStatus>(DEFAULT_STATUS);
  const [loading, setLoading] = useState(true);

  const fetchStatus = useCallback(async () => {
    if (!user || user.role !== 'advogado') {
      setLoading(false);
      return;
    }

    setLoading(true);
    const { data, error } = await supabase.rpc('get_tenant_onboarding_status');

    if (!error && data) {
      setStatus(data as OnboardingStatus);
    }

    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const currentStep = useMemo(() => {
    return STEP_ORDER.find((step) => !status.steps.find((s) => s.step === step)?.completed) ?? null;
  }, [status.steps]);

  const completedCount = status.steps.filter((s) => s.completed).length;
  const progressPercent = completedCount === 0 ? 0 : Math.round((completedCount / 3) * 100);

  const startStep = useCallback(async (step: OnboardingStepKey) => {
    await supabase.rpc('start_tenant_onboarding_step', { p_step: step });
  }, []);

  const completeStep = useCallback(async (step: OnboardingStepKey, metadata?: Record<string, unknown>) => {
    await supabase.rpc('complete_tenant_onboarding_step', { p_step: step, p_metadata: metadata ?? {} });
    await fetchStatus();
  }, [fetchStatus]);

  return { status, loading, currentStep, completedCount, progressPercent, startStep, completeStep, refetch: fetchStatus };
}
