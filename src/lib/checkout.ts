import { BillingCycle } from '@/lib/pricing';

export type CheckoutQuery = {
  plan: string;
  cycle: BillingCycle;
  processes?: number;
};

export function buildCheckoutUrl({ plan, cycle, processes }: CheckoutQuery): string {
  const params = new URLSearchParams({ plan, cycle });

  if (typeof processes === 'number') {
    params.set('processes', String(processes));
  }

  return `/checkout?${params.toString()}`;
}

export function parseCheckoutSearchParams(searchParams: URLSearchParams): {
  planSlug: string | null;
  billingCycle: BillingCycle | null;
  processesCount: number | null;
  hasProcessesParam: boolean;
} {
  const planSlug = searchParams.get('plan');
  const cycleParam = searchParams.get('cycle');
  const processesParam = searchParams.get('processes');

  const billingCycle = cycleParam === 'monthly' || cycleParam === 'annual' ? cycleParam : null;
  const processesCount = processesParam ? Number(processesParam) : null;

  return {
    planSlug,
    billingCycle,
    processesCount,
    hasProcessesParam: Boolean(processesParam),
  };
}
