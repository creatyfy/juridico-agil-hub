import { cn } from '@/lib/utils';
import StatusBadge from './StatusBadge';

interface TimelineEventProps {
  date: string;
  title: string;
  description: string;
  type?: 'default' | 'important' | 'alert';
  isLast?: boolean;
}

export default function TimelineEvent({ date, title, description, type = 'default', isLast }: TimelineEventProps) {
  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center">
        <div
          className={cn(
            'timeline-dot shrink-0',
            type === 'important' && 'border-accent bg-accent',
            type === 'alert' && 'border-destructive bg-destructive'
          )}
        />
        {!isLast && <div className="w-px flex-1 bg-border mt-2" />}
      </div>
      <div className={cn('pb-6', isLast && 'pb-0')}>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs text-muted-foreground">{date}</span>
          {type === 'important' && <StatusBadge variant="info">Importante</StatusBadge>}
          {type === 'alert' && <StatusBadge variant="error">Alerta</StatusBadge>}
        </div>
        <h4 className="text-sm font-semibold">{title}</h4>
        <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
      </div>
    </div>
  );
}
