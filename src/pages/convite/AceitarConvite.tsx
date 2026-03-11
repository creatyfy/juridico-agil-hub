import { useParams, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { Scale, CheckCircle, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface InviteData {
  invite: { id: string; status: string; data_convite: string };
  cliente: { id: string; nome: string; documento: string; email: string | null; auth_user_id: string | null };
  processo: { id: string; numero_cnj: string; classe: string; tribunal: string };
  needsRegistration: boolean;
}

export default function AceitarConvite() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<InviteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [regForm, setRegForm] = useState({ email: '', password: '', confirmPassword: '' });
  const [error, setError] = useState('');
  const [consentimento, setConsentimento] = useState(false);

  useEffect(() => {
    async function fetchInvite() {
      const { data: result, error } = await supabase.functions.invoke('aceitar-convite', {
        body: { token, action: 'fetch' },
      });
      if (error || !result) {
        setError('Convite não encontrado ou inválido.');
      } else {
        setData(result);
        if (result.cliente?.email) {
          setRegForm(f => ({ ...f, email: result.cliente.email }));
        }
      }
      setLoading(false);
    }
    fetchInvite();
  }, [token]);

  const handleAccept = async () => {
    setAccepting(true);
    try {
      const { error } = await supabase.functions.invoke('aceitar-convite', {
        body: { token, action: 'accept' },
      });
      if (error) throw error;
      toast.success('Convite aceito! Redirecionando...');
      setTimeout(() => navigate('/dashboard'), 1500);
    } catch {
      toast.error('Erro ao aceitar convite');
    }
    setAccepting(false);
  };

  const handleRegister = async () => {
    if (regForm.password !== regForm.confirmPassword) {
      toast.error('As senhas não coincidem');
      return;
    }
    if (regForm.password.length < 6) {
      toast.error('A senha deve ter pelo menos 6 caracteres');
      return;
    }
    setRegistering(true);
    try {
      const { error: signUpError } = await supabase.auth.signUp({
        email: regForm.email,
        password: regForm.password,
        options: {
          data: {
            full_name: data?.cliente.nome,
            cpf: data?.cliente.documento,
            role: 'cliente',
          },
          emailRedirectTo: 'https://jarvisjud.online/login',
        },
      });
      if (signUpError) throw signUpError;
      // Store token so we can auto-accept after email confirmation + login
      if (token) localStorage.setItem('pending_invite_token', token);
      toast.success('Cadastro realizado! Verifique seu e-mail para confirmar.');
    } catch (e: any) {
      toast.error(e.message || 'Erro ao cadastrar');
    }
    setRegistering(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="bg-card rounded-xl border p-8 max-w-md w-full text-center space-y-4">
          <AlertCircle className="h-12 w-12 text-destructive mx-auto" />
          <h1 className="text-xl font-bold">{error || 'Convite inválido'}</h1>
        </div>
      </div>
    );
  }

  if (data.invite.status === 'ativo') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="bg-card rounded-xl border p-8 max-w-md w-full text-center space-y-4">
          <CheckCircle className="h-12 w-12 text-green-500 mx-auto" />
          <h1 className="text-xl font-bold">Convite já aceito</h1>
          <p className="text-muted-foreground text-sm">Este convite já foi aceito anteriormente.</p>
          <Button onClick={() => navigate('/login')}>Ir para o login</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="bg-card rounded-xl border p-8 max-w-md w-full space-y-6">
        <div className="text-center space-y-2">
          <Scale className="h-10 w-10 text-accent mx-auto" />
          <h1 className="text-xl font-bold">Convite para Acompanhar Processo</h1>
        </div>

        <div className="bg-muted/50 rounded-lg p-4 space-y-2">
          <p className="text-sm"><span className="font-medium">Processo:</span> {data.processo.numero_cnj}</p>
          {data.processo.classe && <p className="text-sm text-muted-foreground">{data.processo.classe}</p>}
          {data.processo.tribunal && <p className="text-sm text-muted-foreground">{data.processo.tribunal}</p>}
        </div>

        <div className="bg-muted/50 rounded-lg p-4 space-y-1">
          <p className="text-sm"><span className="font-medium">Cliente:</span> {data.cliente.nome}</p>
          {data.cliente.documento && (
            <p className="text-sm text-muted-foreground font-mono">{data.cliente.documento}</p>
          )}
        </div>

        {data.needsRegistration ? (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Crie uma conta para acompanhar seu processo:
            </p>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">E-mail</label>
                <Input
                  type="email"
                  value={regForm.email}
                  onChange={e => setRegForm(f => ({ ...f, email: e.target.value }))}
                  placeholder="seu@email.com"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Senha</label>
                <Input
                  type="password"
                  value={regForm.password}
                  onChange={e => setRegForm(f => ({ ...f, password: e.target.value }))}
                  placeholder="Mínimo 6 caracteres"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Confirmar senha</label>
                <Input
                  type="password"
                  value={regForm.confirmPassword}
                  onChange={e => setRegForm(f => ({ ...f, confirmPassword: e.target.value }))}
                  placeholder="Repita a senha"
                />
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Checkbox
                id="consentimento-reg"
                checked={consentimento}
                onCheckedChange={(checked) => setConsentimento(checked === true)}
                className="mt-0.5"
              />
              <label htmlFor="consentimento-reg" className="text-xs text-muted-foreground leading-relaxed cursor-pointer">
                Autorizo o recebimento de notificações sobre meus processos e concordo com o tratamento dos meus dados
                conforme a <strong>LGPD (Lei 13.709/2018)</strong>. O consentimento pode ser revogado a qualquer momento.
              </label>
            </div>
            <Button className="w-full" onClick={handleRegister} disabled={registering || !consentimento}>
              {registering ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Cadastrar e Aceitar Convite
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground text-center">
              Você já possui uma conta. Confirme o consentimento e aceite o convite.
            </p>
            <div className="flex items-start gap-3">
              <Checkbox
                id="consentimento-accept"
                checked={consentimento}
                onCheckedChange={(checked) => setConsentimento(checked === true)}
                className="mt-0.5"
              />
              <label htmlFor="consentimento-accept" className="text-xs text-muted-foreground leading-relaxed cursor-pointer">
                Autorizo o recebimento de notificações sobre meus processos e concordo com o tratamento dos meus dados
                conforme a <strong>LGPD (Lei 13.709/2018)</strong>. O consentimento pode ser revogado a qualquer momento.
              </label>
            </div>
            <Button className="w-full" onClick={handleAccept} disabled={accepting || !consentimento}>
              {accepting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Aceitar Convite
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
