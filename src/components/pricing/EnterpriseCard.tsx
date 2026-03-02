import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PlanFeature, BillingCycle, enterprisePricing } from '@/lib/pricing';
import { FeatureItem } from './FeatureItem';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface EnterpriseCardProps {
  features: PlanFeature[];
  cycle: BillingCycle;
}

const processOptions = [1000, 2000, 3000, 5000] as const;

export function EnterpriseCard({ features, cycle }: EnterpriseCardProps) {
  const [selectedProcesses, setSelectedProcesses] = useState<number>(1000);

  const monthlyPrice = enterprisePricing[selectedProcesses] ?? enterprisePricing[1000];
  const billedPrice = useMemo(() => (cycle === 'annual' ? monthlyPrice * 0.8 : monthlyPrice), [cycle, monthlyPrice]);

  const priceLabel = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(billedPrice);

  return (
    <article className="flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="text-xl font-bold text-black">ENTERPRISE</h3>
      <p className="mt-1 text-xs text-slate-500">Preço variável por número de processos</p>

      <div className="mt-4">
        <Select value={String(selectedProcesses)} onValueChange={(value) => setSelectedProcesses(Number(value))}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Selecione os processos" />
          </SelectTrigger>
          <SelectContent>
            {processOptions.map((option) => (
              <SelectItem key={option} value={String(option)}>
                {option.toLocaleString('pt-BR')} processos
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="mt-4 flex items-end gap-1">
        <p className="text-4xl font-bold text-black leading-none">{priceLabel}</p>
        <span className="text-sm text-slate-500 mb-1">/mês</span>
      </div>
      <p className="mt-1 text-xs text-slate-500">Base de R$1.300,00/mês para 1.000 processos</p>

      <ul className="mt-6 space-y-3 flex-1">
        {features.map((feature) => (
          <FeatureItem
            key={feature.key}
            label={feature.label}
            included={feature.included}
            tooltip={feature.tooltip}
          />
        ))}
      </ul>

      <Link
        to={`/checkout?plan=enterprise&cycle=${cycle}&processes=${selectedProcesses}`}
        className="mt-6 inline-flex h-11 items-center justify-center rounded-lg bg-[#2563EB] px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90"
      >
        Assinar
      </Link>
      <Link
        to="mailto:contato@jarvisjud.com.br?subject=Plano%20Enterprise%20%2B5.000%20processos"
        className="mt-3 inline-flex items-center justify-center text-sm font-medium text-[#2563EB]"
      >
        Falar com um consultor
      </Link>
    </article>
  );
}
