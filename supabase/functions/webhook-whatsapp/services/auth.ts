import { sendWhatsAppText } from './evolution.ts'
import { logInfo } from './logger.ts'
import type { RequestContext, ConversationState } from './types.ts'

const OTP_TTL_MINUTES = 5
const OTP_MAX_ATTEMPTS = 3

function normalizeCpf(value: string): string {
  return value.replace(/\D/g, '')
}

function isValidCpf(rawCpf: string): boolean {
  const cpf = normalizeCpf(rawCpf)
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false

  const calcCheck = (base: string, factor: number) => {
    let total = 0
    for (const digit of base) {
      total += Number(digit) * factor
      factor -= 1
    }
    const rest = (total * 10) % 11
    return rest === 10 ? 0 : rest
  }

  const d1 = calcCheck(cpf.slice(0, 9), 10)
  const d2 = calcCheck(cpf.slice(0, 10), 11)
  return d1 === Number(cpf[9]) && d2 === Number(cpf[10])
}

function generateOtpCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}

async function hashOtp(tenantId: string, phone: string, otp: string): Promise<string> {
  const pepper = Deno.env.get('OTP_PEPPER')
  if (!pepper) {
    throw new Error('otp_pepper_not_configured')
  }
  const content = `${tenantId}:${phone}:${otp}:${pepper}`
  const bytes = new TextEncoder().encode(content)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false

  let mismatch = 0
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }

  return mismatch === 0
}

async function getOrCreateConversation(ctx: RequestContext): Promise<{ id: string; estado: ConversationState; cliente_id: string | null }> {
  const { data: existing } = await ctx.supabase
    .from('conversas')
    .select('id, estado, cliente_id')
    .eq('tenant_id', ctx.tenantId)
    .eq('telefone', ctx.phone)
    .maybeSingle()

  if (existing) return existing

  const { data, error } = await ctx.supabase
    .from('conversas')
    .insert({
      tenant_id: ctx.tenantId,
      telefone: ctx.phone,
      estado: 'UNVERIFIED',
      ultima_interacao: new Date().toISOString(),
    })
    .select('id, estado, cliente_id')
    .single()

  if (error || !data) throw new Error('conversation_create_failed')
  return data
}

export async function isPhoneVerified(ctx: RequestContext): Promise<{ clienteId: string | null; verified: boolean }> {
  const { data } = await ctx.supabase
    .from('telefones')
    .select('cliente_id, verificado')
    .eq('tenant_id', ctx.tenantId)
    .eq('numero', ctx.phone)
    .eq('verificado', true)
    .maybeSingle()

  return { clienteId: data?.cliente_id ?? null, verified: Boolean(data?.verificado) }
}

