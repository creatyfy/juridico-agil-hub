import { Link } from 'react-router-dom';
import { ArrowRight, ChevronRight, MessageSquare, TrendingUp, Users, BarChart3, Clock, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function HeroSection() {
  return (
    <section className="relative min-h-screen pt-24 pb-16 overflow-hidden">
      {/* Background */}
      <div className="absolute inset-0 bg-[#040d1a]" />
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[600px] bg-[#3a7dff]/8 rounded-full blur-[150px]" />
      <div className="absolute bottom-0 right-0 w-[500px] h-[400px] bg-[#00d4ff]/5 rounded-full blur-[120px]" />
      <div className="absolute inset-0 opacity-[0.03]" style={{
        backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)',
        backgroundSize: '48px 48px'
      }} />

      <div className="container mx-auto px-4 md:px-8 relative">
        <div className="grid lg:grid-cols-2 gap-16 items-center min-h-[calc(100vh-6rem)]">
          {/* Left */}
          <div className="max-w-xl">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-[#3a7dff]/30 bg-[#3a7dff]/10 backdrop-blur-sm mb-8">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00d4ff] opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[#00d4ff]" />
              </span>
              <span className="text-xs font-semibold text-[#00d4ff]">Plataforma Jurídica Inteligente</span>
            </div>

            <h1 className="text-4xl md:text-5xl lg:text-[3.5rem] font-extrabold leading-[1.08] -tracking-tight">
              <span className="text-white">Eleve sua prática jurídica com </span>
              <span className="bg-gradient-to-r from-[#3a7dff] to-[#00d4ff] bg-clip-text text-transparent">IA avançada.</span>
            </h1>

            <p className="mt-6 text-lg text-white/50 leading-relaxed max-w-md">
              Gerencie processos, automatize atendimentos e mantenha seus clientes informados — tudo em uma única plataforma segura.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 mt-10">
              <Link to="/cadastro/advogado">
                <Button size="lg" className="text-lg px-10 h-14 font-semibold bg-gradient-to-r from-[#3a7dff] to-[#3a7dff] hover:from-[#3a7dff] hover:to-[#00d4ff] text-white shadow-[0_0_30px_rgba(58,125,255,0.3)] hover:shadow-[0_0_40px_rgba(58,125,255,0.5)] transition-all">
                  Começar Gratuitamente
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              </Link>
              <Link to="/login">
                <Button size="lg" variant="outline" className="text-lg px-10 h-14 border-white/20 text-white hover:bg-white/5 bg-transparent backdrop-blur-sm">
                  Entrar na Plataforma
                  <ChevronRight className="ml-1 h-5 w-5" />
                </Button>
              </Link>
            </div>

            {/* Social proof */}
            <div className="mt-12 flex items-center gap-4">
              <div className="flex -space-x-2">
                {[
                  'bg-gradient-to-br from-blue-400 to-blue-600',
                  'bg-gradient-to-br from-cyan-400 to-cyan-600',
                  'bg-gradient-to-br from-indigo-400 to-indigo-600',
                  'bg-gradient-to-br from-teal-400 to-teal-600',
                ].map((bg, i) => (
                  <div key={i} className={`w-8 h-8 rounded-full ${bg} border-2 border-[#040d1a] flex items-center justify-center text-[10px] font-bold text-white`}>
                    {['JR', 'MS', 'AL', 'PK'][i]}
                  </div>
                ))}
              </div>
              <div>
                <p className="text-sm font-semibold text-white">2.400+ advogados</p>
                <p className="text-xs text-white/40">já utilizam a plataforma</p>
              </div>
            </div>
          </div>

          {/* Right — Dashboard mockup */}
          <div className="relative hidden lg:block">
            {/* Floating badge top-right */}
            <div className="absolute -top-2 -right-4 z-20 px-4 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 backdrop-blur-md" style={{ animation: 'float 6s ease-in-out infinite' }}>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                <span className="text-sm font-medium text-emerald-300">Prazo cumprido ✓</span>
              </div>
            </div>

            {/* Floating badge bottom-left */}
            <div className="absolute -bottom-4 -left-6 z-20 px-4 py-2 rounded-xl bg-[#3a7dff]/10 border border-[#3a7dff]/20 backdrop-blur-md" style={{ animation: 'float 6s ease-in-out infinite 3s' }}>
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-[#00d4ff]" />
                <span className="text-sm font-medium text-[#00d4ff]">IA processou 47 docs</span>
              </div>
            </div>

            {/* Browser mockup */}
            <div className="relative rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-xl overflow-hidden shadow-2xl shadow-black/40">
              {/* Browser bar */}

              <div className="p-5 space-y-4">
                {/* Metric cards */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-4 rounded-xl bg-white/[0.04] border border-white/10 hover:-translate-y-1 transition-transform">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-white/40">Processos Ativos</span>
                      <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
                    </div>
                    <p className="text-2xl font-bold text-white">248</p>
                    <div className="flex items-end gap-0.5 mt-2 h-6">
                      {[40, 55, 35, 65, 50, 70, 85].map((h, i) => (
                        <div key={i} className="flex-1 rounded-sm bg-gradient-to-t from-[#3a7dff] to-[#00d4ff]" style={{ height: `${h}%` }} />
                      ))}
                    </div>
                  </div>
                  <div className="p-4 rounded-xl bg-white/[0.04] border border-white/10 hover:-translate-y-1 transition-transform">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs text-white/40">Clientes Ativos</span>
                      <Users className="h-3.5 w-3.5 text-[#3a7dff]" />
                    </div>
                    <p className="text-2xl font-bold text-white">1.847</p>
                    <div className="mt-2 h-2 rounded-full bg-white/10 overflow-hidden">
                      <div className="h-full w-[78%] rounded-full bg-gradient-to-r from-[#3a7dff] to-[#00d4ff]" />
                    </div>
                    <p className="text-[10px] text-white/30 mt-1">78% meta atingida</p>
                  </div>
                </div>

                {/* Hearings table */}
                <div className="rounded-xl bg-white/[0.04] border border-white/10 p-4">
                  <p className="text-xs font-semibold text-white/60 mb-3">Processos</p>
                  <div className="space-y-2.5">
                    {[
                      { case: '0012345-67.2024', date: '15 Mar', status: 'Ativo', color: 'text-emerald-400 bg-emerald-400/10' },
                      { case: '0098765-43.2024', date: '18 Mar', status: 'Ativo', color: 'text-emerald-400 bg-emerald-400/10' },
                      { case: '0054321-89.2024', date: '22 Mar', status: 'Arquivado', color: 'text-white/50 bg-white/5' },
                    ].map((h, i) => (
                      <div key={i} className="flex items-center justify-between py-1.5">
                        <div className="flex items-center gap-3">
                          <Clock className="h-3.5 w-3.5 text-white/30" />
                          <span className="text-xs text-white/70 font-mono">{h.case}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-white/40">{h.date}</span>
                          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${h.color}`}>{h.status}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-12px); }
        }
      `}</style>
    </section>
  );
}
