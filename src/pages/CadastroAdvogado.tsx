import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Link } from 'react-router-dom';
import { Check, ChevronRight, ChevronLeft, Search, Shield, Eye, EyeOff, Mail, AlertCircle, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import logo from '@/assets/logo-jarvis-jud.png';

const UF_OPTIONS = [
  'AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT',
  'PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'
];

type OabStatus = 'idle' | 'loading' | 'ativo' | 'inativo' | 'nao_encontrado';

interface FormData {
  uf: string;
  oab: string;
  nomeCompleto: string;
  cpf: string;
  dataNascimento: string;
  email: string;
  whatsapp: string;
  senha: string;
  confirmarSenha: string;
}

function formatCPF(value: string) {
  const nums = value.replace(/\D/g, '').slice(0, 11);
  if (nums.length <= 3) return nums;
  if (nums.length <= 6) return `${nums.slice(0, 3)}.${nums.slice(3)}`;
  if (nums.length <= 9) return `${nums.slice(0, 3)}.${nums.slice(3, 6)}.${nums.slice(6)}`;
  return `${nums.slice(0, 3)}.${nums.slice(3, 6)}.${nums.slice(6, 9)}-${nums.slice(9)}`;
}

function formatPhone(value: string) {
  const nums = value.replace(/\D/g, '').slice(0, 11);
  if (nums.length <= 2) return nums;
  if (nums.length <= 7) return `(${nums.slice(0, 2)}) ${nums.slice(2)}`;
  return `(${nums.slice(0, 2)}) ${nums.slice(2, 7)}-${nums.slice(7)}`;
}

function validateCPF(cpf: string): boolean {
  const nums = cpf.replace(/\D/g, '');
  if (nums.length !== 11 || /^(\d)\1+$/.test(nums)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(nums[i]) * (10 - i);
  let rest = (sum * 10) % 11;
  if (rest === 10) rest = 0;
  if (rest !== parseInt(nums[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(nums[i]) * (11 - i);
  rest = (sum * 10) % 11;
  if (rest === 10) rest = 0;
  return rest === parseInt(nums[10]);
}

function validatePassword(password: string) {
  const checks = {
    length: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /\d/.test(password),
    special: /[!@#$%^&*(),.?":{}|<>]/.test(password),
  };
  return checks;
}

const steps = [
  { number: 1, title: 'Validação OAB', icon: Shield },
  { number: 2, title: 'Dados Pessoais', icon: CheckCircle2 },
  { number: 3, title: 'Verificação', icon: Mail },
];

export default function CadastroAdvogado() {
  const [currentStep, setCurrentStep] = useState(1);
  const [oabStatus, setOabStatus] = useState<OabStatus>('idle');
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>({});

  const [form, setForm] = useState<FormData>({
    uf: '',
    oab: '',
    nomeCompleto: '',
    cpf: '',
    dataNascimento: '',
    email: '',
    whatsapp: '',
    senha: '',
    confirmarSenha: '',
  });

  const updateField = (field: keyof FormData, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors(prev => ({ ...prev, [field]: undefined }));
  };

  // Step 1: Validate OAB
  const handleBuscarOAB = async () => {
    if (!form.uf || !form.oab.trim()) {
      setErrors({
        uf: !form.uf ? 'Selecione o estado' : undefined,
        oab: !form.oab.trim() ? 'Informe o número da OAB' : undefined,
      });
      return;
    }
    setOabStatus('loading');
    setErrors({});

    try {
      const { data, error } = await supabase.functions.invoke('validate-oab', {
        body: { oab: form.oab, uf: form.uf },
      });

      if (error) {
        console.error('Edge function error:', error);
        setOabStatus('nao_encontrado');
        return;
      }

      if (data.status === 'ativo') {
        setOabStatus('ativo');
        setForm(prev => ({ ...prev, nomeCompleto: data.nome }));
      } else if (data.status === 'inativo') {
        setOabStatus('inativo');
      } else {
        setOabStatus('nao_encontrado');
      }
    } catch {
      setOabStatus('nao_encontrado');
    }
  };

  // Step 2: Validate personal data
  const validateStep2 = (): boolean => {
    const newErrors: Partial<Record<keyof FormData, string>> = {};

    if (!validateCPF(form.cpf)) newErrors.cpf = 'CPF inválido';
    if (!form.dataNascimento) newErrors.dataNascimento = 'Informe a data de nascimento';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) newErrors.email = 'E-mail inválido';
    if (form.whatsapp.replace(/\D/g, '').length < 10) newErrors.whatsapp = 'WhatsApp inválido';

    const passChecks = validatePassword(form.senha);
    if (!Object.values(passChecks).every(Boolean)) newErrors.senha = 'Senha não atende os requisitos';
    if (form.senha !== form.confirmarSenha) newErrors.confirmarSenha = 'As senhas não coincidem';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = () => {
    if (currentStep === 2 && !validateStep2()) return;
    setCurrentStep(prev => prev + 1);
  };

  const [submitError, setSubmitError] = useState('');

  const handleSubmit = async () => {
    if (!validateStep2()) {
      setCurrentStep(2);
      return;
    }
    setSubmitting(true);
    setSubmitError('');

    try {
      const { error } = await supabase.auth.signUp({
        email: form.email,
        password: form.senha,
        options: {
          emailRedirectTo: window.location.origin + '/login',
          data: {
            full_name: form.nomeCompleto,
            oab: form.oab,
            uf: form.uf,
            cpf: form.cpf,
            whatsapp: form.whatsapp,
            data_nascimento: form.dataNascimento,
            role: 'advogado',
          },
        },
      });

      if (error) {
        setSubmitError(error.message);
        return;
      }

      setCurrentStep(3);
    } catch {
      setSubmitError('Erro inesperado. Tente novamente.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResendEmail = async () => {
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: form.email,
      options: {
        emailRedirectTo: window.location.origin + '/login',
      },
    });
    if (!error) {
      alert('E-mail reenviado! Verifique sua caixa de entrada.');
    }
  };

  const passwordChecks = validatePassword(form.senha);

  return (
    <div className="min-h-screen flex">
      {/* Left panel */}
      <div className="hidden lg:flex lg:w-[420px] xl:w-[480px] hero-section flex-col justify-between p-10">
        <div>
          <Link to="/">
            <img src={logo} alt="Jarvis Jud" className="h-14 brightness-0 invert mb-16" />
          </Link>

          <h2 className="text-2xl font-bold text-primary-foreground mb-3">
            Cadastro de Advogado
          </h2>
          <p className="text-primary-foreground/70 leading-relaxed">
            Registre-se na plataforma jurídica mais completa do mercado. Gerencie processos, atenda clientes e automatize seu escritório.
          </p>
        </div>

        {/* Stepper vertical */}
        <div className="space-y-1 mt-10">
          {steps.map((step, i) => {
            const StepIcon = step.icon;
            const isActive = currentStep === step.number;
            const isCompleted = currentStep > step.number;

            return (
              <div key={step.number} className="flex items-center gap-4">
                <div className={cn(
                  'w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all duration-300 shrink-0',
                  isCompleted && 'bg-accent border-accent',
                  isActive && 'border-accent bg-accent/20',
                  !isActive && !isCompleted && 'border-primary-foreground/20',
                )}>
                  {isCompleted ? (
                    <Check className="h-5 w-5 text-accent-foreground" />
                  ) : (
                    <StepIcon className={cn(
                      'h-4 w-4',
                      isActive ? 'text-accent' : 'text-primary-foreground/40'
                    )} />
                  )}
                </div>
                <div>
                  <p className={cn(
                    'text-sm font-semibold transition-colors',
                    isActive ? 'text-primary-foreground' : 'text-primary-foreground/50'
                  )}>
                    Etapa {step.number}
                  </p>
                  <p className={cn(
                    'text-xs',
                    isActive ? 'text-primary-foreground/80' : 'text-primary-foreground/40'
                  )}>
                    {step.title}
                  </p>
                </div>
                {i < steps.length - 1 && (
                  <div className="hidden" />
                )}
              </div>
            );
          })}
        </div>

        <p className="text-xs text-primary-foreground/40 mt-auto pt-8">
          © 2026 Jarvis Jud. Todos os direitos reservados.
        </p>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center p-6 md:p-10 bg-background overflow-y-auto">
        <div className="w-full max-w-lg">
          {/* Mobile logo */}
          <div className="lg:hidden flex justify-center mb-6">
            <Link to="/">
              <img src={logo} alt="Jarvis Jud" className="h-10" />
            </Link>
          </div>

          {/* Mobile stepper */}
          <div className="lg:hidden flex items-center justify-center gap-2 mb-8">
            {steps.map((step) => (
              <div key={step.number} className="flex items-center gap-2">
                <div className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all',
                  currentStep > step.number && 'bg-accent text-accent-foreground',
                  currentStep === step.number && 'bg-accent/20 text-accent border-2 border-accent',
                  currentStep < step.number && 'bg-secondary text-muted-foreground',
                )}>
                  {currentStep > step.number ? <Check className="h-4 w-4" /> : step.number}
                </div>
                {step.number < 3 && (
                  <div className={cn(
                    'w-10 h-0.5 rounded-full',
                    currentStep > step.number ? 'bg-accent' : 'bg-border'
                  )} />
                )}
              </div>
            ))}
          </div>

          {/* Step 1: OAB Validation */}
          {currentStep === 1 && (
            <div className="animate-in fade-in slide-in-from-right-4 duration-300">
              <h2 className="text-2xl font-bold mb-1">Validação Profissional</h2>
              <p className="text-muted-foreground mb-8">
                Informe seus dados da OAB para validar seu registro profissional.
              </p>

              <div className="space-y-5">
                <div>
                  <Label className="mb-1.5 block">Estado (UF) *</Label>
                  <Select value={form.uf} onValueChange={(v) => updateField('uf', v)}>
                    <SelectTrigger className={cn(errors.uf && 'border-destructive')}>
                      <SelectValue placeholder="Selecione o estado" />
                    </SelectTrigger>
                    <SelectContent>
                      {UF_OPTIONS.map(uf => (
                        <SelectItem key={uf} value={uf}>{uf}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.uf && <p className="text-xs text-destructive mt-1">{errors.uf}</p>}
                </div>

                <div>
                  <Label className="mb-1.5 block">Número da OAB *</Label>
                  <Input
                    placeholder="Ex: 123456"
                    value={form.oab}
                    onChange={(e) => updateField('oab', e.target.value.replace(/\D/g, '').slice(0, 7))}
                    className={cn(errors.oab && 'border-destructive')}
                  />
                  {errors.oab && <p className="text-xs text-destructive mt-1">{errors.oab}</p>}
                </div>

                <Button
                  onClick={handleBuscarOAB}
                  className="btn-accent w-full h-11 font-semibold"
                  disabled={oabStatus === 'loading'}
                >
                  {oabStatus === 'loading' ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Buscando OAB...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <Search className="h-4 w-4" />
                      Buscar OAB
                    </span>
                  )}
                </Button>

                {/* OAB Results */}
                {oabStatus === 'ativo' && (
                  <Alert className="border-[hsl(var(--success))]/30 bg-[hsl(var(--success))]/5">
                    <CheckCircle2 className="h-4 w-4 text-[hsl(var(--success))]" />
                    <AlertDescription>
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-semibold text-foreground">{form.nomeCompleto}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">OAB {form.oab}/{form.uf}</p>
                        </div>
                        <span className="badge-status bg-[hsl(var(--success))]/10 text-[hsl(var(--success))]">
                          OAB Ativa
                        </span>
                      </div>
                    </AlertDescription>
                  </Alert>
                )}

                {oabStatus === 'inativo' && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      <p className="font-semibold">OAB Inativa</p>
                      <p className="text-xs mt-0.5">Não é possível criar conta com uma OAB inativa. Entre em contato com a seccional da OAB.</p>
                    </AlertDescription>
                  </Alert>
                )}

                {oabStatus === 'nao_encontrado' && (
                  <Alert variant="destructive">
                    <XCircle className="h-4 w-4" />
                    <AlertDescription>
                      <p className="font-semibold">OAB não encontrada</p>
                      <p className="text-xs mt-0.5">Verifique o número da OAB e o estado informados e tente novamente.</p>
                    </AlertDescription>
                  </Alert>
                )}

                {oabStatus === 'ativo' && (
                  <Button
                    onClick={() => setCurrentStep(2)}
                    className="btn-accent w-full h-11 font-semibold"
                  >
                    Continuar
                    <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Step 2: Personal Data */}
          {currentStep === 2 && (
            <div className="animate-in fade-in slide-in-from-right-4 duration-300">
              <h2 className="text-2xl font-bold mb-1">Dados Pessoais</h2>
              <p className="text-muted-foreground mb-8">
                Complete seus dados para finalizar o cadastro.
              </p>

              <div className="space-y-4">
                {/* Nome (read-only) */}
                <div>
                  <Label className="mb-1.5 block">Nome Completo</Label>
                  <div className="relative">
                    <Input
                      value={form.nomeCompleto}
                      readOnly
                      className="bg-muted cursor-not-allowed pr-20"
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 badge-status bg-[hsl(var(--success))]/10 text-[hsl(var(--success))] text-[10px]">
                      Via OAB
                    </span>
                  </div>
                </div>

                {/* CPF */}
                <div>
                  <Label className="mb-1.5 block">CPF *</Label>
                  <Input
                    placeholder="000.000.000-00"
                    value={form.cpf}
                    onChange={(e) => updateField('cpf', formatCPF(e.target.value))}
                    className={cn(errors.cpf && 'border-destructive')}
                    maxLength={14}
                  />
                  {errors.cpf && <p className="text-xs text-destructive mt-1">{errors.cpf}</p>}
                </div>

                {/* Data de nascimento */}
                <div>
                  <Label className="mb-1.5 block">Data de Nascimento *</Label>
                  <Input
                    type="date"
                    value={form.dataNascimento}
                    onChange={(e) => updateField('dataNascimento', e.target.value)}
                    className={cn(errors.dataNascimento && 'border-destructive')}
                  />
                  {errors.dataNascimento && <p className="text-xs text-destructive mt-1">{errors.dataNascimento}</p>}
                </div>

                {/* Email */}
                <div>
                  <Label className="mb-1.5 block">E-mail *</Label>
                  <Input
                    type="email"
                    placeholder="seu@email.com"
                    value={form.email}
                    onChange={(e) => updateField('email', e.target.value)}
                    className={cn(errors.email && 'border-destructive')}
                  />
                  {errors.email && <p className="text-xs text-destructive mt-1">{errors.email}</p>}
                </div>

                {/* WhatsApp */}
                <div>
                  <Label className="mb-1.5 block">WhatsApp *</Label>
                  <Input
                    placeholder="(00) 00000-0000"
                    value={form.whatsapp}
                    onChange={(e) => updateField('whatsapp', formatPhone(e.target.value))}
                    className={cn(errors.whatsapp && 'border-destructive')}
                    maxLength={15}
                  />
                  {errors.whatsapp && <p className="text-xs text-destructive mt-1">{errors.whatsapp}</p>}
                </div>

                {/* Senha */}
                <div>
                  <Label className="mb-1.5 block">Senha *</Label>
                  <div className="relative">
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Crie uma senha segura"
                      value={form.senha}
                      onChange={(e) => updateField('senha', e.target.value)}
                      className={cn('pr-10', errors.senha && 'border-destructive')}
                    />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {form.senha && (
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2">
                      {[
                        { key: 'length', label: 'Mínimo 8 caracteres' },
                        { key: 'uppercase', label: 'Letra maiúscula' },
                        { key: 'lowercase', label: 'Letra minúscula' },
                        { key: 'number', label: 'Um número' },
                        { key: 'special', label: 'Caractere especial' },
                      ].map(({ key, label }) => (
                        <div key={key} className="flex items-center gap-1.5">
                          {passwordChecks[key as keyof typeof passwordChecks] ? (
                            <CheckCircle2 className="h-3 w-3 text-[hsl(var(--success))]" />
                          ) : (
                            <XCircle className="h-3 w-3 text-muted-foreground/50" />
                          )}
                          <span className={cn(
                            'text-[11px]',
                            passwordChecks[key as keyof typeof passwordChecks] ? 'text-[hsl(var(--success))]' : 'text-muted-foreground/60'
                          )}>
                            {label}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Confirmar Senha */}
                <div>
                  <Label className="mb-1.5 block">Confirmar Senha *</Label>
                  <div className="relative">
                    <Input
                      type={showConfirmPassword ? 'text' : 'password'}
                      placeholder="Confirme sua senha"
                      value={form.confirmarSenha}
                      onChange={(e) => updateField('confirmarSenha', e.target.value)}
                      className={cn('pr-10', errors.confirmarSenha && 'border-destructive')}
                    />
                    <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                      {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {errors.confirmarSenha && <p className="text-xs text-destructive mt-1">{errors.confirmarSenha}</p>}
                  {form.confirmarSenha && form.senha === form.confirmarSenha && !errors.confirmarSenha && (
                    <p className="text-xs text-[hsl(var(--success))] mt-1 flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3" /> Senhas coincidem
                    </p>
                  )}
                </div>
              </div>

              {submitError && (
                <Alert variant="destructive" className="mt-4">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{submitError}</AlertDescription>
                </Alert>
              )}

              <div className="flex gap-3 mt-8">
                <Button
                  variant="outline"
                  onClick={() => setCurrentStep(1)}
                  className="h-11"
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Voltar
                </Button>
                <Button
                  onClick={handleSubmit}
                  className="btn-accent flex-1 h-11 font-semibold"
                  disabled={submitting}
                >
                  {submitting ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Criando conta...
                    </span>
                  ) : (
                    'Criar Conta'
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* Step 3: Email Verification */}
          {currentStep === 3 && (
            <div className="animate-in fade-in slide-in-from-right-4 duration-300 text-center py-8">
              <div className="mx-auto w-20 h-20 rounded-full bg-accent/10 flex items-center justify-center mb-6">
                <Mail className="h-9 w-9 text-accent" />
              </div>

              <h2 className="text-2xl font-bold mb-2">Verifique seu e-mail</h2>
              <p className="text-muted-foreground max-w-sm mx-auto leading-relaxed">
                Enviamos um link de confirmação para{' '}
                <span className="font-semibold text-foreground">{form.email}</span>.
                Verifique sua caixa de entrada e spam.
              </p>

              <div className="mt-8 p-5 rounded-xl bg-secondary/60 border max-w-sm mx-auto">
                <div className="flex items-start gap-3 text-left">
                  <AlertCircle className="h-5 w-5 text-accent shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold">Atenção</p>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      Seu cadastro só será ativado após a confirmação do e-mail. Você não poderá fazer login antes disso.
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-8 space-y-3">
                <Link to="/login">
                  <Button className="btn-accent w-full max-w-sm h-11 font-semibold">
                    Ir para o Login
                  </Button>
                </Link>
                <p className="text-xs text-muted-foreground">
                  Não recebeu?{' '}
                  <button onClick={handleResendEmail} className="text-accent hover:underline font-medium">
                    Reenviar e-mail
                  </button>
                </p>
              </div>
            </div>
          )}

          {/* Login link */}
          {currentStep < 3 && (
            <p className="text-center text-sm text-muted-foreground mt-6">
              Já tem uma conta?{' '}
              <Link to="/login" className="text-accent hover:underline font-medium">
                Fazer login
              </Link>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
