import { useMemo, useState } from 'react';
import { BillingCycle, getPriceByCycle, PLAN_CATALOG } from '@/lib/pricing';
import { PricingToggle } from './PricingToggle';
import { PlanCard } from './PlanCard';
import { EnterpriseCard } from './EnterpriseCard';

interface PricingSectionProps {
  showAnnualNote?: boolean;
}

export function PricingSection({ showAnnualNote = false }: PricingSectionProps) {
  const [cycle, setCycle] = useState<BillingCycle>('monthly');

  const plans = useMemo(() => PLAN_CATALOG, []);

  return (
    <section className="py-12">
      <div className="flex flex-col items-center gap-3">
        <PricingToggle cycle={cycle} onChange={setCycle} />
        {showAnnualNote && (
          <p className="text-xs text-slate-500">*O desconto do plano anual é válido somente para pagamento à vista.</p>
        )}
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-4">
        {plans.map((plan) => {
          if (plan.isEnterprise) {
            return <EnterpriseCard key={plan.slug} features={plan.features} cycle={cycle} />;
          }

          const monthlyPrice = plan.priceMonthly ?? 0;
          const displayPrice = getPriceByCycle(monthlyPrice, cycle);

          return (
            <PlanCard
              key={plan.slug}
              name={plan.name}
              slug={plan.slug}
              price={displayPrice}
              activationFee={plan.activationFee}
              features={plan.features}
              cycle={cycle}
              highlighted={plan.slug === 'explorer'}
            />
          );
        })}
      </div>
    </section>
  );
}
