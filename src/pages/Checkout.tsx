import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CreditCard, Landmark, QrCode } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { enterprisePricing, PLAN_CATALOG } from '@/lib/pricing';
import { parseCheckoutSearchParams } from '@/lib/checkout';

type PaymentMethod = 'credit_card' | 'pix' | 'boleto';
type CheckoutForm = {
  customerName: string;
  customerDocument: string;
  customerEmail: string;
  customerPhone: string;
  addressZip: string;
  addressStreet: string;
  addressNumber: string;
  addressComplement: string;
  addressNeighborhood: string;
  addressCity: string;
  addressState: string;
  cardNumber: string;
  cardName: string;
  cardExpiry: string;
  cardCvv: string;
};

type FormErrors = Partial<Record<keyof CheckoutForm, string>>;

const initialForm: CheckoutForm = {
  customerName: '',
  customerDocument: '',
  customerEmail: '',
  customerPhone: '',
  addressZip: '',
  addressStreet: '',
  addressNumber: '',
  addressComplement: '',
  addressNeighborhood: '',
  addressCity: '',
  addressState: '',
  cardNumber: '',
  cardName: '',
  cardExpiry: '',
  cardCvv: '',
};

const processOptions = Object.keys(enterprisePricing).map(Number);

const formatMoney = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
const onlyDigits = (value: string) => value.replace(/\D/g, '');

function formatCpfCnpj(value: string) {
  const digits = onlyDigits(value).slice(0, 14);

  if (digits.length <= 11) {
    return digits
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  }

  return digits
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}

function formatPhone(value: string) {
  const digits = onlyDigits(value).slice(0, 11);
  if (digits.length <= 10) {
    return digits.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d{1,4})$/, '$1-$2');
  }

  return digits.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d{1,4})$/, '$1-$2');
}

function formatZip(value: string) {
  return onlyDigits(value).slice(0, 8).replace(/(\d{5})(\d{1,3})$/, '$1-$2');
}

function formatCardNumber(value: string) {
  return onlyDigits(value).slice(0, 16).replace(/(\d{4})(?=\d)/g, '$1 ').trim();
}

function formatCardExpiry(value: string) {
  return onlyDigits(value).slice(0, 4).replace(/(\d{2})(\d{1,2})$/, '$1/$2');
}

function isValidCpf(cpf: string) {
  const cleaned = onlyDigits(cpf);
  if (cleaned.length !== 11 || /^(\d)\1+$/.test(cleaned)) return false;

  const calcDigit = (factor: number) => {
    let total = 0;
    for (let i = 0; i < factor - 1; i += 1) total += Number(cleaned.charAt(i)) * (factor - i);
    const rest = (total * 10) % 11;
    return rest === 10 ? 0 : rest;
  };

  return calcDigit(10) === Number(cleaned.charAt(9)) && calcDigit(11) === Number(cleaned.charAt(10));
}

