import { enqueueWhatsAppText } from './outbox.ts'
import { logError, logInfo } from './logger.ts'
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
  notifications_opt_in?: boolean
  cpf_attempts: number
  otp_attempts: number
  blocked_until: string | null
}

type ClientProcessBinding = { process_id: string; process_label: string }

async function getOrCreateContact(ctx: RequestContext): Promise<ContactRecord> {
  const { data: existing } = await ctx.supabase
    .from('whatsapp_contacts')
    .select('id, client_id, process_id, conversation_state, verified, notifications_opt_in, cpf_attempts, otp_attempts, blocked_until')
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
    .select('id, client_id, process_id, conversation_state, verified, notifications_opt_in, cpf_attempts, otp_attempts, blocked_until')
    .single()

  if (error || !data) throw new Error('whatsapp_contact_create_failed')
  return data as ContactRecord
}

async function getActiveClientProcesses(ctx: RequestContext, clienteId: string): Promise<ClientProcessBinding[]> {
  const { data } = await ctx.supabase
    .from('cliente_processos')
    .select('processo_id, processos(numero_cnj)')
    .eq('cliente_id', clienteId)
    .eq('status', 'ativo')

  return (data ?? [])
    .map((entry: any) => ({
      process_id: entry.processo_id as string,
      process_label: entry.processos?.numero_cnj ? `Processo ${entry.processos.numero_cnj}` : `Processo ${entry.processo_id}`,
    }))
    .filter((entry) => Boolean(entry.process_id))
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

async function bindProcessAfterAuth(ctx: RequestContext, contact: ContactRecord): Promise<{ authenticated: boolean }> {
  if (!contact.client_id) throw new Error('auth_without_client')

  const activeProcesses = await getActiveClientProcesses(ctx, contact.client_id)

  if (activeProcesses.length === 1) {
    const now = new Date().toISOString()
    await ctx.supabase
      .from('whatsapp_contacts')
      .update({
        process_id: activeProcesses[0].process_id,
        conversation_state: 'AUTHENTICATED',
        updated_at: now,
      })
      .eq('id', contact.id)

    logInfo('process_auto_bound', {
      request_id: ctx.requestId,
      tenant_id: ctx.tenantId,
      whatsapp_contact_id: contact.id,
      process_id: activeProcesses[0].process_id,
    })

    await enqueueWhatsAppText(ctx, AUTH_MESSAGES.VERIFIED, 'auth', `verified:${contact.id}`)
    return { authenticated: true }
  }

  if (activeProcesses.length > 1) {
    await ctx.supabase
      .from('whatsapp_contacts')
      .update({
        process_id: null,
        conversation_state: 'WAITING_PROCESS_SELECTION',
        updated_at: new Date().toISOString(),
      })
      .eq('id', contact.id)

    const options = activeProcesses.map((processo, index) => `${index + 1} - ${processo.process_label}`).join('\n')
    const text = `Encontrei mais de um processo ativo no seu cadastro. Responda com o número correspondente:\n${options}`
    await enqueueWhatsAppText(ctx, text, 'auth', `select_process:${contact.id}`)
    return { authenticated: false }
  }

  await enqueueWhatsAppText(ctx, AUTH_MESSAGES.VERIFIED, 'auth', `verified_without_process:${contact.id}`)
  return { authenticated: true }
}

async function handleProcessSelection(ctx: RequestContext, contact: ContactRecord): Promise<{ authenticated: boolean; clienteId: string | null }> {
  if (!contact.verified || !contact.client_id) {
    await ctx.supabase
      .from('whatsapp_contacts')
      .update({ conversation_state: 'WAITING_CPF', updated_at: new Date().toISOString() })
      .eq('id', contact.id)
    await enqueueWhatsAppText(ctx, AUTH_MESSAGES.ASK_CPF, 'auth', `ask_cpf_recovery:${contact.id}`)
    return { authenticated: false, clienteId: null }
  }

  const activeProcesses = await getActiveClientProcesses(ctx, contact.client_id)
  if (activeProcesses.length <= 1) {
    const bound = activeProcesses[0]?.process_id ?? null
    await ctx.supabase
      .from('whatsapp_contacts')
      .update({ process_id: bound, conversation_state: 'AUTHENTICATED', updated_at: new Date().toISOString() })
      .eq('id', contact.id)
    return { authenticated: true, clienteId: contact.client_id }
  }

  const selected = Number(ctx.message.trim())
  if (!Number.isInteger(selected) || selected < 1 || selected > activeProcesses.length) {
    await enqueueWhatsAppText(ctx, 'Opção inválida. Responda apenas com o número do processo desejado.', 'auth', `invalid_process_selection:${contact.id}`)
    return { authenticated: false, clienteId: null }
  }

  const chosen = activeProcesses[selected - 1]
  await ctx.supabase
    .from('whatsapp_contacts')
    .update({
      process_id: chosen.process_id,
      conversation_state: 'AUTHENTICATED',
      updated_at: new Date().toISOString(),
    })
    .eq('id', contact.id)

  logInfo('process_manual_bound', {
    request_id: ctx.requestId,
    tenant_id: ctx.tenantId,
    whatsapp_contact_id: contact.id,
    process_id: chosen.process_id,
  })

  await enqueueWhatsAppText(ctx, 'Perfeito. Processo vinculado com sucesso.', 'auth', `process_selected:${contact.id}:${chosen.process_id}`)
  return { authenticated: true, clienteId: contact.client_id }
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

export async function tryActivateNotificationsOptIn(ctx: RequestContext): Promise<boolean> {
  const normalized = ctx.message.trim().toLowerCase()
  if (normalized !== 'sim') return false

  const { data: contact } = await ctx.supabase
    .from('whatsapp_contacts')
    .select('id, verified, notifications_opt_in')
    .eq('tenant_id', ctx.tenantId)
    .eq('phone_number', ctx.phone)
    .maybeSingle()

  if (!contact?.id || !contact.verified || contact.notifications_opt_in) return false

  await ctx.supabase
    .from('whatsapp_contacts')
    .update({ notifications_opt_in: true, updated_at: new Date().toISOString() })
    .eq('id', contact.id)

  await enqueueWhatsAppText(ctx, 'Perfeito. Você agora receberá atualizações automáticas do seu processo.', 'auth', `optin_enabled:${contact.id}`)
  logInfo('notifications_optin_enabled', { request_id: ctx.requestId, tenant_id: ctx.tenantId, whatsapp_contact_id: contact.id })
  return true
}

export async function handleAuthenticationFlow(ctx: RequestContext): Promise<{ authenticated: boolean; clienteId: string | null }> {
  const contact = await getOrCreateContact(ctx)

  if (contact.blocked_until && new Date(contact.blocked_until).getTime() > Date.now()) {
    await enqueueWhatsAppText(ctx, AUTH_MESSAGES.OTP_LOCKED, 'auth', `blocked:${contact.id}`)
    return { authenticated: false, clienteId: null }
  }

  if (contact.conversation_state === 'WAITING_PROCESS_SELECTION') {
    return handleProcessSelection(ctx, contact)
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

    try {
      await ctx.supabase
        .from('whatsapp_contacts')
        .update({
          verified: true,
          otp_attempts: 0,
          cpf_attempts: 0,
          blocked_until: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', contact.id)

      const bindResult = await bindProcessAfterAuth(ctx, { ...contact, verified: true })
      logInfo('auth_verified', { request_id: ctx.requestId, tenant_id: ctx.tenantId, telefone: ctx.phone })
      return { authenticated: bindResult.authenticated, clienteId: contact.client_id }
    } catch (error) {
      logError('auth_bind_process_failed', {
        request_id: ctx.requestId,
        tenant_id: ctx.tenantId,
        telefone: ctx.phone,
        error: String(error),
      })
      throw error
    }
  }

  return { authenticated: contact.verified, clienteId: contact.client_id }
}
