// @ts-nocheck - Deno edge function
import { enqueueWhatsAppText } from './whatsapp-outbox.ts'
import { logError, logInfo } from './whatsapp-logger.ts'
import { isValidCpf, normalizeCpf } from './whatsapp-security.ts'
import type { RequestContext } from './whatsapp-types.ts'

const TEMP_BLOCK_MINUTES = Number(Deno.env.get('WHATSAPP_TEMP_BLOCK_MINUTES') ?? '15')
const MAX_CPF_ATTEMPTS = 3

const MESSAGES = {
  ASK_CPF: 'Olá! Para consultar seus processos, informe seu CPF (somente os 11 números).',
  INVALID_CPF: 'CPF inválido ou não encontrado no nosso cadastro. Verifique e tente novamente.',
  BLOCKED: 'Você excedeu o número de tentativas. Aguarde 15 minutos e tente novamente.',
} as const

type ContactRecord = {
  id: string
  client_id: string | null
  process_id: string | null
  conversation_state: string
  verified: boolean
  notifications_opt_in: boolean
  cpf_attempts: number
  blocked_until: string | null
}

async function getOrCreateContact(ctx: RequestContext): Promise<ContactRecord> {
  const { data: existing } = await ctx.supabase
    .from('whatsapp_contacts')
    .select('id, client_id, process_id, conversation_state, verified, notifications_opt_in, cpf_attempts, blocked_until')
    .eq('tenant_id', ctx.tenantId)
    .eq('phone_number', ctx.phone)
    .maybeSingle()

  if (existing) return existing as ContactRecord

  const { data, error } = await ctx.supabase
    .from('whatsapp_contacts')
    .insert({
      tenant_id: ctx.tenantId,
      phone_number: ctx.phone,
      conversation_state: 'WAITING_CPF',
      verified: false,
      notifications_opt_in: false,
      cpf_attempts: 0,
    })
    .select('id, client_id, process_id, conversation_state, verified, notifications_opt_in, cpf_attempts, blocked_until')
    .single()

  if (error || !data) throw new Error('whatsapp_contact_create_failed')

  // First contact: ask for CPF
  await enqueueWhatsAppText(ctx, MESSAGES.ASK_CPF, 'auth', `ask_cpf:${data.id}`)

  return data as ContactRecord
}

async function getFirstActiveProcessId(ctx: RequestContext, clienteId: string): Promise<string | null> {
  const { data } = await ctx.supabase
    .from('cliente_processos')
    .select('processo_id')
    .eq('cliente_id', clienteId)
    .eq('status', 'ativo')

  if (!data || data.length === 0) return null
  if (data.length === 1) return data[0].processo_id
  // More than one process: return null (no single binding)
  return null
}

export async function isPhoneVerified(ctx: RequestContext): Promise<{ verified: boolean; clienteId: string | null }> {
  const { data } = await ctx.supabase
    .from('whatsapp_contacts')
    .select('client_id, verified')
    .eq('tenant_id', ctx.tenantId)
    .eq('phone_number', ctx.phone)
    .eq('verified', true)
    .maybeSingle()

  return { verified: Boolean(data?.verified), clienteId: data?.client_id ?? null }
}

export async function tryActivateNotificationsOptIn(_ctx: RequestContext): Promise<boolean> {
  // Opt-in is automatic during CPF verification — nothing to do here
  return false
}

