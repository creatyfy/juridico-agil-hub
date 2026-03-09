import { useSearchParams } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { MessageCircle, CheckCircle, Loader2, AlertCircle, Shield, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface ConviteData {
  convite: { id: string; status: string; expiracao: string };
  cliente: { id: string; nome: string; documento: string | null; tipo_documento: string | null };
  processo: { id: string; numero_cnj: string; classe: string; tribunal: string };
}

type Step = 'loading' | 'error' | 'already-used' | 'info' | 'otp' | 'success';

export default function VincularWhatsApp() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [step, setStep] = useState<Step>('loading');
  const [data, setData] = useState<ConviteData | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [numero, setNumero] = useState('');
  const [consentimento, setConsentimento] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [canResend, setCanResend] = useState(false);
  const [resendTimer, setResendTimer] = useState(0);

  useEffect(() => {
    async function fetchConvite() {
      if (!token) {
        setErrorMsg('Token não fornecido.');
        setStep('error');
        return;
      }

      const { data: result, error } = await supabase.functions.invoke('vinculacao-whatsapp', {
        body: { action: 'fetch', token },
      });

      if (error || !result) {
        setErrorMsg('Convite não encontrado ou inválido.');
        setStep('error');
        return;
      }

      if (result.error) {
        if (result.error.includes('expirado')) {
          setErrorMsg('Este convite expirou. Solicite um novo ao seu advogado.');
        } else {
          setErrorMsg(result.error);
        }
        setStep('error');
        return;
      }

      setData(result);
      if (result.convite.status === 'utilizado' || result.convite.status === 'ativo') {
        setStep('already-used');
      } else {
        setStep('info');
      }
    }
    fetchConvite();
  }, [token]);

  // Resend timer
  useEffect(() => {
    if (resendTimer > 0) {
      const t = setTimeout(() => setResendTimer(resendTimer - 1), 1000);
      return () => clearTimeout(t);
    } else if (step === 'otp') {
      setCanResend(true);
    }
  }, [resendTimer, step]);

  const formatPhoneInput = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 11);
    if (digits.length <= 2) return digits;
    if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  };

  const handleSendOtp = async () => {
    const cleanNumber = numero.replace(/\D/g, '');
    if (cleanNumber.length < 10 || cleanNumber.length > 11) {
      toast.error('Informe um número válido com DDD');
      return;
    }
    if (!consentimento) {
      toast.error('Você precisa concordar com o recebimento de atualizações');
      return;
    }
    if (!data) return;

    setSendingOtp(true);
    try {
      const { data: result, error } = await supabase.functions.invoke('vinculacao-whatsapp', {
        body: {
          action: 'send-otp',
          token,
          numero_whatsapp: cleanNumber,
        },
      });

      if (error) throw error;
      if (result?.error) {
        toast.error(result.error);
        setSendingOtp(false);
        return;
      }

      toast.success('Código enviado via WhatsApp!');
      setStep('otp');
      setCanResend(false);
      setResendTimer(60);
    } catch (e: any) {
      toast.error(e.message || 'Erro ao enviar código');
    }
    setSendingOtp(false);
  };

  const handleVerifyOtp = async () => {
    if (otpCode.length !== 6) {
      toast.error('Informe o código completo de 6 dígitos');
      return;
    }
    if (!data) return;

    setVerifying(true);
    try {
      const { data: result, error } = await supabase.functions.invoke('vinculacao-whatsapp', {
        body: {
          action: 'verify-otp',
          convite_id: data.convite.id,
          codigo: otpCode,
        },
      });

      if (error) throw error;
      if (result?.error) {
        toast.error(result.error);
        setOtpCode('');
        setVerifying(false);
        return;
      }

      setStep('success');
    } catch (e: any) {
      toast.error(e.message || 'Erro ao validar código');
      setOtpCode('');
    }
    setVerifying(false);
  };

  const handleResendOtp = async () => {
    setCanResend(false);
    await handleSendOtp();
  };

  // ─── LOADING ───
  if (step === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    );
  }

  // ─── ERROR ───
  if (step === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="bg-card rounded-xl border p-8 max-w-md w-full text-center space-y-4">
          <AlertCircle className="h-12 w-12 text-destructive mx-auto" />
          <h1 className="text-xl font-bold">{errorMsg || 'Convite inválido'}</h1>
          <p className="text-sm text-muted-foreground">Entre em contato com seu advogado para obter um novo link.</p>
        </div>
      </div>
    );
  }

  // ─── ALREADY USED ───
  if (step === 'already-used') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="bg-card rounded-xl border p-8 max-w-md w-full text-center space-y-4">
          <CheckCircle className="h-12 w-12 text-green-500 mx-auto" />
          <h1 className="text-xl font-bold">Vinculação já realizada</h1>
          <p className="text-sm text-muted-foreground">
            Seu número de WhatsApp já foi vinculado a este processo. Você receberá atualizações automaticamente.
          </p>
        </div>
      </div>
    );
  }

  // ─── SUCCESS ───
  if (step === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="bg-card rounded-xl border p-8 max-w-md w-full text-center space-y-4">
          <CheckCircle className="h-12 w-12 text-green-500 mx-auto" />
          <h1 className="text-xl font-bold">Acompanhamento ativado!</h1>
          <p className="text-sm text-muted-foreground">
            Seu número de WhatsApp foi vinculado com sucesso. Você receberá atualizações automáticas sempre que houver movimentação no seu processo.
          </p>
          <div className="bg-muted/50 rounded-lg p-3 mt-4">
            <p className="text-xs text-muted-foreground">Processo: <span className="font-mono font-medium text-foreground">{data?.processo.numero_cnj}</span></p>
          </div>
        </div>
      </div>
    );
  }

  // ─── OTP INPUT ───
  if (step === 'otp') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="bg-card rounded-xl border p-8 max-w-md w-full space-y-6">
          <div className="text-center space-y-2">
            <Shield className="h-10 w-10 text-accent mx-auto" />
            <h1 className="text-xl font-bold">Confirme seu número</h1>
            <p className="text-sm text-muted-foreground">
              Enviamos um código de 6 dígitos para o seu WhatsApp. Digite-o abaixo:
            </p>
          </div>

          <div className="flex justify-center">
            <InputOTP maxLength={6} value={otpCode} onChange={setOtpCode}>
              <InputOTPGroup>
                <InputOTPSlot index={0} />
                <InputOTPSlot index={1} />
                <InputOTPSlot index={2} />
                <InputOTPSlot index={3} />
                <InputOTPSlot index={4} />
                <InputOTPSlot index={5} />
              </InputOTPGroup>
            </InputOTP>
          </div>

          <Button className="w-full" onClick={handleVerifyOtp} disabled={verifying || otpCode.length !== 6}>
            {verifying ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Validar Código
          </Button>

          <div className="text-center">
            {canResend ? (
              <button onClick={handleResendOtp} className="text-sm text-accent hover:underline">
                Reenviar código
              </button>
            ) : (
              <p className="text-xs text-muted-foreground">
                Reenviar em {resendTimer}s
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ─── INFO + NUMBER INPUT ───
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="bg-card rounded-xl border p-8 max-w-md w-full space-y-6">
        <div className="text-center space-y-2">
          <MessageCircle className="h-10 w-10 text-accent mx-auto" />
          <h1 className="text-xl font-bold">Acompanhamento via WhatsApp</h1>
        </div>

        <div className="bg-muted/50 rounded-lg p-4 space-y-2">
          <p className="text-sm"><span className="font-medium">Processo:</span> {data?.processo.numero_cnj}</p>
          {data?.processo.classe && <p className="text-sm text-muted-foreground">{data.processo.classe}</p>}
          {data?.processo.tribunal && <p className="text-sm text-muted-foreground">{data.processo.tribunal}</p>}
        </div>

        <div className="bg-muted/50 rounded-lg p-4 space-y-1">
          <p className="text-sm"><span className="font-medium">Cliente:</span> {data?.cliente.nome}</p>
          {data?.cliente.documento && (
            <p className="text-sm text-muted-foreground font-mono">{data.cliente.documento}</p>
          )}
        </div>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Informe seu número de WhatsApp para receber atualizações automáticas sobre movimentações do seu processo:
          </p>

          <div>
            <label className="text-xs text-muted-foreground mb-1 block">📱 Número de WhatsApp com DDD</label>
            <Input
              type="tel"
              value={numero}
              onChange={e => setNumero(formatPhoneInput(e.target.value))}
              placeholder="(00) 00000-0000"
              maxLength={16}
            />
          </div>

          <div className="flex items-start gap-3">
            <Checkbox
              id="consentimento"
              checked={consentimento}
              onCheckedChange={(checked) => setConsentimento(checked === true)}
              className="mt-0.5"
            />
            <label htmlFor="consentimento" className="text-xs text-muted-foreground leading-relaxed cursor-pointer">
              Autorizo o recebimento de notificações automáticas sobre meus processos via WhatsApp pelo escritório responsável.
              Os dados são tratados conforme a <strong>LGPD (Lei 13.709/2018)</strong> e este consentimento pode ser
              revogado a qualquer momento respondendo "PARAR" no WhatsApp.
            </label>
          </div>

          <Button
            className="w-full"
            onClick={handleSendOtp}
            disabled={sendingOtp || !consentimento || numero.replace(/\D/g, '').length < 10}
          >
            {sendingOtp ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
            Enviar Código de Confirmação
          </Button>
        </div>
      </div>
    </div>
  );
}
