import { useScrollReveal } from '@/hooks/useScrollReveal';

const features = [
  { emoji: '⚖️', title: 'Gestão de Processos', desc: 'Acompanhe todos os processos em tempo real com timeline de movimentações e alertas automáticos por tribunal.' },
  { emoji: '🤖', title: 'IA Jurídica', desc: 'Resumos automáticos de decisões, sugestões de peças e análise preditiva de resultados usando IA de ponta.' },
  { emoji: '💬', title: 'WhatsApp Integrado', desc: 'Atendimento automatizado via WhatsApp com respostas inteligentes e encaminhamento para o advogado responsável.' },
  { emoji: '📊', title: 'Analytics Avançado', desc: 'Dashboards com métricas de desempenho, taxa de sucesso, prazos e produtividade do escritório.' },
  { emoji: '🔔', title: 'Alertas Inteligentes', desc: 'Notificações proativas sobre prazos, audiências e movimentações com priorização automática.' },
  { emoji: '🔒', title: 'Segurança Máxima', desc: 'Criptografia de ponta a ponta, conformidade com LGPD e OAB, autenticação multifator e audit logs.' },
];

export default function FeaturesSection() {
  const { ref, isVisible } = useScrollReveal();

  return (
    <section id="funcionalidades" className="py-24 md:py-32 bg-[#040d1a] relative">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-[#3a7dff]/[0.02] to-transparent" />
      <div className="container mx-auto px-4 md:px-8 relative" ref={ref}>
        <div className={`text-center mb-16 transition-all duration-700 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
          <span className="text-sm font-semibold text-[#00d4ff] uppercase tracking-wider">Funcionalidades</span>
          <h2 className="text-3xl md:text-4xl font-extrabold text-white mt-3 -tracking-tight">
            Tudo que seu escritório precisa
          </h2>
          <p className="mt-4 text-white/40 text-lg max-w-2xl mx-auto">
            Ferramentas poderosas projetadas para advogados que valorizam produtividade e excelência.
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5 max-w-6xl mx-auto">
          {features.map((f, i) => (
            <div
              key={i}
              className={`group p-7 rounded-2xl border border-white/5 bg-white/[0.02] backdrop-blur-sm hover:bg-white/[0.05] hover:border-[#3a7dff]/30 transition-all duration-300 cursor-default ${
                isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
              }`}
              style={{ transitionDelay: `${i * 100 + 200}ms` }}
            >
              <div className="text-3xl mb-4">{f.emoji}</div>
              <h3 className="text-lg font-bold text-white mb-2">{f.title}</h3>
              <p className="text-sm text-white/40 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
