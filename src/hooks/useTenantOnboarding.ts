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

    // Derive onboarding status from actual data instead of RPC
    try {
      const [processosRes, clientesRes] = await Promise.all([
        supabase.from('processos').select('id', { count: 'exact', head: true }),
        supabase.from('cliente_processos').select('id', { count: 'exact', head: true }).eq('status', 'ativo'),
      ]);

      const hasProcessos = (processosRes.count ?? 0) > 0;
      const hasClientes = (clientesRes.count ?? 0) > 0;

      const steps: OnboardingStatus['steps'] = [
        { step: 'import_first_process_judit', completed: hasProcessos },
        { step: 'link_first_client_to_process', completed: hasClientes },
        { step: 'activate_notifications', completed: false },
      ];

      const allCompleted = steps.every((s) => s.completed);

      setStatus({
        is_first_access: !hasProcessos,
        onboarding_completed: allCompleted,
        steps,
      });
    } catch (e) {
      console.error('Onboarding status error:', e);
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

  const startStep = useCallback(async (_step: OnboardingStepKey) => {
    // No-op until onboarding RPC functions are created
  }, []);

  const completeStep = useCallback(async (_step: OnboardingStepKey, _metadata?: Record<string, unknown>) => {
    await fetchStatus();
  }, [fetchStatus]);

  return { status, loading, currentStep, completedCount, progressPercent, startStep, completeStep, refetch: fetchStatus };
}
