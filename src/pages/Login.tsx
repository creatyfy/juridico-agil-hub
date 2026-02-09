import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth, UserRole } from '@/contexts/AuthContext';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import logo from '@/assets/logo-jarvis-jud.png';

type LoginTab = 'advogado' | 'cliente' | 'admin';

export default function Login() {
  const [searchParams] = useSearchParams();
  const isRegister = searchParams.get('register') === 'true';
  const [activeTab, setActiveTab] = useState<LoginTab>('advogado');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({ field1: '', field2: '' });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(activeTab as UserRole, form);
      navigate('/dashboard');
    } catch {
      // handle error
    } finally {
      setLoading(false);
    }
  };

  const tabs: { key: LoginTab; label: string }[] = [
    { key: 'advogado', label: 'Advogado' },
    { key: 'cliente', label: 'Cliente' },
    { key: 'admin', label: 'Admin' },
  ];

  return (
    <div className="min-h-screen flex">
      {/* Left panel */}
      <div className="hidden lg:flex lg:w-1/2 hero-section flex-col justify-center items-center p-12">
        <div className="max-w-md text-center">
          <img src={logo} alt="Jarvis Jud" className="h-16 mx-auto mb-6 brightness-0 invert" />
          <p className="text-primary-foreground/80 text-lg leading-relaxed">
            Automação jurídica inteligente. Gerencie processos, atenda clientes e acompanhe movimentações em um só lugar.
          </p>
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center p-6 bg-background">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex justify-center mb-8">
            <img src={logo} alt="Jarvis Jud" className="h-10" />
          </div>

          <h2 className="text-2xl font-bold text-center mb-2">
            {isRegister ? 'Criar sua conta' : 'Bem-vindo de volta'}
          </h2>
          <p className="text-muted-foreground text-center mb-8">
            {isRegister ? 'Preencha os dados para começar' : 'Faça login para acessar sua conta'}
          </p>

          {/* Tabs */}
          <div className="flex rounded-lg bg-secondary p-1 mb-6">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  'flex-1 py-2 text-sm font-medium rounded-md transition-all duration-200',
                  activeTab === tab.key
                    ? 'bg-card shadow-sm text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {activeTab === 'advogado' && (
              <>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Número da OAB</label>
                  <input type="text" placeholder="Ex: 123456/SP" value={form.field1} onChange={(e) => setForm({ ...form, field1: e.target.value })} className="input-field w-full" />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Senha</label>
                  <div className="relative">
                    <input type={showPassword ? 'text' : 'password'} placeholder="Sua senha" value={form.field2} onChange={(e) => setForm({ ...form, field2: e.target.value })} className="input-field w-full pr-10" />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </>
            )}
            {activeTab === 'cliente' && (
              <>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">CPF</label>
                  <input type="text" placeholder="000.000.000-00" value={form.field1} onChange={(e) => setForm({ ...form, field1: e.target.value })} className="input-field w-full" />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Número do Processo</label>
                  <input type="text" placeholder="0000000-00.0000.0.00.0000" value={form.field2} onChange={(e) => setForm({ ...form, field2: e.target.value })} className="input-field w-full" />
                </div>
              </>
            )}
            {activeTab === 'admin' && (
              <>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">E-mail</label>
                  <input type="email" placeholder="admin@exemplo.com" value={form.field1} onChange={(e) => setForm({ ...form, field1: e.target.value })} className="input-field w-full" />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Senha</label>
                  <div className="relative">
                    <input type={showPassword ? 'text' : 'password'} placeholder="Sua senha" value={form.field2} onChange={(e) => setForm({ ...form, field2: e.target.value })} className="input-field w-full pr-10" />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </>
            )}
            <Button type="submit" className="btn-accent w-full h-11 text-sm font-semibold" disabled={loading}>
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 border-2 border-accent-foreground/30 border-t-accent-foreground rounded-full animate-spin" />
                  Entrando...
                </span>
              ) : (
                isRegister ? 'Criar conta' : 'Entrar'
              )}
            </Button>
          </form>

          <p className="text-center text-sm text-muted-foreground mt-6">
            {isRegister ? (
              <>Já tem uma conta? <a href="/login" className="text-accent hover:underline font-medium">Entrar</a></>
            ) : (
              <>Não tem conta? <a href="/login?register=true" className="text-accent hover:underline font-medium">Criar conta</a></>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
