import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Eye, EyeOff, Loader2, AlertCircle, Scale, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import logo from '@/assets/logo-jarvis-jud.png';

const UF_OPTIONS = [
  'AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT',
  'PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'
];

type LoginMode = 'oab' | 'email';

export default function Login() {
  const [mode, setMode] = useState<LoginMode>('oab');

  // Email login state
  const [email, setEmail] = useState('');

  // OAB login state
  const [oab, setOab] = useState('');
  const [uf, setUf] = useState('');

  // Shared
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Preencha e-mail e senha.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await login(email, password);
      navigate('/dashboard');
    } catch (err: any) {
      if (err?.message?.includes('Email not confirmed')) {
        setError('E-mail não confirmado. Verifique sua caixa de entrada.');
      } else if (err?.message?.includes('Invalid login credentials')) {
        setError('E-mail ou senha inválidos.');
      } else {
        setError(err?.message || 'Erro ao fazer login.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleOabLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!oab || !uf || !password) {
      setError('Preencha OAB, UF e senha.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      // Look up email by OAB via edge function
      const { data, error: fnError } = await supabase.functions.invoke('login-oab', {
        body: { action: 'lookup', oab, uf },
      });

      if (fnError || data?.error) {
        setError(data?.error || 'OAB não encontrada. Verifique os dados ou cadastre-se.');
        return;
      }

      // Now sign in with the found email + password
      await login(data.email, password);
      navigate('/dashboard');
    } catch (err: any) {
      if (err?.message?.includes('Email not confirmed')) {
        setError('E-mail não confirmado. Verifique sua caixa de entrada.');
      } else if (err?.message?.includes('Invalid login credentials')) {
        setError('OAB ou senha inválidos.');
      } else {
        setError(err?.message || 'Erro ao fazer login.');
      }
    } finally {
      setLoading(false);
    }
  };

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

          <h2 className="text-2xl font-bold text-center mb-2">Bem-vindo de volta</h2>
          <p className="text-muted-foreground text-center mb-6">
            Faça login para acessar sua conta
          </p>

          {/* Login mode tabs */}
          <div className="flex rounded-lg border border-border mb-6 overflow-hidden">
            <button
              type="button"
              onClick={() => { setMode('oab'); setError(''); }}
              className={cn(
                'flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors',
                mode === 'oab'
                  ? 'bg-accent text-accent-foreground'
                  : 'bg-background text-muted-foreground hover:bg-muted'
              )}
            >
              <Scale className="h-4 w-4" />
              OAB + Senha
            </button>
            <button
              type="button"
              onClick={() => { setMode('email'); setError(''); }}
              className={cn(
                'flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-medium transition-colors',
                mode === 'email'
                  ? 'bg-accent text-accent-foreground'
                  : 'bg-background text-muted-foreground hover:bg-muted'
              )}
            >
              <Mail className="h-4 w-4" />
              E-mail + Senha
            </button>
          </div>

          {error && (
            <Alert variant="destructive" className="mb-6">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {/* OAB + Senha Login */}
          {mode === 'oab' && (
            <form onSubmit={handleOabLogin} className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-1">
                  <label className="text-sm font-medium mb-1.5 block">UF</label>
                  <Select value={uf} onValueChange={setUf}>
                    <SelectTrigger>
                      <SelectValue placeholder="UF" />
                    </SelectTrigger>
                    <SelectContent>
                      {UF_OPTIONS.map(u => (
                        <SelectItem key={u} value={u}>{u}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <label className="text-sm font-medium mb-1.5 block">Número OAB</label>
                  <Input
                    placeholder="123456"
                    value={oab}
                    onChange={(e) => setOab(e.target.value.replace(/\D/g, '').slice(0, 7))}
                  />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Senha</label>
                <div className="relative">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Sua senha"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <Button type="submit" className="btn-accent w-full h-11 text-sm font-semibold" disabled={loading}>
                {loading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Entrando...
                  </span>
                ) : (
                  'Entrar com OAB'
                )}
              </Button>
            </form>
          )}

          {/* Email + Senha Login */}
          {mode === 'email' && (
            <form onSubmit={handleEmailLogin} className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block">E-mail</label>
                <Input
                  type="email"
                  placeholder="seu@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Senha</label>
                <div className="relative">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Sua senha"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <Button type="submit" className="btn-accent w-full h-11 text-sm font-semibold" disabled={loading}>
                {loading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Entrando...
                  </span>
                ) : (
                  'Entrar'
                )}
              </Button>
            </form>
          )}

          <p className="text-center text-sm text-muted-foreground mt-6">
            Não tem conta?{' '}
            <a href="/cadastro/advogado" className="text-accent hover:underline font-medium">Criar conta</a>
          </p>
        </div>
      </div>
    </div>
  );
}
