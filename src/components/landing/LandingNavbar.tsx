import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Scale } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function LandingNavbar() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled ? 'bg-[#040d1a]/90 backdrop-blur-xl border-b border-white/5' : 'bg-transparent'
      }`}
    >
      <div className="container mx-auto flex items-center justify-between h-16 px-4 md:px-8">
        <Link to="/" className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#3a7dff] to-[#00d4ff] flex items-center justify-center">
            <Scale className="h-4 w-4 text-white" />
          </div>
          <span className="text-lg font-extrabold text-white tracking-tight">JUD</span>
        </Link>

        <nav className="hidden md:flex items-center gap-8">
          {['Funcionalidades', 'Benefícios', 'Planos'].map((item) => (
            <a
              key={item}
              href={`#${item.toLowerCase()}`}
              className="text-sm font-medium text-white/60 hover:text-white transition-colors"
            >
              {item}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <Link to="/login">
            <Button variant="ghost" className="text-sm text-white/70 hover:text-white hover:bg-white/5">
              Entrar
            </Button>
          </Link>
          <Link to="/cadastro/advogado">
            <Button className="text-sm bg-[#3a7dff] hover:bg-[#3a7dff]/90 text-white shadow-[0_0_20px_rgba(58,125,255,0.3)] hover:shadow-[0_0_30px_rgba(58,125,255,0.5)] transition-all">
              Começar grátis
            </Button>
          </Link>
        </div>
      </div>
    </header>
  );
}
