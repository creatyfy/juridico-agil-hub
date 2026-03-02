import { useSearchParams } from 'react-router-dom';

export default function Checkout() {
  const [searchParams] = useSearchParams();
  const plan = searchParams.get('plan');
  const cycle = searchParams.get('cycle');

  return (
    <main className="min-h-screen bg-[#F4F6F8] flex items-center justify-center px-4">
      <div className="max-w-xl w-full rounded-2xl border border-slate-200 bg-white p-8 shadow-sm text-center">
        <h1 className="text-2xl font-bold">Checkout (em breve)</h1>
        <p className="mt-3 text-slate-600">
          Você selecionou o plano <strong>{plan ?? 'não informado'}</strong> no ciclo <strong>{cycle ?? 'não informado'}</strong>.
        </p>
        <p className="mt-2 text-sm text-slate-500">Esta página é um placeholder para o fluxo de pagamento.</p>
      </div>
    </main>
  );
}
