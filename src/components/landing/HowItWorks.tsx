import { useScrollReveal } from '@/hooks/useScrollReveal';
import { MessageSquare, Bot, User } from 'lucide-react';

const steps = [
  { num: '01', title: 'Cadastre seu escritório', desc: 'Crie sua conta em menos de 2 minutos com sua OAB e comece a usar imediatamente.' },
  { num: '02', title: 'Importe seus processos', desc: 'Conecte-se aos tribunais e importe todos os processos automaticamente.' },
  { num: '03', title: 'Ative o atendimento IA', desc: 'Configure o WhatsApp e deixe a IA responder seus clientes 24/7.' },
  { num: '04', title: 'Acompanhe resultados', desc: 'Monitore métricas, prazos e satisfação dos clientes em tempo real.' },
];

const chatMessages = [
  { from: 'bot', text: 'Olá! Sou a assistente do Dr. Silva. Como posso ajudar?' },
  { from: 'user', text: 'Quero saber sobre meu processo 0012345-67' },
  { from: 'bot', text: 'Encontrei! Seu processo teve movimentação ontem. Houve despacho de citação. Deseja mais detalhes?' },
];

export default function HowItWorks() {
  const { ref, isVisible } = useScrollReveal();

  return (
    <section id="benefícios" className="py-24 md:py-32 bg-[#0a1628] relative">
      <div className="container mx-auto px-4 md:px-8" ref={ref}>
        <div className={`text-center mb-16 transition-all duration-700 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
          <span className="text-sm font-semibold text-[#00d4ff] uppercase tracking-wider">Como funciona</span>
          <h2 className="text-3xl md:text-4xl font-extrabold text-white mt-3 -tracking-tight">
            Simples de começar, poderoso de usar
          </h2>
        </div>

        <div className="grid lg:grid-cols-2 gap-16 max-w-6xl mx-auto items-start">
          {/* Steps */}
          <div className="space-y-0">
            {steps.map((s, i) => (
              <div
                key={i}
                className={`group flex gap-5 py-6 ${i < steps.length - 1 ? 'border-b border-white/5' : ''} transition-all duration-500 ${
                  isVisible ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-8'
                }`}
                style={{ transitionDelay: `${i * 150 + 300}ms` }}
              >
                <span className="text-2xl font-extrabold text-white/10 group-hover:text-[#3a7dff] transition-colors -tracking-tight min-w-[3rem]">
                  {s.num}
                </span>
                <div>
                  <h3 className="text-lg font-bold text-white mb-1">{s.title}</h3>
                  <p className="text-sm text-white/40 leading-relaxed">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Chat + Metrics */}
          <div className={`space-y-5 transition-all duration-700 delay-500 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
            {/* Chat mockup */}
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-white/10 flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-[#3a7dff]" />
                <span className="text-xs font-semibold text-white/60">Atendimento via WhatsApp</span>
              </div>
              <div className="p-5 space-y-3">
                {chatMessages.map((m, i) => (
                  <div key={i} className={`flex ${m.from === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`flex items-start gap-2 max-w-[85%] ${m.from === 'user' ? 'flex-row-reverse' : ''}`}>
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                        m.from === 'bot' ? 'bg-[#3a7dff]/20' : 'bg-white/10'
                      }`}>
                        {m.from === 'bot' ? <Bot className="h-3 w-3 text-[#3a7dff]" /> : <User className="h-3 w-3 text-white/50" />}
                      </div>
                      <div className={`px-3 py-2 rounded-xl text-xs leading-relaxed ${
                        m.from === 'bot'
                          ? 'bg-white/[0.05] text-white/70 rounded-tl-sm'
                          : 'bg-[#3a7dff]/20 text-white/80 rounded-tr-sm'
                      }`}>
                        {m.text}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Mini metrics */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Atendimentos', value: '1.2k', change: '+18%' },
                { label: 'Satisfação', value: '98%', change: '+3%' },
                { label: 'Tempo IA', value: '<2s', change: '-40%' },
              ].map((m, i) => (
                <div key={i} className="p-4 rounded-xl bg-white/[0.03] border border-white/5 text-center">
                  <p className="text-lg font-bold text-white">{m.value}</p>
                  <p className="text-[10px] text-white/30 mt-0.5">{m.label}</p>
                  <p className="text-[10px] text-emerald-400 mt-1">{m.change}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
