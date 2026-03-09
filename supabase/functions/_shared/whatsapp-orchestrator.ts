// @ts-nocheck - Deno edge function
import { classifyIntent, generateContextualResponse } from './whatsapp-ai.ts'
import type { ClienteInfo, ProcessoInfo } from './whatsapp-ai.ts'
import { enqueueWhatsAppText } from './whatsapp-outbox.ts'
import { logError, logInfo } from './whatsapp-logger.ts'
import type { RequestContext } from './whatsapp-types.ts'

async function logConversation(ctx: RequestContext, direction: 'inbound' | 'outbound', message: string, intent?: string): Promise<void> {
  await ctx.supabase.from('conversation_logs').insert({
    tenant_id: ctx.tenantId,
    phone_number: ctx.phone,
    message,
    direction,
    intent: intent ?? null,
  })
}

async function registerEscalation(ctx: RequestContext, clienteId: string | null, reason: string, metadata: Record<string, unknown>) {
  await ctx.supabase.from('notificacoes').insert({
    user_id: ctx.tenantId,
    tipo: 'whatsapp_escalacao',
    titulo: `Escalação de atendimento (${reason})`,
    mensagem: `Contato ${ctx.phone} solicitou apoio humano.`,
    link: '/atendimento',
    metadata: { cliente_id: clienteId, ...metadata },
  })
}

async function fetchClienteInfo(ctx: RequestContext, clienteId: string): Promise<ClienteInfo> {
  if (!clienteId || clienteId === 'sem_cadastro') {
    return { nome: 'Cliente', processos: [] }
  }

  const { data: cliente } = await ctx.supabase
    .from('clientes')
    .select('nome')
    .eq('id', clienteId)
    .eq('user_id', ctx.tenantId)
    .maybeSingle()

  const nome = cliente?.nome ?? 'Cliente'

  const { data: bindings } = await ctx.supabase
    .from('cliente_processos')
    .select('processo_id')
    .eq('cliente_id', clienteId)
    .eq('status', 'ativo')

  const processoIds = (bindings ?? []).map((b: any) => b.processo_id).filter(Boolean)

  if (processoIds.length === 0) {
    return { nome, processos: [] }
  }

  const { data: processosData } = await ctx.supabase
    .from('processos')
    .select('id, numero_cnj, tribunal, vara, classe, assunto, status, data_distribuicao')
    .eq('user_id', ctx.tenantId)
    .in('id', processoIds)

  const processos: ProcessoInfo[] = []

  for (const proc of processosData ?? []) {
    const { data: movs } = await ctx.supabase
      .from('movimentacoes')
      .select('descricao, data_movimentacao')
      .eq('processo_id', proc.id)
      .order('data_movimentacao', { ascending: false })
      .limit(5)

    processos.push({
      numero_cnj: proc.numero_cnj,
      tribunal: proc.tribunal,
      vara: proc.vara,
      classe: proc.classe,
      assunto: proc.assunto,
      status: proc.status,
      data_distribuicao: proc.data_distribuicao,
      movimentacoes: (movs ?? []).map((m: any) => ({
        descricao: m.descricao,
        data_movimentacao: m.data_movimentacao,
      })),
    })
  }

  return { nome, processos }
}

