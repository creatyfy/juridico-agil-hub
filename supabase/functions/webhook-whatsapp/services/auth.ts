import { sendWhatsAppText } from './evolution.ts'
import { logInfo } from './logger.ts'
import { AUTH_MESSAGES, OTP_MAX_ATTEMPTS, OTP_TTL_MINUTES } from './messages.ts'
import {
  generateSecureOtp,
  hashOtp,
  isValidCpf,
  normalizeCpf,
  normalizeOtp,
  sha256Hex,
  timingSafeEqual,
} from './security.ts'
import type { RequestContext, ConversationState } from './types.ts'

const OTP_RATE_WINDOW_SECONDS = Number(Deno.env.get('OTP_RATE_WINDOW_SECONDS') ?? '300')
const OTP_MAX_PER_PHONE_WINDOW = Number(Deno.env.get('OTP_MAX_PER_PHONE_WINDOW') ?? '3')
const OTP_MAX_PER_CPF_WINDOW = Number(Deno.env.get('OTP_MAX_PER_CPF_WINDOW') ?? '5')

type ConversationRecord = {
  id: string
  estado: ConversationState
  cliente_id: string | null
}

type OtpRecord = {
  id: string
  otp_hash: string
  tentativas: number
  expires_at: string
}

async function getOrCreateConversation(ctx: RequestContext): Promise<ConversationRecord> {
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

async function enforceScopedRateLimit(ctx: RequestContext, scopeType: 'PHONE' | 'TENANT_CPF', scopeValue: string, max: number): Promise<boolean> {
  const now = new Date()
  const windowStart = new Date(now.getTime() - OTP_RATE_WINDOW_SECONDS * 1000)
  const scopeHash = await sha256Hex(`${ctx.tenantId}:${scopeType}:${scopeValue}`)

  const { data } = await ctx.supabase
    .from('whatsapp_auth_rate_limits')
    .select('id, counter, window_start')
    .eq('tenant_id', ctx.tenantId)
    .eq('scope_type', scopeType)
    .eq('scope_hash', scopeHash)
    .maybeSingle()

  if (!data || new Date(data.window_start).getTime() < windowStart.getTime()) {
    await ctx.supabase
      .from('whatsapp_auth_rate_limits')
      .upsert({
        tenant_id: ctx.tenantId,
        scope_type: scopeType,
        scope_hash: scopeHash,
        window_start: now.toISOString(),
        counter: 1,
      }, { onConflict: 'tenant_id,scope_type,scope_hash', ignoreDuplicates: false })
    return true
  }

  if (data.counter >= max) return false

  await ctx.supabase
    .from('whatsapp_auth_rate_limits')
    .update({ counter: data.counter + 1 })
    .eq('id', data.id)

  return true
}

async function requestOtpForCustomer(ctx: RequestContext, conversation: ConversationRecord, clienteId: string, cpf: string): Promise<void> {
  const canIssueByPhone = await enforceScopedRateLimit(ctx, 'PHONE', ctx.phone, OTP_MAX_PER_PHONE_WINDOW)
  const canIssueByCpf = await enforceScopedRateLimit(ctx, 'TENANT_CPF', cpf, OTP_MAX_PER_CPF_WINDOW)

  if (!canIssueByPhone || !canIssueByCpf) {
    await sendWhatsAppText(ctx.instanceName, ctx.phone, AUTH_MESSAGES.OTP_LOCKED)
    return
  }

  const otp = generateSecureOtp()
  const otpHash = await hashOtp(ctx.tenantId, ctx.phone, otp)
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString()

  // Safe for concurrent requests when paired with unique (tenant_id, telefone).
  await ctx.supabase
    .from('otp_validacoes')
    .upsert({
      tenant_id: ctx.tenantId,
      telefone: ctx.phone,
      otp_hash: otpHash,
      expires_at: expiresAt,
      tentativas: 0,
    }, { onConflict: 'tenant_id,telefone', ignoreDuplicates: false })

  await ctx.supabase
    .from('conversas')
    .update({ estado: 'AWAITING_OTP', cliente_id: clienteId, ultima_interacao: new Date().toISOString() })
    .eq('id', conversation.id)

  await sendWhatsAppText(ctx.instanceName, ctx.phone, `${AUTH_MESSAGES.OTP_SENT} Código: ${otp}`)

  logInfo('otp_issued', {
    request_id: ctx.requestId,
    tenant_id: ctx.tenantId,
    telefone: ctx.phone,
    cpf,
    conversation_id: conversation.id,
  })
}

async function resetOtpFlow(ctx: RequestContext, conversationId: string, otpId?: string): Promise<void> {
  if (otpId) {
    await ctx.supabase.from('otp_validacoes').delete().eq('id', otpId)
  }

  await ctx.supabase
    .from('conversas')
    .update({ estado: 'AWAITING_CPF', cliente_id: null, ultima_interacao: new Date().toISOString() })
    .eq('id', conversationId)
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

    await sendWhatsAppText(ctx.instanceName, ctx.phone, AUTH_MESSAGES.ASK_CPF)
    return { authenticated: false, clienteId: null }
  }

  if (conversation.estado === 'AWAITING_CPF') {
    const cpf = normalizeCpf(ctx.message)
    const cpfValid = isValidCpf(cpf)

    const { data: cliente } = cpfValid
      ? await ctx.supabase
          .from('clientes')
          .select('id')
          .eq('tenant_id', ctx.tenantId)
          .eq('cpf', cpf)
          .maybeSingle()
      : { data: null }

    if (!cpfValid || !cliente) {
      await sendWhatsAppText(ctx.instanceName, ctx.phone, AUTH_MESSAGES.INVALID_OR_UNKNOWN_CPF)
      return { authenticated: false, clienteId: null }
    }

    await requestOtpForCustomer(ctx, conversation, cliente.id, cpf)
    return { authenticated: false, clienteId: null }
  }

  if (conversation.estado === 'AWAITING_OTP') {
    const incomingOtp = normalizeOtp(ctx.message)
    if (!/^\d{6}$/.test(incomingOtp)) {
      await sendWhatsAppText(ctx.instanceName, ctx.phone, AUTH_MESSAGES.OTP_FORMAT)
      return { authenticated: false, clienteId: null }
    }

    const { data: otpRecord } = await ctx.supabase
      .from('otp_validacoes')
      .select('id, otp_hash, tentativas, expires_at')
      .eq('tenant_id', ctx.tenantId)
      .eq('telefone', ctx.phone)
      .maybeSingle()

    if (!otpRecord) {
      await resetOtpFlow(ctx, conversation.id)
      await sendWhatsAppText(ctx.instanceName, ctx.phone, AUTH_MESSAGES.OTP_EXPIRED)
      return { authenticated: false, clienteId: null }
    }

    if (new Date(otpRecord.expires_at).getTime() < Date.now()) {
      await resetOtpFlow(ctx, conversation.id, otpRecord.id)
      await sendWhatsAppText(ctx.instanceName, ctx.phone, AUTH_MESSAGES.OTP_EXPIRED)
      return { authenticated: false, clienteId: null }
    }

    if (otpRecord.tentativas >= OTP_MAX_ATTEMPTS) {
      await resetOtpFlow(ctx, conversation.id, otpRecord.id)
      await sendWhatsAppText(ctx.instanceName, ctx.phone, AUTH_MESSAGES.OTP_LOCKED)
      return { authenticated: false, clienteId: null }
    }

    const incomingHash = await hashOtp(ctx.tenantId, ctx.phone, incomingOtp)
    if (!timingSafeEqual(incomingHash, otpRecord.otp_hash)) {
      await ctx.supabase
        .from('otp_validacoes')
        .update({ tentativas: otpRecord.tentativas + 1 })
        .eq('id', otpRecord.id)

      await sendWhatsAppText(ctx.instanceName, ctx.phone, AUTH_MESSAGES.OTP_INVALID)
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

    await sendWhatsAppText(ctx.instanceName, ctx.phone, AUTH_MESSAGES.VERIFIED)

    logInfo('auth_verified', { request_id: ctx.requestId, tenant_id: ctx.tenantId, telefone: ctx.phone })
    return { authenticated: true, clienteId: conversation.cliente_id }
  }

  return { authenticated: conversation.estado === 'VERIFIED', clienteId: conversation.cliente_id }
}

export type { OtpRecord }
