import { useState } from 'react';
import { useScrollReveal } from '@/hooks/useScrollReveal';
import { BillingCycle } from '@/lib/pricing';
import { PricingToggle } from '@/components/pricing/PricingToggle';
import { PricingSection } from '@/components/pricing/PricingSection';

export default function PlansSection() {
  const { ref, isVisible } = useScrollReveal();

  return (
    <section id="planos" className="py-24 md:py-32 bg-[#F4F6F8] relative">
      <div className="container mx-auto px-4 md:px-8 relative" ref={ref}>
        <div className={`text-center mb-4 transition-all duration-700 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
          <span className="text-sm font-semibold text-[#2563EB] uppercase tracking-wider">Planos</span>
          <h2 className="text-3xl md:text-4xl font-extrabold text-black mt-3 -tracking-tight">
            Escolha o plano ideal para você
          </h2>
          <p className="mt-4 text-muted-foreground text-lg">Soluções para escritórios de todos os tamanhos</p>
        </div>

        <div className={`transition-all duration-700 delay-200 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
          <PricingSection showAnnualNote />
        </div>
      </div>
    </section>
  );
}