export async function handleAuthenticationFlow(ctx: RequestContext): Promise<{ authenticated: boolean; clienteId: string | null }> {
  const conversation = await getOrCreateConversation(ctx)

  if (conversation.estado === 'UNVERIFIED') {
    await ctx.supabase
      .from('conversas')
      .update({ estado: 'AWAITING_CPF', ultima_interacao: new Date().toISOString() })
      .eq('id', conversation.id)

    await sendWhatsAppText(ctx.instanceName, ctx.phone, 'Olá! Para continuar, informe seu CPF (somente números).')
    return { authenticated: false, clienteId: null }
  }

  if (conversation.estado === 'AWAITING_CPF') {
    if (!isValidCpf(ctx.message)) {
      await sendWhatsAppText(ctx.instanceName, ctx.phone, 'CPF inválido. Por favor, envie um CPF válido com 11 dígitos.')
      return { authenticated: false, clienteId: null }
    }

    const cpf = normalizeCpf(ctx.message)
    const { data: cliente } = await ctx.supabase
      .from('clientes')
      .select('id, nome')
      .eq('tenant_id', ctx.tenantId)
      .eq('cpf', cpf)
      .maybeSingle()

    if (!cliente) {
      await sendWhatsAppText(ctx.instanceName, ctx.phone, 'Não localizamos seu cadastro. Fale com o escritório para atualizar seus dados.')
      return { authenticated: false, clienteId: null }
    }

    const otp = generateOtpCode()
    const otpHash = await hashOtp(ctx.tenantId, ctx.phone, otp)
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString()

    await ctx.supabase.from('otp_validacoes').delete().eq('tenant_id', ctx.tenantId).eq('telefone', ctx.phone)
    await ctx.supabase.from('otp_validacoes').insert({
      tenant_id: ctx.tenantId,
      telefone: ctx.phone,
      otp_hash: otpHash,
      expires_at: expiresAt,
      tentativas: 0,
    })

    await ctx.supabase
      .from('conversas')
      .update({ estado: 'AWAITING_OTP', cliente_id: cliente.id, ultima_interacao: new Date().toISOString() })
      .eq('id', conversation.id)

    await sendWhatsAppText(ctx.instanceName, ctx.phone, `Seu código de verificação é: ${otp}. Ele expira em 5 minutos.`)
    return { authenticated: false, clienteId: null }
  }

  if (conversation.estado === 'AWAITING_OTP') {
    const { data: otpRecord } = await ctx.supabase
      .from('otp_validacoes')
      .select('id, otp_hash, tentativas, expires_at')
      .eq('tenant_id', ctx.tenantId)
      .eq('telefone', ctx.phone)
      .maybeSingle()

    if (!otpRecord) {
      await ctx.supabase.from('conversas').update({ estado: 'AWAITING_CPF' }).eq('id', conversation.id)
      await sendWhatsAppText(ctx.instanceName, ctx.phone, 'Seu código expirou. Envie novamente seu CPF para gerar um novo código.')
      return { authenticated: false, clienteId: null }
    }

    if (new Date(otpRecord.expires_at).getTime() < Date.now()) {
      await ctx.supabase.from('otp_validacoes').delete().eq('id', otpRecord.id)
      await ctx.supabase.from('conversas').update({ estado: 'AWAITING_CPF' }).eq('id', conversation.id)
      await sendWhatsAppText(ctx.instanceName, ctx.phone, 'Código expirado. Envie seu CPF para gerar um novo OTP.')
      return { authenticated: false, clienteId: null }
    }

    if (otpRecord.tentativas >= OTP_MAX_ATTEMPTS) {
      await ctx.supabase.from('otp_validacoes').delete().eq('id', otpRecord.id)
      await ctx.supabase.from('conversas').update({ estado: 'AWAITING_CPF' }).eq('id', conversation.id)
      await sendWhatsAppText(ctx.instanceName, ctx.phone, 'Você atingiu o limite de tentativas. Envie seu CPF para reiniciar o processo.')
      return { authenticated: false, clienteId: null }
    }

    const incomingOtp = ctx.message.replace(/\D/g, '')
    if (!/^\d{6}$/.test(incomingOtp)) {
      await sendWhatsAppText(ctx.instanceName, ctx.phone, 'OTP inválido. Envie exatamente os 6 dígitos do código recebido.')
      return { authenticated: false, clienteId: null }
    }

    const incomingHash = await hashOtp(ctx.tenantId, ctx.phone, incomingOtp)
    if (!timingSafeEqual(incomingHash, otpRecord.otp_hash)) {
      await ctx.supabase
        .from('otp_validacoes')
        .update({ tentativas: otpRecord.tentativas + 1 })
        .eq('id', otpRecord.id)

      await sendWhatsAppText(ctx.instanceName, ctx.phone, 'OTP inválido. Tente novamente.')
      return { authenticated: false, clienteId: null }
    }

    await ctx.supabase.from('otp_validacoes').delete().eq('id', otpRecord.id)

    await ctx.supabase.from('telefones').upsert({
      tenant_id: ctx.tenantId,
      cliente_id: conversation.cliente_id,
      numero: ctx.phone,
      verificado: true,
    }, { onConflict: 'tenant_id,numero', ignoreDuplicates: false })

    await ctx.supabase
      .from('conversas')
      .update({ estado: 'VERIFIED', ultima_interacao: new Date().toISOString() })
      .eq('id', conversation.id)

    await sendWhatsAppText(ctx.instanceName, ctx.phone, 'Verificação concluída com sucesso. Como posso ajudar você hoje?')

    logInfo('auth_verified', { request_id: ctx.requestId, tenant_id: ctx.tenantId, telefone: ctx.phone })
    return { authenticated: true, clienteId: conversation.cliente_id }
  }

  return { authenticated: conversation.estado === 'VERIFIED', clienteId: conversation.cliente_id }
}
