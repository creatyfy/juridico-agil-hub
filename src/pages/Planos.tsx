import { PricingSection } from '@/components/pricing/PricingSection';

export default function Planos() {
  return (
    <main className="min-h-screen bg-[#F4F6F8] py-16">
      <div className="container mx-auto px-4 md:px-8">
        <div className="text-center">
          <h1 className="text-3xl md:text-4xl font-bold">Planos</h1>
          <p className="mt-3 text-muted-foreground">Escolha o plano que melhor se adapta ao seu escritório.</p>
        </div>
        <PricingSection showAnnualNote />
      </div>
    </main>
  );
}
