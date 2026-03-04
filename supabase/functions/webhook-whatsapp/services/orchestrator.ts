import { classifyIntent, explainMovement } from './ai.ts'
import { enqueueWhatsAppText } from './outbox.ts'
import { logError, logInfo } from './logger.ts'
import type { RequestContext } from './types.ts'

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

export async function getClientProcessByCPF(ctx: RequestContext, cpf: string): Promise<string> {
  const { data: cliente } = await ctx.supabase
    .from('clientes')
    .select('id, nome')
    .eq('tenant_id', ctx.tenantId)
    .eq('cpf', cpf)
    .maybeSingle()

  if (!cliente) {
    return 'Não encontramos processo ativo para os dados informados. Se preferir, posso encaminhar para atendimento humano.'
  }

  const { data: binding } = await ctx.supabase
    .from('cliente_processos')
    .select('processo_id')
    .eq('cliente_id', cliente.id)
    .eq('status', 'ativo')
    .limit(1)
    .maybeSingle()

  if (!binding?.processo_id) {
    return 'No momento não há processo ativo vinculado ao seu cadastro.'
  }

  const { data: movement } = await ctx.supabase
    .from('movimentacoes')
    .select('id, descricao, data_movimentacao')
    .eq('processo_id', binding.processo_id)
    .order('data_movimentacao', { ascending: false })
    .limit(1)
    .maybeSingle()

  await ctx.supabase.from('process_consultation_audit_logs').insert({
    tenant_id: ctx.tenantId,
    phone_number: ctx.phone,
    client_id: cliente.id,
    process_id: binding.processo_id,
    intent: 'PROCESS_STATUS',
  })

  if (!movement) {
    return 'Seu processo está ativo, sem movimentação recente registrada até o momento.'
  }

  const summary = await explainMovement(movement.descricao ?? 'Nova movimentação processual detectada')
  const movementDate = new Date(movement.data_movimentacao ?? new Date().toISOString()).toLocaleDateString('pt-BR')
  return `Seu processo teve atualização em ${movementDate}. ${summary}`
}

export async function handleIncomingMessage(ctx: RequestContext & { clienteId: string }) {
  try {
    await logConversation(ctx, 'inbound', ctx.message)

    const intent = await classifyIntent(ctx.message)

    logInfo('orchestrator_decision', {
      request_id: ctx.requestId,
      tenant_id: ctx.tenantId,
      telefone: ctx.phone,
      intent,
    })

    if (intent === 'HUMAN_SUPPORT') {
      await ctx.supabase
        .from('whatsapp_contacts')
        .update({ conversation_state: 'HUMAN_REQUIRED', updated_at: new Date().toISOString() })
        .eq('tenant_id', ctx.tenantId)
        .eq('phone_number', ctx.phone)

      await registerEscalation(ctx, ctx.clienteId, 'HUMAN_SUPPORT', { intent })
      const text = 'Perfeito. Encaminhei sua conversa para atendimento humano e um responsável continuará por aqui.'
      await enqueueWhatsAppText(ctx, text, 'orchestrator', `human_support:${ctx.clienteId}:${ctx.requestId}`)
      return
    }

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

    if (intent === 'PROCESS_STATUS') {
      const { data: cliente } = await ctx.supabase
        .from('clientes')
        .select('cpf')
        .eq('id', ctx.clienteId)
        .maybeSingle()

      const response = await getClientProcessByCPF(ctx, cliente?.cpf ?? '')
      await enqueueWhatsAppText(ctx, response, 'orchestrator', `process_status:${ctx.clienteId}:${ctx.requestId}`)
      return
    }

    if (intent === 'NEW_CLIENT') {
      const text = 'Obrigado pelo contato. Vou registrar seu interesse e nossa equipe entrará em contato para o onboarding inicial.'
      await registerEscalation(ctx, ctx.clienteId, 'NEW_CLIENT', { intent })
      await enqueueWhatsAppText(ctx, text, 'orchestrator', `new_client:${ctx.requestId}`)
      return
    }

    const fallback = 'Entendi! Posso consultar andamento processual ou encaminhar você para atendimento humano quando preferir.'
    await enqueueWhatsAppText(ctx, fallback, 'orchestrator', `fallback:${ctx.requestId}`)
  } catch (error) {
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
