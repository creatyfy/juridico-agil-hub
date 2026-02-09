import { Link } from 'react-router-dom';
import { Shield, Zap, MessageSquare, ArrowRight, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import logo from '@/assets/logo-jarvis-jud.png';

const features = [
  {
    icon: <Zap className="h-6 w-6" />,
    title: 'Consulta Processual Automatizada',
    desc: 'Acompanhe movimentações processuais em tempo real, sem precisar acessar múltiplos tribunais.',
  },
  {
    icon: <MessageSquare className="h-6 w-6" />,
    title: 'Atendimento via WhatsApp',
    desc: 'Seus clientes recebem atualizações automáticas dos processos diretamente no WhatsApp.',
  },
  {
    icon: <Shield className="h-6 w-6" />,
    title: 'Segurança e Confiabilidade',
    desc: 'Dados criptografados, acesso controlado e conformidade com as normas da OAB.',
  },
];

const benefits = [
  'Reduza até 70% do tempo em consultas processuais',
  'Mantenha clientes informados automaticamente',
  'Centralize todos os processos em um só lugar',
  'Relatórios e insights sobre seu escritório',
  'Preparado para Inteligência Artificial',
  'Suporte dedicado e treinamento incluso',
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto flex items-center justify-between h-16 px-4">
          <img src={logo} alt="Jarvis Jud" className="h-8" />
          <div className="flex items-center gap-3">
            <Link to="/login">
              <Button variant="ghost" className="text-sm font-medium">Entrar</Button>
            </Link>
            <Link to="/login?register=true">
              <Button className="btn-accent text-sm">Criar conta</Button>
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="hero-section py-24 md:py-32">
        <div className="container mx-auto px-4 text-center">
          <div className="max-w-3xl mx-auto">
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-primary-foreground leading-tight text-balance">
              Automação jurídica inteligente para advogados
            </h1>
            <p className="mt-6 text-lg md:text-xl text-primary-foreground/80 max-w-2xl mx-auto text-balance">
              Consulte processos, acompanhe movimentações e atenda seus clientes via WhatsApp —
              tudo em uma única plataforma.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center mt-10">
              <Link to="/login">
                <Button size="lg" className="btn-accent text-base px-8 h-12">
                  Começar agora
                  <ArrowRight className="ml-2 h-5 w-5" />
                </Button>
              </Link>
              <Link to="/login">
                <Button size="lg" variant="outline" className="text-base px-8 h-12 border-primary-foreground/30 text-primary-foreground hover:bg-primary-foreground/10">
                  Entrar na plataforma
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 bg-background">
        <div className="container mx-auto px-4">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-bold">Por que advogados escolhem o Jarvis Jud?</h2>
            <p className="mt-3 text-muted-foreground text-lg">Menos trabalho manual, mais tempo para o que importa.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
            {features.map((f, i) => (
              <div key={i} className="card-elevated p-6 text-center" style={{ animationDelay: `${i * 100}ms` }}>
                <div className="inline-flex p-3 rounded-xl bg-accent/10 text-accent mb-4">{f.icon}</div>
                <h3 className="text-lg font-semibold mb-2">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section className="py-20 bg-secondary">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto grid md:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-3xl font-bold mb-4">Feito para advogados que valorizam seu tempo</h2>
              <p className="text-muted-foreground leading-relaxed">
                O Jarvis Jud foi desenvolvido por profissionais do direito que entendem as dores do dia a dia.
                Nossa plataforma automatiza o que pode ser automatizado, deixando você livre para advogar.
              </p>
            </div>
            <div className="space-y-3">
              {benefits.map((b, i) => (
                <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-card">
                  <CheckCircle2 className="h-5 w-5 text-success shrink-0" />
                  <span className="text-sm font-medium">{b}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="hero-section py-20">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold text-primary-foreground mb-4">Pronto para transformar seu escritório?</h2>
          <p className="text-primary-foreground/80 mb-8 max-w-lg mx-auto">
            Experimente gratuitamente por 14 dias. Sem cartão de crédito.
          </p>
          <Link to="/login?register=true">
            <Button size="lg" className="btn-accent text-base px-10 h-12">
              Criar conta gratuita
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-8 bg-card">
        <div className="container mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-4">
          <img src={logo} alt="Jarvis Jud" className="h-6" />
          <p className="text-sm text-muted-foreground">© 2026 Jarvis Jud. Todos os direitos reservados.</p>
        </div>
      </footer>
    </div>
  );
}
