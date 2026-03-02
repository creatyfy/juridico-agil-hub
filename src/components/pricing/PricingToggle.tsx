import { BillingCycle } from '@/lib/pricing';

interface PricingToggleProps {
  cycle: BillingCycle;
  onChange: (cycle: BillingCycle) => void;
}

export function PricingToggle({ cycle, onChange }: PricingToggleProps) {
  return (
    <div className="inline-flex rounded-full bg-slate-200 p-1">
      <button
        type="button"
        onClick={() => onChange('monthly')}
        className={`px-5 py-2 text-sm font-semibold rounded-full transition-colors ${
          cycle === 'monthly' ? 'bg-[#2563EB] text-white' : 'text-slate-700'
        }`}
      >
        Mensal
      </button>
      <button
        type="button"
        onClick={() => onChange('annual')}
        className={`px-5 py-2 text-sm font-semibold rounded-full transition-colors ${
          cycle === 'annual' ? 'bg-[#2563EB] text-white' : 'text-slate-700'
        }`}
      >
        Anual (-20%)
      </button>
    </div>
  );
}
