import { Link } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useScrollReveal } from '@/hooks/useScrollReveal';

const plans = [
  {
    name: 'Iniciante',
    desc: 'Para advogados autônomos',
    price: 'Grátis',
    period: 'para sempre',
    features: ['Até 10 processos', 'Timeline de movimentações', 'Alertas por e-mail', 'Painel básico', '1 usuário'],
    cta: 'Começar grátis',
    highlight: false,
  },
  {
    name: 'Profissional',
    desc: 'Para escritórios em crescimento',
    price: 'R$197',
    period: '/mês',
    features: ['Processos ilimitados', 'IA Jurídica completa', 'WhatsApp integrado', 'Analytics avançado', 'Até 5 usuários', 'Suporte prioritário'],
    cta: 'Assinar agora',
    highlight: true,
  },
  {
    name: 'Escritório',
    desc: 'Para grandes operações',
    price: 'R$497',
    period: '/mês',
    features: ['Tudo do Profissional', 'Usuários ilimitados', 'API personalizada', 'Campanhas em massa', 'Gerente de conta dedicado', 'SLA garantido'],
    cta: 'Falar com vendas',
    highlight: false,
  },
];

export default function PlansSection() {
  const { ref, isVisible } = useScrollReveal();

  return (
    <section id="planos" className="py-24 md:py-32 bg-[#040d1a] relative">
      <div className="absolute inset-0 bg-gradient-to-b from-[#0a1628] via-transparent to-transparent h-32" />
      <div className="container mx-auto px-4 md:px-8 relative" ref={ref}>
        <div className={`text-center mb-16 transition-all duration-700 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
          <span className="text-sm font-semibold text-[#00d4ff] uppercase tracking-wider">Planos</span>
          <h2 className="text-3xl md:text-4xl font-extrabold text-white mt-3 -tracking-tight">
            Escolha o plano ideal para você
          </h2>
          <p className="mt-4 text-white/40 text-lg">Soluções para escritórios de todos os tamanhos</p>
        </div>

        <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto items-stretch">
          {plans.map((p, i) => (
            <div
              key={i}
              className={`relative flex flex-col rounded-2xl border p-7 transition-all duration-500 ${
                p.highlight
                  ? 'border-[#3a7dff]/50 bg-white/[0.04] scale-[1.02] shadow-[0_0_40px_rgba(58,125,255,0.1)]'
                  : 'border-white/5 bg-white/[0.02]'
              } ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}
              style={{ transitionDelay: `${i * 150 + 200}ms` }}
            >
              {p.highlight && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-gradient-to-r from-[#3a7dff] to-[#00d4ff] text-xs font-bold text-white">
                  Mais popular
                </div>
              )}

              <div>
                <h3 className="text-xl font-bold text-white">{p.name}</h3>
                <p className="text-sm text-white/40 mt-1">{p.desc}</p>
              </div>

              <div className="mt-6 flex items-end gap-1">
                <span className="text-4xl font-extrabold text-white -tracking-tight">{p.price}</span>
                <span className="text-sm text-white/30 mb-1">{p.period}</span>
              </div>

              <ul className="mt-6 space-y-3 flex-1">
                {p.features.map((f, fi) => (
                  <li key={fi} className="flex items-center gap-2.5">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                    <span className="text-sm text-white/60">{f}</span>
                  </li>
                ))}
              </ul>

              <Link to="/cadastro/advogado" className="mt-7">
                <Button className={`w-full h-11 font-semibold transition-all ${
                  p.highlight
                    ? 'bg-gradient-to-r from-[#3a7dff] to-[#00d4ff] text-white shadow-[0_0_20px_rgba(58,125,255,0.3)] hover:shadow-[0_0_30px_rgba(58,125,255,0.5)]'
                    : 'bg-white/5 text-white hover:bg-white/10 border border-white/10'
                }`}>
                  {p.cta}
                </Button>
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
