export type BillingCycle = 'monthly' | 'annual';

export type PlanFeature = {
  key: string;
  label: string;
  included: boolean;
  tooltip?: string;
};

export type PlanConfig = {
  name: string;
  slug: string;
  priceMonthly: number | null;
  activationFee: string;
  maxCadastros: number | null;
  isEnterprise?: boolean;
  features: PlanFeature[];
};

export const enterprisePricing: Record<number, number> = {
  1000: 1300,
  2000: 2400,
  3000: 3500,
  5000: 5000,
};

export const PLAN_CATALOG: PlanConfig[] = [
  {
    name: 'STANDARD',
    slug: 'standard',
    priceMonthly: 300,
    activationFee: '+taxa de ativação',
    maxCadastros: 150,
    features: [
      { key: 'cadastros', label: 'Até 150 cadastros', included: true },
      { key: 'monitoramento', label: 'Monitoramento diário', included: true },
      { key: 'ia', label: 'Inteligência artificial simplificada', included: true },
      { key: 'atendimento', label: 'Atendimento humano especializado', included: true },
      { key: 'suporte', label: 'Suporte via WhatsApp e e-mail', included: true },
      { key: 'area_cliente', label: 'Área do cliente', included: true },
      { key: 'conversas', label: 'Conversas ilimitadas', included: true },
      { key: 'secretariado', label: 'Secretariado Simples', included: false },
      { key: 'lembrete_monitoramento', label: 'Lembrete de monitoramento', included: false },
    ],
  },
  {
    name: 'SIMPLE',
    slug: 'simple',
    priceMonthly: 570,
    activationFee: '+taxa de ativação',
    maxCadastros: 300,
    features: [
      { key: 'cadastros', label: 'Até 300 cadastros', included: true },
      { key: 'monitoramento', label: 'Monitoramento diário', included: true },
      { key: 'ia', label: 'Inteligência artificial simplificada', included: true },
      { key: 'atendimento', label: 'Atendimento humano especializado', included: true },
      { key: 'suporte', label: 'Suporte via WhatsApp e e-mail', included: true },
      { key: 'area_cliente', label: 'Área do cliente', included: true },
      { key: 'conversas', label: 'Conversas ilimitadas', included: true },
      { key: 'secretariado', label: 'Secretariado Simples', included: true },
      { key: 'lembrete_monitoramento', label: 'Lembrete de monitoramento', included: false },
    ],
  },
  {
    name: 'EXPLORER',
    slug: 'explorer',
    priceMonthly: 750,
    activationFee: '+taxa de ativação',
    maxCadastros: 500,
    features: [
      { key: 'cadastros', label: 'Até 500 cadastros', included: true },
      { key: 'monitoramento', label: 'Monitoramento diário', included: true },
      { key: 'ia', label: 'Inteligência artificial simplificada', included: true },
      { key: 'atendimento', label: 'Atendimento humano especializado', included: true },
      { key: 'suporte', label: 'Suporte via WhatsApp e e-mail', included: true },
      { key: 'area_cliente', label: 'Área do cliente', included: true },
      { key: 'conversas', label: 'Conversas ilimitadas', included: true },
      { key: 'secretariado', label: 'Secretariado Simples', included: true },
      { key: 'lembrete_monitoramento', label: 'Lembrete de monitoramento', included: true },
      { key: 'gerente_contas', label: 'Gerente de contas exclusivo', included: true },
    ],
  },
  {
    name: 'ENTERPRISE',
    slug: 'enterprise',
    priceMonthly: null,
    activationFee: 'Preço variável por número de processos',
    maxCadastros: null,
    isEnterprise: true,
    features: [
      { key: 'all_previous', label: 'Todas as features dos planos anteriores', included: true, tooltip: 'Inclui todos os recursos STANDARD, SIMPLE e EXPLORER.' },
      { key: 'secretariado', label: 'Secretariado Simples', included: true, tooltip: 'Suporte operacional para triagem de solicitações.' },
      { key: 'lembrete_monitoramento', label: 'Lembrete de monitoramento', included: true, tooltip: 'Lembretes automáticos de eventos e movimentações críticas.' },
      { key: 'gerente_contas', label: 'Gerente de contas exclusivo', included: true, tooltip: 'Acompanhamento dedicado para evolução da operação.' },
    ],
  },
];

export function getPriceByCycle(monthlyPrice: number, cycle: BillingCycle): number {
  if (cycle === 'annual') {
    return monthlyPrice * 0.8;
  }

  return monthlyPrice;
}
