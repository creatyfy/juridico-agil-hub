import { Link } from 'react-router-dom';
import { PricingSection } from '@/components/pricing/PricingSection';
import { Shield, Zap, MessageSquare, ArrowRight, CheckCircle2, Scale, Users, Bot, ChevronRight, FileText, BarChart3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import logo from '@/assets/logo-jarvis-jud.png';
import heroMockup from '@/assets/hero-mockup.png';

const features = [
  {
    icon: <Scale className="h-7 w-7" />,
    title: 'Gestão Processual Inteligente',
    desc: 'Acompanhe todos os seus processos em tempo real com timeline de movimentações e alertas automáticos.',
  },
  {
    icon: <Bot className="h-7 w-7" />,
    title: 'Automação de Atendimento',
    desc: 'Atendimento automatizado via WhatsApp com respostas inteligentes e encaminhamento para o advogado.',
  },
  {
    icon: <Users className="h-7 w-7" />,
    title: 'Portal do Cliente',
    desc: 'Seus clientes acompanham os processos de forma simples e acessível, reduzindo ligações e e-mails.',
  },
];

const stats = [
  { value: '70%', label: 'Menos tempo em consultas' },
  { value: '500+', label: 'Escritórios atendidos' },
  { value: '99.9%', label: 'Disponibilidade' },
  { value: '24/7', label: 'Monitoramento ativo' },
];

const benefits = [
  { icon: <FileText className="h-5 w-5" />, text: 'Consulta processual em todos os tribunais' },
  { icon: <MessageSquare className="h-5 w-5" />, text: 'Notificações automáticas via WhatsApp' },
  
  { icon: <Shield className="h-5 w-5" />, text: 'Segurança e conformidade com a OAB' },
  { icon: <Zap className="h-5 w-5" />, text: 'Preparado para Inteligência Artificial' },
  
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="absolute top-0 left-0 right-0 z-50">
        <div className="container mx-auto flex items-center justify-between h-20 px-4 md:px-8">
          <img src={logo} alt="Jarvis Jud" className="h-20 drop-shadow-lg" />
          <nav className="hidden md:flex items-center gap-8">
            <a href="#funcionalidades" className="text-sm font-medium text-primary-foreground/70 hover:text-primary-foreground transition-colors">
              Funcionalidades
            </a>
            <a href="#beneficios" className="text-sm font-medium text-primary-foreground/70 hover:text-primary-foreground transition-colors">
              Benefícios
            </a>
            <a href="#planos" className="text-sm font-medium text-primary-foreground/70 hover:text-primary-foreground transition-colors">
              Planos
            </a>
          </nav>
          <div className="flex items-center gap-3">
            <Link to="/login">
              <Button variant="ghost" className="text-sm font-medium text-primary-foreground/80 hover:text-primary-foreground hover:bg-primary-foreground/10">
                Entrar
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="hero-section relative overflow-hidden pt-20">
        {/* Background pattern */}
        <div className="absolute inset-0 opacity-[0.07]" style={{
          backgroundImage: 'radial-gradient(circle at 1px 1px, hsl(var(--primary-foreground)) 1px, transparent 0)',
          backgroundSize: '40px 40px'
        }} />
        <div className="absolute top-0 right-0 w-[600px] h-[600px] bg-accent/10 rounded-full blur-[120px] -translate-y-1/2 translate-x-1/4" />

        <div className="container mx-auto px-4 md:px-8 relative">
          <div className="grid lg:grid-cols-2 gap-12 items-center min-h-[calc(100vh-5rem)] py-16 lg:py-0">
            {/* Left content */}
            <div className="max-w-xl">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-accent/20 text-accent text-xs font-semibold mb-6 backdrop-blur-sm border border-accent/20">
                <Zap className="h-3.5 w-3.5" />
                Plataforma Jurídica Inteligente
              </div>

              <h1 className="text-4xl md:text-5xl lg:text-[3.5rem] font-extrabold text-primary-foreground leading-[1.1] tracking-tight">
                Eleve sua prática.{' '}
                <span className="text-accent">Automação inteligente</span>{' '}
                para o escritório moderno.
              </h1>

              <p className="mt-6 text-lg text-primary-foreground/70 leading-relaxed max-w-md">
                Gerencie processos, automatize atendimentos e mantenha seus clientes informados — tudo em uma única plataforma segura.
              </p>

              <div className="flex flex-col sm:flex-row gap-4 mt-10">
                <Link to="/cadastro/advogado">
                  <Button size="lg" className="btn-accent text-base px-8 h-13 font-semibold shadow-lg shadow-accent/25 hover:shadow-xl hover:shadow-accent/30 transition-all">
                    Começar Gratuitamente
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </Button>
                </Link>
                <Link to="/login">
                  <Button size="lg" variant="outline" className="text-base px-8 h-13 border-primary-foreground/20 text-primary-foreground hover:bg-primary-foreground/10 backdrop-blur-sm">
                    Entrar na Plataforma
                    <ChevronRight className="ml-1 h-4 w-4" />
                  </Button>
                </Link>
              </div>

              {/* Integração WhatsApp badge */}
              <div className="mt-10 flex items-center gap-3">
                <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-[hsl(142_70%_45%)]/15 border border-[hsl(142_70%_45%)]/20 backdrop-blur-sm">
                  <MessageSquare className="h-4 w-4 text-[hsl(142_70%_45%)]" />
                  <span className="text-sm font-medium text-primary-foreground/80">Integrado com WhatsApp</span>
                </div>
              </div>
            </div>

            {/* Right - Mockup */}
            <div className="relative hidden lg:block">
              <div className="relative">
                <div className="absolute -inset-4 bg-accent/5 rounded-2xl blur-2xl" />
                <img
                  src={heroMockup}
                  alt="Dashboard Jarvis Jud - Gestão processual inteligente"
                  className="relative rounded-xl shadow-2xl shadow-black/30 border border-primary-foreground/10 w-full"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats bar */}
      <section className="bg-card border-y">
        <div className="container mx-auto px-4 md:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-border">
            {stats.map((stat, i) => (
              <div key={i} className="py-8 md:py-10 text-center px-4">
                <p className="text-3xl md:text-4xl font-extrabold text-accent">{stat.value}</p>
                <p className="text-sm text-muted-foreground mt-1 font-medium">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="funcionalidades" className="py-20 md:py-28 bg-background">
        <div className="container mx-auto px-4 md:px-8">
          <div className="text-center mb-16">
            <span className="text-sm font-semibold text-accent uppercase tracking-wider">Funcionalidades</span>
            <h2 className="text-3xl md:text-4xl font-bold mt-3">
              Tudo que seu escritório precisa
            </h2>
            <p className="mt-4 text-muted-foreground text-lg max-w-2xl mx-auto">
              Ferramentas poderosas projetadas especificamente para advogados que valorizam produtividade e excelência.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {features.map((f, i) => (
              <div
                key={i}
                className="group relative bg-card rounded-xl border p-8 hover:shadow-xl hover:shadow-accent/5 hover:border-accent/30 transition-all duration-300"
              >
                <div className="inline-flex p-3.5 rounded-xl bg-accent/10 text-accent mb-5 group-hover:bg-accent group-hover:text-accent-foreground transition-colors duration-300">
                  {f.icon}
                </div>
                <h3 className="text-lg font-bold mb-3">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
                <div className="mt-5">
                  <span className="text-sm font-medium text-accent inline-flex items-center gap-1 group-hover:gap-2 transition-all">
                    Saiba mais <ChevronRight className="h-4 w-4" />
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section id="beneficios" className="py-20 md:py-28 bg-secondary/50">
        <div className="container mx-auto px-4 md:px-8">
          <div className="max-w-5xl mx-auto grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <span className="text-sm font-semibold text-accent uppercase tracking-wider">Por que Jarvis Jud?</span>
              <h2 className="text-3xl md:text-4xl font-bold mt-3 leading-tight">
                Feito para advogados que querem{' '}
                <span className="text-accent">resultados</span>
              </h2>
              <p className="text-muted-foreground leading-relaxed mt-4 text-lg">
                Desenvolvido por profissionais do direito que entendem as dores do dia a dia. Automatize o operacional e foque no que realmente importa: advogar.
              </p>
              <div className="mt-8">
                <Link to="/cadastro/advogado">
                  <Button className="btn-accent px-6">
                    Experimente 30 dias grátis
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              {benefits.map((b, i) => (
                <div key={i} className="flex items-start gap-3 p-4 rounded-xl bg-card border hover:shadow-md transition-shadow duration-200">
                  <div className="p-2 rounded-lg bg-accent/10 text-accent shrink-0">
                    {b.icon}
                  </div>
                  <span className="text-sm font-medium leading-snug mt-1">{b.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="hero-section py-20 md:py-28 relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.05]" style={{
          backgroundImage: 'radial-gradient(circle at 1px 1px, hsl(var(--primary-foreground)) 1px, transparent 0)',
          backgroundSize: '40px 40px'
        }} />
        <div className="container mx-auto px-4 md:px-8 text-center relative">
          <h2 className="text-3xl md:text-4xl font-bold text-primary-foreground mb-4">
            Pronto para transformar seu escritório?
          </h2>
          <p className="text-primary-foreground/70 mb-10 max-w-lg mx-auto text-lg">
            Experimente gratuitamente por 30 dias. Sem cartão de crédito. Sem compromisso.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link to="/cadastro/advogado">
              <Button size="lg" className="btn-accent text-base px-10 h-13 font-semibold shadow-lg shadow-accent/25">
                Criar Conta Gratuita
                <ArrowRight className="ml-2 h-5 w-5" />
              </Button>
            </Link>
            <Link to="/login">
              <Button size="lg" variant="outline" className="text-base px-8 h-13 border-primary-foreground/20 text-primary-foreground hover:bg-primary-foreground/10">
                Já tenho conta
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <section id="planos" className="py-20 md:py-24 bg-[#EEF2F7]">
        <div className="container mx-auto px-4 md:px-8">
          <div className="text-center">
            <h2 className="text-3xl md:text-4xl font-bold">Escolha o plano ideal para você</h2>
            <p className="mt-3 text-muted-foreground text-lg">Soluções para escritórios de todos os tamanhos</p>
          </div>

          <PricingSection />

          <div className="text-center mt-2">
            <Link to="/planos" className="text-sm font-semibold text-[#2563EB] hover:underline">
              Ver detalhes completos →
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-10 bg-card">
        <div className="container mx-auto px-4 md:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <img src={logo} alt="Jarvis Jud" className="h-7" />
            </div>
            <div className="flex items-center gap-6 text-sm text-muted-foreground">
              <a href="#funcionalidades" className="hover:text-foreground transition-colors">Funcionalidades</a>
              <a href="#beneficios" className="hover:text-foreground transition-colors">Benefícios</a>
              <a href="#planos" className="hover:text-foreground transition-colors">Planos</a>
            </div>
            <p className="text-sm text-muted-foreground">© 2026 Jarvis Jud. Todos os direitos reservados.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