async function handleUnregisteredContact(ctx: RequestContext & { clienteId: string }): Promise<void> {
  const { data: state } = await ctx.supabase
    .from('whatsapp_contacts')
    .select('conversation_state, metadata')
    .eq('tenant_id', ctx.tenantId)
    .eq('phone_number', ctx.phone)
    .maybeSingle()

  const conversationState = (state?.conversation_state as string) ?? 'IDLE'
  const metadata = (state?.metadata as Record<string, any>) ?? {}

  // State: waiting for CPF
  if (conversationState === 'AWAITING_CPF') {
    const cpf = ctx.message.replace(/\D/g, '')
    if (cpf.length !== 11) {
      await enqueueWhatsAppText(ctx, 'CPF inválido. Por favor, informe os 11 números do seu CPF.', 'orchestrator', `cpf_invalid:${ctx.phone}:${ctx.requestId}`)
      return
    }

    const { data: cliente } = await ctx.supabase
      .from('clientes')
      .select('id, nome, numero_whatsapp')
      .eq('user_id', ctx.tenantId)
      .eq('documento', cpf)
      .maybeSingle()

    if (!cliente) {
      await enqueueWhatsAppText(ctx, 'Não encontrei nenhum cadastro com esse CPF. Entre em contato com o escritório para mais informações.', 'orchestrator', `cpf_notfound:${ctx.phone}:${ctx.requestId}`)
      await ctx.supabase.from('whatsapp_contacts').upsert({
        tenant_id: ctx.tenantId,
        phone_number: ctx.phone,
        conversation_state: 'IDLE',
        metadata: {},
      }, { onConflict: 'tenant_id,phone_number' })
      return
    }

    // Found — ask to link
    await ctx.supabase.from('whatsapp_contacts').upsert({
      tenant_id: ctx.tenantId,
      phone_number: ctx.phone,
      conversation_state: 'AWAITING_LINK_CONFIRM',
      metadata: { pending_cliente_id: cliente.id, pending_cliente_nome: cliente.nome },
    }, { onConflict: 'tenant_id,phone_number' })

    await enqueueWhatsAppText(
      ctx,
      `Encontrei seu cadastro, *${cliente.nome}*! Deseja vincular este número WhatsApp ao seu cadastro para receber atualizações automáticas dos seus processos? Responda *SIM* para confirmar.`,
      'orchestrator',
      `cpf_found:${ctx.phone}:${ctx.requestId}`,
    )
    return
  }

  // State: waiting for link confirmation
  if (conversationState === 'AWAITING_LINK_CONFIRM') {
    const answer = ctx.message.trim().toLowerCase()
    if (answer === 'sim' || answer === 'sim.' || answer === 's') {
      const pendingClienteId = metadata?.pending_cliente_id
      if (pendingClienteId) {
        await ctx.supabase.from('clientes').update({ numero_whatsapp: ctx.phone, status_vinculo: 'ativo' }).eq('id', pendingClienteId)
        await ctx.supabase.from('whatsapp_contacts').upsert({
          tenant_id: ctx.tenantId,
          phone_number: ctx.phone,
          conversation_state: 'IDLE',
          verified: true,
          client_id: pendingClienteId,
          metadata: {},
        }, { onConflict: 'tenant_id,phone_number' })
        await enqueueWhatsAppText(ctx, 'Número vinculado com sucesso! ✅ A partir de agora você receberá atualizações dos seus processos aqui. Em que posso ajudar?', 'orchestrator', `linked:${ctx.phone}:${ctx.requestId}`)
      }
    } else {
      await ctx.supabase.from('whatsapp_contacts').upsert({
        tenant_id: ctx.tenantId,
        phone_number: ctx.phone,
        conversation_state: 'IDLE',
        metadata: {},
      }, { onConflict: 'tenant_id,phone_number' })
      await enqueueWhatsAppText(ctx, 'Tudo bem! Se precisar de ajuda, é só me chamar.', 'orchestrator', `link_declined:${ctx.phone}:${ctx.requestId}`)
    }
    return
  }

  // Default IDLE state for unregistered contact — ask CPF
  await enqueueWhatsAppText(
    ctx,
    'Olá! Para consultar informações sobre seus processos, preciso identificar seu cadastro. Por favor, informe seu *CPF* (somente números).',
    'orchestrator',
    `ask_cpf:${ctx.phone}:${ctx.requestId}`,
  )
  await ctx.supabase.from('whatsapp_contacts').upsert({
    tenant_id: ctx.tenantId,
    phone_number: ctx.phone,
    conversation_state: 'AWAITING_CPF',
    metadata: {},
  }, { onConflict: 'tenant_id,phone_number' })
}

