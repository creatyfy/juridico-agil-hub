import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Bell, CheckCircle2, Circle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useTenantOnboarding } from '@/hooks/useTenantOnboarding';

const labels = {
  import_first_process_judit: 'Etapa 1 – Importar primeiro processo via Judit',
  link_first_client_to_process: 'Etapa 2 – Vincular primeiro cliente ao processo',
  activate_notifications: 'Etapa 3 – Ativar notificações',
} as const;

export default function OnboardingBanner() {
  const {
    status,
    loading,
    currentStep,
    completedCount,
    progressPercent,
    startStep,
    completeStep,
  } = useTenantOnboarding();

  useEffect(() => {
    if (!loading && currentStep && !status.onboarding_completed) {
      startStep(currentStep);
    }
  }, [loading, currentStep, status.onboarding_completed, startStep]);

  if (loading || status.onboarding_completed) return null;

  const activateNotifications = async () => {
    if ('Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission();
    }

    await completeStep('activate_notifications', {
      browser_notification_permission: 'Notification' in window ? Notification.permission : 'unsupported',
    });
  };

  return (
    <div className="sticky top-0 z-20 border border-primary/20 rounded-xl p-4 bg-primary/5 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-semibold text-sm">Onboarding inicial do escritório</p>
          <p className="text-xs text-muted-foreground">Conclua as 3 etapas para liberar totalmente a experiência.</p>
        </div>
        <span className="text-xs font-medium">{completedCount}/3</span>
      </div>

      <Progress value={progressPercent} className="h-2" />
      <p className="text-xs text-muted-foreground">Progresso: {progressPercent}%</p>

      <div className="space-y-2">
        {status.steps.map((step) => (
          <div key={step.step} className="flex items-center gap-2 text-sm">
            {step.completed ? <CheckCircle2 className="h-4 w-4 text-green-600" /> : <Circle className="h-4 w-4 text-muted-foreground" />}
            <span>{labels[step.step]}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        {currentStep === 'import_first_process_judit' && (
          <Button asChild size="sm">
            <Link to="/processos">Importar via Judit</Link>
          </Button>
        )}

        {currentStep === 'link_first_client_to_process' && (
          <Button asChild size="sm" variant="secondary">
            <Link to="/clientes">Vincular cliente</Link>
          </Button>
        )}

        {currentStep === 'activate_notifications' && (
          <Button size="sm" onClick={activateNotifications}>
            <Bell className="h-4 w-4 mr-1" /> Ativar notificações
          </Button>
        )}
      </div>
    </div>
  );
}