export async function handleAuthenticationFlow(ctx: RequestContext): Promise<{ authenticated: boolean; clienteId: string | null }> {
  const contact = await getOrCreateContact(ctx)

  // If blocked, reject
  if (contact.blocked_until && new Date(contact.blocked_until).getTime() > Date.now()) {
    await enqueueWhatsAppText(ctx, MESSAGES.BLOCKED, 'auth', `blocked:${contact.id}`)
    return { authenticated: false, clienteId: null }
  }

  // If already verified, return immediately
  if (contact.verified && contact.client_id) {
    return { authenticated: true, clienteId: contact.client_id }
  }

  // New contact was just created and ASK_CPF was already sent
  if (contact.conversation_state === 'WAITING_CPF') {
    // The current message IS the CPF attempt (unless it was the first message that triggered creation)
    // If getOrCreateContact just created the contact, it already sent ASK_CPF and we return
    // Otherwise, process the CPF
    const cpf = normalizeCpf(ctx.message)

    // If message doesn't look like a CPF at all, remind them
    if (cpf.length < 11) {
      await enqueueWhatsAppText(ctx, MESSAGES.ASK_CPF, 'auth', `remind_cpf:${contact.id}`)
      return { authenticated: false, clienteId: null }
    }

    if (!isValidCpf(cpf)) {
      const attempts = (contact.cpf_attempts ?? 0) + 1
      const shouldBlock = attempts >= MAX_CPF_ATTEMPTS
      await ctx.supabase
        .from('whatsapp_contacts')
        .update({
          cpf_attempts: attempts,
          blocked_until: shouldBlock ? new Date(Date.now() + TEMP_BLOCK_MINUTES * 60 * 1000).toISOString() : null,
          conversation_state: shouldBlock ? 'IDLE' : 'WAITING_CPF',
          updated_at: new Date().toISOString(),
        })
        .eq('id', contact.id)

      await enqueueWhatsAppText(ctx, shouldBlock ? MESSAGES.BLOCKED : MESSAGES.INVALID_CPF, 'auth', `invalid_cpf:${contact.id}:${attempts}`)
      return { authenticated: false, clienteId: null }
    }

    // Valid CPF format — look up client using user_id (advogado) + documento
    const { data: cliente } = await ctx.supabase
      .from('clientes')
      .select('id')
      .eq('user_id', ctx.tenantId)
      .eq('documento', cpf)
      .maybeSingle()

    if (!cliente) {
      const attempts = (contact.cpf_attempts ?? 0) + 1
      const shouldBlock = attempts >= MAX_CPF_ATTEMPTS
      await ctx.supabase
        .from('whatsapp_contacts')
        .update({
          cpf_attempts: attempts,
          blocked_until: shouldBlock ? new Date(Date.now() + TEMP_BLOCK_MINUTES * 60 * 1000).toISOString() : null,
          conversation_state: shouldBlock ? 'IDLE' : 'WAITING_CPF',
          updated_at: new Date().toISOString(),
        })
        .eq('id', contact.id)

      await enqueueWhatsAppText(ctx, shouldBlock ? MESSAGES.BLOCKED : MESSAGES.INVALID_CPF, 'auth', `unknown_cpf:${contact.id}:${attempts}`)
      return { authenticated: false, clienteId: null }
    }

    // CPF found — complete vinculação
    const firstProcessId = await getFirstActiveProcessId(ctx, cliente.id)

    // Update whatsapp_contacts
    await ctx.supabase
      .from('whatsapp_contacts')
      .update({
        client_id: cliente.id,
        process_id: firstProcessId,
        conversation_state: 'AUTHENTICATED',
        verified: true,
        notifications_opt_in: true,
        cpf_attempts: 0,
        blocked_until: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', contact.id)

    // Save phone number on clientes table
    await ctx.supabase
      .from('clientes')
      .update({ numero_whatsapp: ctx.phone })
      .eq('id', cliente.id)

    logInfo('cpf_auth_verified', {
      request_id: ctx.requestId,
      tenant_id: ctx.tenantId,
      telefone: ctx.phone,
      cliente_id: cliente.id,
      process_id: firstProcessId,
    })

    return { authenticated: true, clienteId: cliente.id }
  }

  // IDLE state: transition to WAITING_CPF
  if (contact.conversation_state === 'IDLE') {
    await ctx.supabase
      .from('whatsapp_contacts')
      .update({ conversation_state: 'WAITING_CPF', updated_at: new Date().toISOString() })
      .eq('id', contact.id)

    await enqueueWhatsAppText(ctx, MESSAGES.ASK_CPF, 'auth', `ask_cpf:${contact.id}`)
    return { authenticated: false, clienteId: null }
  }

  // Fallback
  return { authenticated: contact.verified, clienteId: contact.client_id }
}
