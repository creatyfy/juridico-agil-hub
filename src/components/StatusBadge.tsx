import { cn } from '@/lib/utils';

type StatusVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral';

interface StatusBadgeProps {
  variant: StatusVariant;
  children: React.ReactNode;
  className?: string;
}

const variantClasses: Record<StatusVariant, string> = {
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  error: 'bg-destructive/10 text-destructive',
  info: 'bg-accent/10 text-accent',
  neutral: 'bg-muted text-muted-foreground',
};

export default function StatusBadge({ variant, children, className }: StatusBadgeProps) {
  return (
    <span className={cn('badge-status', variantClasses[variant], className)}>
      {children}
    </span>
  );
}
