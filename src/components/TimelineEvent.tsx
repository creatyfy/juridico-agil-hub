import { useState } from 'react';
import { cn } from '@/lib/utils';
import { FileText, ChevronDown, ChevronUp, Copy } from 'lucide-react';
import StatusBadge from './StatusBadge';
import { toast } from 'sonner';

interface TimelineEventProps {
  date: string;
  title: string;
  description: string;
  content?: string | null;
  type?: 'default' | 'important' | 'alert';
  isLast?: boolean;
}

export default function TimelineEvent({ date, title, description, content, type = 'default', isLast }: TimelineEventProps) {
  const [expanded, setExpanded] = useState(false);
  const showContent = !!content;
  const hasLongContent = showContent && content.length > 120;
  const displayContent = hasLongContent && !expanded ? content.slice(0, 120) + '…' : content;

  const handleCopy = () => {
    navigator.clipboard.writeText(content || description);
    toast.success('Conteúdo copiado');
  };

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
      <div className={cn('pb-6 flex-1 min-w-0', isLast && 'pb-0')}>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs text-muted-foreground font-medium">{date}</span>
          {type === 'important' && <StatusBadge variant="info">Recente</StatusBadge>}
          {type === 'alert' && <StatusBadge variant="error">Alerta</StatusBadge>}
        </div>
        <h4 className="text-sm font-semibold">{title}</h4>
        <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
        {showContent && (
          <div className="mt-2 rounded-md border border-border/60 bg-muted/20 p-3">
            <div className="flex items-start gap-2">
              <FileText className="h-3.5 w-3.5 mt-0.5 shrink-0 text-accent/60" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground/70 mb-1">Documento / Despacho</p>
                <p className="text-xs text-muted-foreground whitespace-pre-wrap">{displayContent}</p>
              </div>
              <button onClick={handleCopy} className="shrink-0 p-1 rounded hover:bg-muted transition-colors" title="Copiar conteúdo">
                <Copy className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </div>
            {hasLongContent && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="text-xs text-accent hover:underline flex items-center gap-1 mt-2 ml-5"
              >
                {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {expanded ? 'Ver menos' : 'Ver completo'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}