export async function handleIncomingMessage(ctx: RequestContext & { clienteId: string }) {
  try {
    console.log(`[DEBUG-ORCH] handleIncomingMessage start clienteId=${ctx.clienteId} phone=${ctx.phone} msg="${ctx.message.slice(0, 30)}"`)

    // Handle unregistered contacts with state machine
    if (ctx.clienteId === 'sem_cadastro') {
      await logConversation(ctx, 'inbound', ctx.message)
      await handleUnregisteredContact(ctx)
      return
    }

    const { data: recentLogs } = await ctx.supabase
      .from('conversation_logs')
      .select('direction, message')
      .eq('tenant_id', ctx.tenantId)
      .eq('phone_number', ctx.phone)
      .order('created_at', { ascending: false })
      .limit(6)

    await logConversation(ctx, 'inbound', ctx.message)

    const history = (recentLogs ?? []).reverse()
    const contextLines = history.map((l: any) => `${l.direction === 'inbound' ? 'Cliente' : 'Bot'}: ${l.message}`).join('\n')
    const intentInput = history.length > 0 ? `${contextLines}\nCliente: ${ctx.message}` : ctx.message

    const intent = await classifyIntent(intentInput)

    logInfo('orchestrator_decision', {
      request_id: ctx.requestId,
      tenant_id: ctx.tenantId,
      telefone: ctx.phone,
      intent,
    })

    if (intent === 'OPT_OUT') {
      await ctx.supabase
        .from('whatsapp_contacts')
        .update({ notifications_opt_in: false, updated_at: new Date().toISOString() })
        .eq('tenant_id', ctx.tenantId)
        .eq('phone_number', ctx.phone)

      const text = 'Entendido. Você não receberá mais notificações automáticas sobre seus processos. Para reativar, entre em contato com o escritório.'
      await enqueueWhatsAppText(ctx, text, 'orchestrator', `opt_out:${ctx.clienteId}:${ctx.requestId}`)
      return
    }

    if (intent === 'HUMAN_SUPPORT') {
      await ctx.supabase
        .from('whatsapp_contacts')
        .update({ conversation_state: 'HUMAN_REQUIRED', updated_at: new Date().toISOString() })
        .eq('tenant_id', ctx.tenantId)
        .eq('phone_number', ctx.phone)

      await registerEscalation(ctx, ctx.clienteId, 'HUMAN_SUPPORT', { intent })
      const text = 'Perfeito. Encaminhei sua conversa para o advogado responsável, que continuará o atendimento por aqui.'
      await enqueueWhatsAppText(ctx, text, 'orchestrator', `human_support:${ctx.clienteId}:${ctx.requestId}`)
      return
    }

    if (intent === 'NEW_CLIENT') {
      const text = 'Obrigado pelo contato! Vou registrar seu interesse e nossa equipe entrará em contato para o atendimento inicial.'
      await registerEscalation(ctx, ctx.clienteId, 'NEW_CLIENT', { intent })
      await enqueueWhatsAppText(ctx, text, 'orchestrator', `new_client:${ctx.requestId}`)
      return
    }

    // For registered contacts: fetch info and generate contextual response
    const clienteInfo = await fetchClienteInfo(ctx, ctx.clienteId)
    const response = await generateContextualResponse(clienteInfo, ctx.message, contextLines, intent)
    await enqueueWhatsAppText(ctx, response, 'orchestrator', `contextual:${ctx.clienteId}:${ctx.requestId}`)
  } catch (error) {
    console.error(`[DEBUG-ORCH] EXCEPTION: ${String(error)}`)
    logError('orchestrator_failed', {
      request_id: ctx.requestId,
      tenant_id: ctx.tenantId,
      telefone: ctx.phone,
      error: String(error),
    })

    const fallback = 'Tivemos uma instabilidade no atendimento automático. Já encaminhamos para atendimento humano continuar com você.'
    await enqueueWhatsAppText(ctx, fallback, 'orchestrator', `ai_fallback:${ctx.requestId}`)
    await registerEscalation(ctx, ctx.clienteId, 'AI_FALLBACK', { error: String(error) })
  }
}
