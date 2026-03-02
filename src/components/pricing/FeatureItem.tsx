import { Check, CircleHelp, X } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface FeatureItemProps {
  label: string;
  included: boolean;
  tooltip?: string;
}

export function FeatureItem({ label, included, tooltip }: FeatureItemProps) {
  return (
    <li className="flex items-start gap-2 text-sm text-slate-700">
      {included ? (
        <Check className="h-4 w-4 mt-0.5 text-green-600 shrink-0" />
      ) : (
        <X className="h-4 w-4 mt-0.5 text-slate-400 shrink-0" />
      )}
      <span className="flex items-center gap-1.5">
        {label}
        {tooltip && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button className="text-slate-400 hover:text-slate-600" type="button" aria-label={`Mais detalhes sobre ${label}`}>
                  <CircleHelp className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <p className="max-w-[220px] text-xs">{tooltip}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </span>
    </li>
  );
}
