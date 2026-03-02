import { enqueueWhatsAppText } from './outbox.ts'
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
const TEMP_BLOCK_MINUTES = Number(Deno.env.get('WHATSAPP_TEMP_BLOCK_MINUTES') ?? '15')

type ContactRecord = {
  id: string
  client_id: string | null
  process_id: string | null
  conversation_state: ConversationState
  verified: boolean
  cpf_attempts: number
  otp_attempts: number
  blocked_until: string | null
}

async function getOrCreateContact(ctx: RequestContext): Promise<ContactRecord> {
  const { data: existing } = await ctx.supabase
    .from('whatsapp_contacts')
    .select('id, client_id, process_id, conversation_state, verified, cpf_attempts, otp_attempts, blocked_until')
    .eq('tenant_id', ctx.tenantId)
    .eq('phone_number', ctx.phone)
    .maybeSingle()

  if (existing) return existing as ContactRecord

  const { data, error } = await ctx.supabase
    .from('whatsapp_contacts')
    .insert({
      tenant_id: ctx.tenantId,
      phone_number: ctx.phone,
      conversation_state: 'IDLE',
      verified: false,
    })
    .select('id, client_id, process_id, conversation_state, verified, cpf_attempts, otp_attempts, blocked_until')
    .single()

  if (error || !data) throw new Error('whatsapp_contact_create_failed')
  return data as ContactRecord
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
    await ctx.supabase.from('whatsapp_auth_rate_limits').upsert({
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

async function tempBlockContact(ctx: RequestContext, contactId: string): Promise<void> {
  const blockedUntil = new Date(Date.now() + TEMP_BLOCK_MINUTES * 60 * 1000).toISOString()
  await ctx.supabase
    .from('whatsapp_contacts')
    .update({ blocked_until: blockedUntil, conversation_state: 'IDLE' })
    .eq('id', contactId)
}

async function requestOtpForCustomer(ctx: RequestContext, contact: ContactRecord, clienteId: string, cpf: string): Promise<void> {
  const canIssueByPhone = await enforceScopedRateLimit(ctx, 'PHONE', ctx.phone, OTP_MAX_PER_PHONE_WINDOW)
  const canIssueByCpf = await enforceScopedRateLimit(ctx, 'TENANT_CPF', cpf, OTP_MAX_PER_CPF_WINDOW)

  if (!canIssueByPhone || !canIssueByCpf) {
    await enqueueWhatsAppText(ctx, AUTH_MESSAGES.OTP_LOCKED, 'auth', `otp_locked:${contact.id}`)
    return
  }

  const otp = generateSecureOtp()
  const otpHash = await hashOtp(ctx.tenantId, ctx.phone, otp)
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000).toISOString()

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
    .from('whatsapp_contacts')
    .update({
      client_id: clienteId,
      conversation_state: 'WAITING_OTP',
      cpf_attempts: 0,
      otp_attempts: 0,
      blocked_until: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', contact.id)

  await enqueueWhatsAppText(ctx, `${AUTH_MESSAGES.OTP_SENT} Código: ${otp}`, 'auth', `otp_sent:${contact.id}:${expiresAt}`)

  logInfo('otp_issued', { request_id: ctx.requestId, tenant_id: ctx.tenantId, telefone: ctx.phone, cpf, whatsapp_contact_id: contact.id })
}

async function resetOtpFlow(ctx: RequestContext, contactId: string, otpId?: string): Promise<void> {
  if (otpId) {
    await ctx.supabase.from('otp_validacoes').delete().eq('id', otpId)
  }

  await ctx.supabase
    .from('whatsapp_contacts')
    .update({
      conversation_state: 'WAITING_CPF',
      client_id: null,
      process_id: null,
      otp_attempts: 0,
      updated_at: new Date().toISOString(),
    })
    .eq('id', contactId)
}

export async function isPhoneVerified(ctx: RequestContext): Promise<{ clienteId: string | null; verified: boolean }> {
  const { data } = await ctx.supabase
    .from('whatsapp_contacts')
    .select('client_id, verified')
    .eq('tenant_id', ctx.tenantId)
    .eq('phone_number', ctx.phone)
    .eq('verified', true)
    .maybeSingle()

  return { clienteId: data?.client_id ?? null, verified: Boolean(data?.verified) }
}

export async function handleAuthenticationFlow(ctx: RequestContext): Promise<{ authenticated: boolean; clienteId: string | null }> {
  const contact = await getOrCreateContact(ctx)

  if (contact.blocked_until && new Date(contact.blocked_until).getTime() > Date.now()) {
    await enqueueWhatsAppText(ctx, AUTH_MESSAGES.OTP_LOCKED, 'auth', `blocked:${contact.id}`)
    return { authenticated: false, clienteId: null }
  }

  if (contact.conversation_state === 'IDLE') {
    await ctx.supabase.from('whatsapp_contacts').update({ conversation_state: 'WAITING_CPF', updated_at: new Date().toISOString() }).eq('id', contact.id)
    await enqueueWhatsAppText(ctx, AUTH_MESSAGES.ASK_CPF, 'auth', `ask_cpf:${contact.id}`)
    return { authenticated: false, clienteId: null }
  }

  if (contact.conversation_state === 'WAITING_CPF') {
    const cpf = normalizeCpf(ctx.message)
    const cpfValid = isValidCpf(cpf)

    const { data: cliente } = cpfValid
      ? await ctx.supabase.from('clientes').select('id').eq('tenant_id', ctx.tenantId).eq('cpf', cpf).maybeSingle()
      : { data: null }

    if (!cpfValid || !cliente) {
      const attempts = Number(contact.cpf_attempts ?? 0) + 1
      const shouldBlock = attempts >= 3

      await ctx.supabase
        .from('whatsapp_contacts')
        .update({
          cpf_attempts: attempts,
          blocked_until: shouldBlock ? new Date(Date.now() + TEMP_BLOCK_MINUTES * 60 * 1000).toISOString() : null,
          conversation_state: shouldBlock ? 'IDLE' : 'WAITING_CPF',
          updated_at: new Date().toISOString(),
        })
        .eq('id', contact.id)

      await enqueueWhatsAppText(ctx, AUTH_MESSAGES.INVALID_OR_UNKNOWN_CPF, 'auth', `invalid_cpf:${contact.id}:${attempts}`)
      return { authenticated: false, clienteId: null }
    }

    await requestOtpForCustomer(ctx, contact, cliente.id, cpf)
    return { authenticated: false, clienteId: null }
  }

  if (contact.conversation_state === 'WAITING_OTP') {
    const incomingOtp = normalizeOtp(ctx.message)
    if (!/^\d{6}$/.test(incomingOtp)) {
      await enqueueWhatsAppText(ctx, AUTH_MESSAGES.OTP_FORMAT, 'auth', `otp_format:${contact.id}`)
      return { authenticated: false, clienteId: null }
    }

    const { data: otpRecord } = await ctx.supabase
      .from('otp_validacoes')
      .select('id, otp_hash, tentativas, expires_at')
      .eq('tenant_id', ctx.tenantId)
      .eq('telefone', ctx.phone)
      .maybeSingle()

    if (!otpRecord || new Date(otpRecord.expires_at).getTime() < Date.now()) {
      await resetOtpFlow(ctx, contact.id, otpRecord?.id)
      await enqueueWhatsAppText(ctx, AUTH_MESSAGES.OTP_EXPIRED, 'auth', `otp_expired:${contact.id}`)
      return { authenticated: false, clienteId: null }
    }

    if (otpRecord.tentativas >= OTP_MAX_ATTEMPTS || (contact.otp_attempts ?? 0) >= OTP_MAX_ATTEMPTS) {
      await resetOtpFlow(ctx, contact.id, otpRecord.id)
      await tempBlockContact(ctx, contact.id)
      await enqueueWhatsAppText(ctx, AUTH_MESSAGES.OTP_LOCKED, 'auth', `otp_locked:${contact.id}`)
      return { authenticated: false, clienteId: null }
    }

    const incomingHash = await hashOtp(ctx.tenantId, ctx.phone, incomingOtp)
    if (!timingSafeEqual(incomingHash, otpRecord.otp_hash)) {
      const attempts = Number(otpRecord.tentativas ?? 0) + 1
      await ctx.supabase.from('otp_validacoes').update({ tentativas: attempts }).eq('id', otpRecord.id)
      await ctx.supabase.from('whatsapp_contacts').update({ otp_attempts: attempts, updated_at: new Date().toISOString() }).eq('id', contact.id)
      await enqueueWhatsAppText(ctx, AUTH_MESSAGES.OTP_INVALID, 'auth', `otp_invalid:${contact.id}:${attempts}`)
      return { authenticated: false, clienteId: null }
    }

    await ctx.supabase.from('otp_validacoes').delete().eq('id', otpRecord.id)

    await ctx.supabase
      .from('whatsapp_contacts')
      .update({
        verified: true,
        conversation_state: 'AUTHENTICATED',
        otp_attempts: 0,
        cpf_attempts: 0,
        blocked_until: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', contact.id)

    await enqueueWhatsAppText(ctx, AUTH_MESSAGES.VERIFIED, 'auth', `verified:${contact.id}`)
    logInfo('auth_verified', { request_id: ctx.requestId, tenant_id: ctx.tenantId, telefone: ctx.phone })

    return { authenticated: true, clienteId: contact.client_id }
  }

  return { authenticated: contact.verified, clienteId: contact.client_id }
}
