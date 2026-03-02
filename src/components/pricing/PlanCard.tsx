import { Link } from 'react-router-dom';
import { BillingCycle, PlanFeature } from '@/lib/pricing';
import { buildCheckoutUrl } from '@/lib/checkout';
import { FeatureItem } from './FeatureItem';

interface PlanCardProps {
  name: string;
  slug: string;
  price: number;
  activationFee: string;
  features: PlanFeature[];
  cycle: BillingCycle;
  highlighted?: boolean;
}

export function PlanCard({ name, slug, price, activationFee, features, cycle, highlighted = false }: PlanCardProps) {
  const priceLabel = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(price);

  return (
    <article className={`flex h-full flex-col rounded-2xl border bg-white p-6 shadow-sm ${highlighted ? 'border-[#2563EB]' : 'border-slate-200'}`}>
      <h3 className="text-xl font-bold text-black">{name}</h3>
      <div className="mt-4 flex items-end gap-1">
        <p className="text-4xl font-bold text-black leading-none">{priceLabel}</p>
        <span className="text-sm text-slate-500 mb-1">/mês</span>
      </div>
      <p className="mt-1 text-xs text-slate-500">{activationFee}</p>

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
        to={buildCheckoutUrl({ plan: slug, cycle })}
        className="mt-6 inline-flex h-11 items-center justify-center rounded-lg bg-[#2563EB] px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90"
      >
        Assinar
      </Link>
    </article>
  );
}
