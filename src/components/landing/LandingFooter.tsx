import { Scale } from 'lucide-react';
import { Link } from 'react-router-dom';

const links = {
  Produto: ['Funcionalidades', 'Planos', 'Integrações', 'Atualizações'],
  Empresa: ['Sobre', 'Blog', 'Carreiras', 'Contato'],
  Legal: ['Privacidade', 'Termos de Uso', 'LGPD', 'Compliance'],
};

export default function LandingFooter() {
  return (
    <footer className="border-t border-white/5 bg-[#020a14]">
      <div className="container mx-auto px-4 md:px-8 py-16">
        <div className="grid md:grid-cols-5 gap-12">
          {/* Brand */}
          <div className="md:col-span-2">
            <Link to="/" className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#3a7dff] to-[#00d4ff] flex items-center justify-center">
                <Scale className="h-4 w-4 text-white" />
              </div>
              <span className="text-lg font-extrabold text-white tracking-tight">JUD</span>
            </Link>
            <p className="text-sm text-white/30 leading-relaxed max-w-xs">
              Plataforma jurídica inteligente para escritórios de advocacia que valorizam produtividade e excelência no atendimento.
            </p>
          </div>

          {/* Link columns */}
          {Object.entries(links).map(([title, items]) => (
            <div key={title}>
              <h4 className="text-sm font-semibold text-white mb-4">{title}</h4>
              <ul className="space-y-2.5">
                {items.map((item) => (
                  <li key={item}>
                    <a href="#" className="text-sm text-white/30 hover:text-white/60 transition-colors">
                      {item}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-white/5">
        <div className="container mx-auto px-4 md:px-8 py-6 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-xs text-white/20">© 2026 JUD. Todos os direitos reservados.</p>
          <div className="flex items-center gap-6">
            <a href="#" className="text-xs text-white/20 hover:text-white/40 transition-colors">Privacidade</a>
            <a href="#" className="text-xs text-white/20 hover:text-white/40 transition-colors">Termos</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
