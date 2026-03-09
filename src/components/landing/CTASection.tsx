import { Link } from 'react-router-dom';
import { ArrowRight, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function CTASection() {
  return (
    <section className="py-24 md:py-32 bg-[#040d1a] relative overflow-hidden">
      <div className="absolute inset-0">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[400px] bg-[#3a7dff]/8 rounded-full blur-[150px]" />
      </div>

      <div className="container mx-auto px-4 md:px-8 text-center relative">
        <h2 className="text-3xl md:text-4xl lg:text-5xl font-extrabold text-white -tracking-tight">
          Pronto para transformar{' '}
          <span className="bg-gradient-to-r from-[#3a7dff] to-[#00d4ff] bg-clip-text text-transparent">seu escritório?</span>
        </h2>
        <p className="text-white/40 mt-4 mb-10 max-w-lg mx-auto text-lg">
          Experimente gratuitamente por 30 dias. Sem cartão de crédito. Sem compromisso.
        </p>

        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link to="/cadastro/advogado">
            <Button size="lg" className="text-lg px-10 h-14 font-semibold bg-gradient-to-r from-[#3a7dff] to-[#3a7dff] hover:to-[#00d4ff] text-white shadow-[0_0_30px_rgba(58,125,255,0.3)] hover:shadow-[0_0_40px_rgba(58,125,255,0.5)] transition-all">
              Criar Conta Gratuita
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          </Link>
          <Link to="/login">
            <Button size="lg" variant="outline" className="text-lg px-10 h-14 border-white/20 text-white hover:bg-white/5 bg-transparent">
              Já tenho conta
            </Button>
          </Link>
        </div>

        <div className="mt-10 inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
          <MessageSquare className="h-4 w-4 text-emerald-400" />
          <span className="text-sm font-medium text-emerald-300">Integrado com WhatsApp</span>
        </div>
      </div>
    </section>
  );
}
