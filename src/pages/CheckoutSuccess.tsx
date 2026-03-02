import { CheckCircle2 } from 'lucide-react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PLAN_CATALOG } from '@/lib/pricing';

const formatMoney = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

export default function CheckoutSuccess() {
  const [searchParams] = useSearchParams();

  const planSlug = searchParams.get('plan');
  const cycle = searchParams.get('cycle');
  const totalRaw = searchParams.get('total');
  const method = searchParams.get('method');
  const email = searchParams.get('email');

  const plan = PLAN_CATALOG.find((item) => item.slug === planSlug);
  const total = totalRaw ? Number(totalRaw) : NaN;
  const isValidCycle = cycle === 'monthly' || cycle === 'annual';
  const isValidMethod = method === 'pix' || method === 'boleto' || method === 'credit_card';

  if (!plan || !isValidCycle || Number.isNaN(total) || !isValidMethod) {
    return <Navigate to="/planos" replace />;
  }

  return (
    <main className="min-h-screen bg-[#F4F6F8] px-4 py-10">
      <Card className="mx-auto max-w-2xl">
        <CardContent className="space-y-6 p-8 text-center">
          <CheckCircle2 className="mx-auto h-20 w-20 text-emerald-500" />
          <div>
            <h1 className="text-3xl font-bold">Pedido recebido com sucesso!</h1>
            <p className="mt-2 text-slate-600">Em breve você receberá um e-mail com os próximos passos.</p>
          </div>

          <div className="rounded-lg border bg-white p-4 text-left text-sm">
            <p><strong>Plano:</strong> {plan.name}</p>
            <p><strong>Ciclo:</strong> {cycle === 'annual' ? 'Anual' : 'Mensal'}</p>
            <p><strong>Valor total:</strong> {formatMoney(total)}</p>
          </div>

          {method === 'pix' && <p className="text-sm text-slate-700">Aguarde o QR Code no seu e-mail.</p>}
          {method === 'boleto' && <p className="text-sm text-slate-700">O boleto foi enviado para {email ?? 'seu e-mail'}.</p>}
          {method === 'credit_card' && <p className="text-sm text-slate-700">Seu pagamento está sendo processado.</p>}

          <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Button asChild className="bg-[#2563EB] hover:bg-[#1d4ed8]">
              <Link to="/dashboard">Ir para Área do Cliente</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/">Voltar para o início</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