function isValidCnpj(cnpj: string) {
  const cleaned = onlyDigits(cnpj);
  if (cleaned.length !== 14 || /^(\d)\1+$/.test(cleaned)) return false;

  const calc = (base: string, factors: number[]) => {
    const total = base.split('').reduce((acc, digit, idx) => acc + Number(digit) * factors[idx], 0);
    const rest = total % 11;
    return rest < 2 ? 0 : 11 - rest;
  };

  const firstDigit = calc(cleaned.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const secondDigit = calc(cleaned.slice(0, 12) + firstDigit, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);

  return firstDigit === Number(cleaned.charAt(12)) && secondDigit === Number(cleaned.charAt(13));
}

function isFutureExpiry(expiry: string) {
  const [monthRaw, yearRaw] = expiry.split('/');
  const month = Number(monthRaw);
  const year = Number(`20${yearRaw}`);
  if (!month || !year || month < 1 || month > 12) return false;

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  return year > currentYear || (year === currentYear && month >= currentMonth);
}

export default function Checkout() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [form, setForm] = useState<CheckoutForm>(initialForm);
  const [touched, setTouched] = useState<Partial<Record<keyof CheckoutForm, boolean>>>({});
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('credit_card');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingAddress, setIsLoadingAddress] = useState(false);

  const { planSlug, billingCycle, processesCount, hasProcessesParam } = parseCheckoutSearchParams(searchParams);
  const plan = PLAN_CATALOG.find((item) => item.slug === planSlug);

  useEffect(() => {
    // Aguarda searchParams estarem disponíveis antes de validar
    if (!planSlug && !billingCycle) return;

    const isInvalidCycle = !billingCycle;
    const isInvalidPlan = !plan;
    const isInvalidEnterpriseProcess = plan?.isEnterprise
      ? !processesCount || !processOptions.includes(processesCount)
      : false; // planos normais (standard, simple, explorer) não precisam do parâmetro processes

    if (isInvalidCycle || isInvalidPlan || isInvalidEnterpriseProcess) {
      navigate('/planos', { replace: true });
    }
  }, [billingCycle, planSlug, navigate, plan, processesCount]);

  const monthlyPrice = useMemo(() => {
    if (!plan || !billingCycle) return 0;
    if (plan.isEnterprise) return enterprisePricing[processesCount ?? 1000] ?? enterprisePricing[1000];
    return plan.priceMonthly ?? 0;
  }, [billingCycle, plan, processesCount]);

  const annualDiscount = billingCycle === 'annual' ? monthlyPrice * 0.2 : 0;
  const planPrice = billingCycle === 'annual' ? monthlyPrice - annualDiscount : monthlyPrice;
  const activationFee = plan?.isEnterprise ? null : 0;
  const subtotal = planPrice + (activationFee ?? 0);
  const total = subtotal;

  const featuresPreview = useMemo(() => {
    if (!plan) return [];
    return plan.features.filter((feature) => feature.included).slice(0, 5);
  }, [plan]);

  const errors = useMemo<FormErrors>(() => {
    const currentErrors: FormErrors = {};

    if (!form.customerName.trim()) currentErrors.customerName = 'Nome completo é obrigatório.';

    const documentDigits = onlyDigits(form.customerDocument);
    if (!documentDigits) currentErrors.customerDocument = 'CPF ou CNPJ é obrigatório.';
    else if (documentDigits.length === 11 && !isValidCpf(documentDigits)) currentErrors.customerDocument = 'CPF inválido.';
    else if (documentDigits.length === 14 && !isValidCnpj(documentDigits)) currentErrors.customerDocument = 'CNPJ inválido.';
    else if (![11, 14].includes(documentDigits.length)) currentErrors.customerDocument = 'Informe um CPF ou CNPJ válido.';

    if (!form.customerEmail.trim()) currentErrors.customerEmail = 'E-mail é obrigatório.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.customerEmail)) currentErrors.customerEmail = 'E-mail inválido.';

    if (onlyDigits(form.customerPhone).length < 10) currentErrors.customerPhone = 'Telefone/WhatsApp inválido.';

    if (onlyDigits(form.addressZip).length !== 8) currentErrors.addressZip = 'CEP deve ter 8 dígitos.';
    if (!form.addressStreet.trim()) currentErrors.addressStreet = 'Rua é obrigatória.';
    if (!form.addressNumber.trim()) currentErrors.addressNumber = 'Número é obrigatório.';
    if (!form.addressNeighborhood.trim()) currentErrors.addressNeighborhood = 'Bairro é obrigatório.';
    if (!form.addressCity.trim()) currentErrors.addressCity = 'Cidade é obrigatória.';
    if (!form.addressState.trim()) currentErrors.addressState = 'Estado é obrigatório.';

    if (paymentMethod === 'credit_card') {
      if (onlyDigits(form.cardNumber).length !== 16) currentErrors.cardNumber = 'Número do cartão deve ter 16 dígitos.';
      if (!form.cardName.trim()) currentErrors.cardName = 'Nome impresso no cartão é obrigatório.';
      if (!/^\d{2}\/\d{2}$/.test(form.cardExpiry) || !isFutureExpiry(form.cardExpiry)) {
        currentErrors.cardExpiry = 'Validade inválida ou vencida.';
      }
      if (!/^\d{3,4}$/.test(onlyDigits(form.cardCvv))) currentErrors.cardCvv = 'CVV deve conter 3 ou 4 dígitos.';
    }

    return currentErrors;
  }, [form, paymentMethod]);

  const isFormValid = Object.keys(errors).length === 0;

  const markTouched = (field: keyof CheckoutForm) => setTouched((prev) => ({ ...prev, [field]: true }));

  const updateField = (field: keyof CheckoutForm, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const lookupZipCode = async () => {
    const zip = onlyDigits(form.addressZip);
    if (zip.length !== 8) return;

    setIsLoadingAddress(true);
    try {
      const response = await fetch(`https://viacep.com.br/ws/${zip}/json/`);
      const data = await response.json();

      if (data.erro) {
        toast({
          title: 'CEP não encontrado',
          description: 'Confira o CEP digitado para continuar.',
          variant: 'destructive',
        });
        return;
      }

      setForm((prev) => ({
        ...prev,
        addressStreet: data.logradouro ?? prev.addressStreet,
        addressNeighborhood: data.bairro ?? prev.addressNeighborhood,
        addressCity: data.localidade ?? prev.addressCity,
        addressState: data.uf ?? prev.addressState,
      }));
    } catch {
      toast({
        title: 'Falha ao buscar CEP',
        description: 'Não foi possível consultar o ViaCEP no momento.',
        variant: 'destructive',
      });
    } finally {
      setIsLoadingAddress(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setTouched({
      customerName: true,
      customerDocument: true,
      customerEmail: true,
      customerPhone: true,
      addressZip: true,
      addressStreet: true,
      addressNumber: true,
      addressNeighborhood: true,
      addressCity: true,
      addressState: true,
      cardNumber: paymentMethod === 'credit_card',
      cardName: paymentMethod === 'credit_card',
      cardExpiry: paymentMethod === 'credit_card',
      cardCvv: paymentMethod === 'credit_card',
    });

    if (!plan || !billingCycle || !isFormValid) return;

    setIsSubmitting(true);

    try {
      const [{ data: authData }, { data: planData, error: planError }] = await Promise.all([
        supabase.auth.getUser(),
        supabase.from('plans').select('id').eq('slug', plan.slug).single(),
      ]);

      if (planError || !planData) {
        throw new Error('Plano não encontrado no banco.');
      }

      const { error: orderError } = await supabase.from('orders').insert({
        user_id: authData.user?.id ?? null,
        plan_id: planData.id,
        billing_cycle: billingCycle,
        processes_count: plan.isEnterprise ? processesCount : null,
        payment_method: paymentMethod,
        status: 'pending',
        total_amount: total,
        customer_name: form.customerName,
        customer_document: onlyDigits(form.customerDocument),
        customer_email: form.customerEmail,
        customer_phone: onlyDigits(form.customerPhone),
        address_zip: onlyDigits(form.addressZip),
        address_street: form.addressStreet,
        address_number: form.addressNumber,
        address_complement: form.addressComplement || null,
        address_neighborhood: form.addressNeighborhood,
        address_city: form.addressCity,
        address_state: form.addressState,
      });

      if (orderError) {
        throw orderError;
      }

      // TODO: integrar gateway de pagamento aqui (criação de cobrança/intent) antes da confirmação final.
      navigate(
        `/checkout/sucesso?plan=${plan.slug}&cycle=${billingCycle}&total=${total}&method=${paymentMethod}&email=${encodeURIComponent(form.customerEmail)}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Não foi possível finalizar o pedido.';
      toast({ title: 'Erro ao finalizar assinatura', description: message, variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!plan || !billingCycle) return null;

  return (
    <main className="min-h-screen bg-[#F4F6F8] py-8">
      <div className="container mx-auto grid max-w-6xl grid-cols-1 gap-6 px-4 md:grid-cols-[1.3fr_0.9fr] md:px-8">
        <aside className="order-1 md:order-2 md:sticky md:top-6 md:self-start">
          <Card>
            <CardHeader>
              <CardTitle>Resumo do pedido</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between"><span>Plano</span><strong>{plan.name}</strong></div>
              <div className="flex items-center justify-between"><span>Ciclo</span><strong>{billingCycle === 'annual' ? 'Anual' : 'Mensal'}</strong></div>
              {plan.isEnterprise && processesCount && (
                <div className="flex items-center justify-between"><span>Processos</span><strong>{processesCount.toLocaleString('pt-BR')}</strong></div>
              )}
              <div className="flex items-center justify-between"><span>Preço do plano</span><strong>{formatMoney(planPrice)}</strong></div>
              <div className="flex items-center justify-between">
                <span>Taxa de ativação</span>
                <strong>{activationFee === null ? 'a combinar' : formatMoney(activationFee)}</strong>
              </div>
              <div className="flex items-center justify-between"><span>Subtotal</span><strong>{formatMoney(subtotal)}</strong></div>
              {billingCycle === 'annual' && (
                <div className="flex items-center justify-between text-emerald-700">
                  <span>Desconto anual (20%)</span><strong>- {formatMoney(annualDiscount)}</strong>
                </div>
              )}
              <div className="border-t pt-3 text-base flex items-center justify-between">
                <span className="font-semibold">Total a pagar</span>
                <span className="font-bold text-[#2563EB]">{formatMoney(total)}</span>
              </div>
              <p className="text-xs text-slate-500">*O desconto do plano anual é válido somente para pagamento à vista.</p>

              <div className="pt-2">
                <p className="mb-2 text-sm font-semibold">Principais recursos</p>
                <ul className="list-disc space-y-1 pl-5 text-xs text-slate-600">
                  {featuresPreview.map((feature) => (
                    <li key={feature.key}>{feature.label}</li>
                  ))}
                </ul>
              </div>
            </CardContent>
          </Card>
        </aside>

        <section className="order-2 md:order-1">
          <Card>
            <CardHeader>
              <CardTitle>Checkout</CardTitle>
            </CardHeader>
            <CardContent>
              <form className="space-y-8" onSubmit={handleSubmit}>
                <div className="space-y-4">
                  <h2 className="text-lg font-semibold">1. Dados Pessoais / Empresa</h2>
                  <div className="space-y-2">
                    <Label htmlFor="customerName">Nome completo</Label>
                    <Input id="customerName" value={form.customerName} onChange={(e) => updateField('customerName', e.target.value)} onBlur={() => markTouched('customerName')} />
                    {touched.customerName && errors.customerName && <p className="text-xs text-red-600">{errors.customerName}</p>}
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="customerDocument">CPF ou CNPJ</Label>
                      <Input id="customerDocument" value={form.customerDocument} onChange={(e) => updateField('customerDocument', formatCpfCnpj(e.target.value))} onBlur={() => markTouched('customerDocument')} />
                      {touched.customerDocument && errors.customerDocument && <p className="text-xs text-red-600">{errors.customerDocument}</p>}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="customerPhone">Telefone / WhatsApp</Label>
                      <Input id="customerPhone" value={form.customerPhone} onChange={(e) => updateField('customerPhone', formatPhone(e.target.value))} onBlur={() => markTouched('customerPhone')} />
                      {touched.customerPhone && errors.customerPhone && <p className="text-xs text-red-600">{errors.customerPhone}</p>}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="customerEmail">E-mail</Label>
                    <Input id="customerEmail" type="email" value={form.customerEmail} onChange={(e) => updateField('customerEmail', e.target.value)} onBlur={() => markTouched('customerEmail')} />
                    {touched.customerEmail && errors.customerEmail && <p className="text-xs text-red-600">{errors.customerEmail}</p>}
                  </div>
                </div>

                <div className="space-y-4">
                  <h2 className="text-lg font-semibold">2. Endereço de Cobrança</h2>
                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="space-y-2 md:col-span-1">
                      <Label htmlFor="addressZip">CEP</Label>
                      <Input
                        id="addressZip"
                        value={form.addressZip}
                        onChange={(e) => updateField('addressZip', formatZip(e.target.value))}
                        onBlur={() => {
                          markTouched('addressZip');
                          void lookupZipCode();
                        }}
                      />
                      {isLoadingAddress && <p className="text-xs text-slate-500">Buscando endereço...</p>}
                      {touched.addressZip && errors.addressZip && <p className="text-xs text-red-600">{errors.addressZip}</p>}
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label htmlFor="addressStreet">Rua</Label>
                      <Input id="addressStreet" value={form.addressStreet} onChange={(e) => updateField('addressStreet', e.target.value)} onBlur={() => markTouched('addressStreet')} />
                      {touched.addressStreet && errors.addressStreet && <p className="text-xs text-red-600">{errors.addressStreet}</p>}
                    </div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="space-y-2">
                      <Label htmlFor="addressNumber">Número</Label>
                      <Input id="addressNumber" value={form.addressNumber} onChange={(e) => updateField('addressNumber', e.target.value)} onBlur={() => markTouched('addressNumber')} />
                      {touched.addressNumber && errors.addressNumber && <p className="text-xs text-red-600">{errors.addressNumber}</p>}
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label htmlFor="addressComplement">Complemento (opcional)</Label>
                      <Input id="addressComplement" value={form.addressComplement} onChange={(e) => updateField('addressComplement', e.target.value)} />
                    </div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="space-y-2">
                      <Label htmlFor="addressNeighborhood">Bairro</Label>
                      <Input id="addressNeighborhood" value={form.addressNeighborhood} onChange={(e) => updateField('addressNeighborhood', e.target.value)} onBlur={() => markTouched('addressNeighborhood')} />
                      {touched.addressNeighborhood && errors.addressNeighborhood && <p className="text-xs text-red-600">{errors.addressNeighborhood}</p>}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="addressCity">Cidade</Label>
                      <Input id="addressCity" value={form.addressCity} onChange={(e) => updateField('addressCity', e.target.value)} onBlur={() => markTouched('addressCity')} />
                      {touched.addressCity && errors.addressCity && <p className="text-xs text-red-600">{errors.addressCity}</p>}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="addressState">Estado</Label>
                      <Input id="addressState" value={form.addressState} onChange={(e) => updateField('addressState', e.target.value.toUpperCase().slice(0, 2))} onBlur={() => markTouched('addressState')} />
                      {touched.addressState && errors.addressState && <p className="text-xs text-red-600">{errors.addressState}</p>}
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h2 className="text-lg font-semibold">3. Forma de Pagamento</h2>
                  <div className="grid gap-3 md:grid-cols-3">
                    {[
                      { value: 'credit_card', label: 'Cartão de Crédito', icon: CreditCard },
                      { value: 'pix', label: 'PIX', icon: QrCode },
                      { value: 'boleto', label: 'Boleto', icon: Landmark },
                    ].map((method) => (
                      <button
                        key={method.value}
                        type="button"
                        onClick={() => setPaymentMethod(method.value as PaymentMethod)}
                        className={`rounded-lg border p-3 text-left ${paymentMethod === method.value ? 'border-[#2563EB] bg-blue-50' : 'border-slate-200 bg-white'}`}
                      >
                        <method.icon className="mb-2 h-4 w-4" />
                        <p className="text-sm font-medium">{method.label}</p>
                      </button>
                    ))}
                  </div>

                  {paymentMethod === 'credit_card' && (
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2 md:col-span-2">
                        <Label htmlFor="cardNumber">Número do cartão</Label>
                        <Input id="cardNumber" value={form.cardNumber} onChange={(e) => updateField('cardNumber', formatCardNumber(e.target.value))} onBlur={() => markTouched('cardNumber')} />
                        {touched.cardNumber && errors.cardNumber && <p className="text-xs text-red-600">{errors.cardNumber}</p>}
                      </div>
                      <div className="space-y-2 md:col-span-2">
                        <Label htmlFor="cardName">Nome no cartão</Label>
                        <Input id="cardName" value={form.cardName} onChange={(e) => updateField('cardName', e.target.value)} onBlur={() => markTouched('cardName')} />
                        {touched.cardName && errors.cardName && <p className="text-xs text-red-600">{errors.cardName}</p>}
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="cardExpiry">Validade (MM/AA)</Label>
                        <Input id="cardExpiry" value={form.cardExpiry} onChange={(e) => updateField('cardExpiry', formatCardExpiry(e.target.value))} onBlur={() => markTouched('cardExpiry')} />
                        {touched.cardExpiry && errors.cardExpiry && <p className="text-xs text-red-600">{errors.cardExpiry}</p>}
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="cardCvv">CVV</Label>
                        <Input id="cardCvv" value={form.cardCvv} onChange={(e) => updateField('cardCvv', onlyDigits(e.target.value).slice(0, 4))} onBlur={() => markTouched('cardCvv')} />
                        {touched.cardCvv && errors.cardCvv && <p className="text-xs text-red-600">{errors.cardCvv}</p>}
                      </div>
                    </div>
                  )}

                  {paymentMethod === 'pix' && (
                    <p className="rounded-lg bg-slate-100 p-3 text-sm text-slate-700">Após confirmar, você receberá o QR Code para pagamento.</p>
                  )}

                  {paymentMethod === 'boleto' && (
                    <p className="rounded-lg bg-slate-100 p-3 text-sm text-slate-700">O boleto será gerado após a confirmação e enviado para seu e-mail.</p>
                  )}
                </div>

                <Button type="submit" disabled={!isFormValid || isSubmitting} className="h-12 w-full bg-[#2563EB] hover:bg-[#1d4ed8]">
                  {isSubmitting ? 'Finalizando...' : 'Finalizar Assinatura'}
                </Button>
              </form>
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}
