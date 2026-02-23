import { classifyMessage, explainMovement } from './ai.ts'
import { enqueueWhatsAppText } from './outbox.ts'
import { logError, logInfo } from './logger.ts'
import type { RequestContext } from './types.ts'

async function fetchHistorySummary(ctx: RequestContext, clienteId: string): Promise<string> {
  const { data } = await ctx.supabase
    .from('whatsapp_mensagens')
    .select('conteudo, direcao, timestamp')
    .eq('instancia_id', ctx.instanceId)
    .eq('remote_jid', `${ctx.phone}@s.whatsapp.net`)
    .order('timestamp', { ascending: false })
    .limit(8)

  const summary = (data ?? [])
    .reverse()
    .map((msg: any) => `${msg.direcao === 'in' ? 'cliente' : 'sistema'}: ${msg.conteudo}`)
    .join(' | ')

  return summary || `Cliente ${clienteId} sem histórico recente.`
}

async function fetchLastMovement(ctx: RequestContext, clienteId: string): Promise<string | null> {
  const { data } = await ctx.supabase
    .from('cliente_processos')
    .select('processo_id')
    .eq('cliente_id', clienteId)
    .limit(10)

  const processIds = (data ?? []).map((item: any) => item.processo_id)
  if (processIds.length === 0) return null

  const { data: movement } = await ctx.supabase
    .from('movimentacoes')
    .select('descricao, data_movimentacao')
    .in('processo_id', processIds)
    .order('data_movimentacao', { ascending: false })
    .limit(1)
    .maybeSingle()

  return movement?.descricao ?? null
}

async function registerEscalation(ctx: RequestContext, clienteId: string, reason: string, metadata: Record<string, unknown>) {
  await ctx.supabase.from('notificacoes').insert({
    user_id: ctx.tenantId,
    tipo: 'whatsapp_escalacao',
    titulo: `Escalação de atendimento (${reason})`,
    mensagem: `Cliente ${clienteId} solicitou apoio humano.`,
    link: '/atendimento',
    metadata,
  })
}

export async function handleIncomingMessage(ctx: RequestContext & { clienteId: string }) {
  try {
    const historySummary = await fetchHistorySummary(ctx, ctx.clienteId)
    const classification = await classifyMessage(ctx.message, historySummary)

    const shouldEscalate = classification.precisaEscalar || classification.confianca < 0.75

    logInfo('orchestrator_decision', {
      request_id: ctx.requestId,
      tenant_id: ctx.tenantId,
      telefone: ctx.phone,
      intencao: classification.intencao,
      confianca: classification.confianca,
      precisaEscalar: shouldEscalate,
    })

    if (classification.intencao === 'RECLAMACAO') {
      await registerEscalation(ctx, ctx.clienteId, 'RECLAMACAO', { classification })
      await enqueueWhatsAppText(ctx, 'Recebemos sua reclamação. Vamos encaminhar para um advogado responsável agora mesmo.', 'orchestrator', `reclamacao:${ctx.clienteId}:${ctx.message}`)
      return
    }

    if (classification.intencao === 'MARCAR_CONSULTORIA') {
      await registerEscalation(ctx, ctx.clienteId, 'MARCAR_CONSULTORIA', { classification })
      await enqueueWhatsAppText(ctx, 'Recebemos seu pedido de consultoria. Um atendente humano entrará em contato para agendamento.', 'orchestrator', `consultoria:${ctx.clienteId}:${ctx.message}`)
      return
    }

    if (classification.intencao === 'CONSULTAR_STATUS' && !shouldEscalate) {
      const movement = await fetchLastMovement(ctx, ctx.clienteId)
      if (!movement) {
        await enqueueWhatsAppText(ctx, 'No momento não encontramos nova movimentação relevante no seu processo.', 'orchestrator', `status_sem_movimento:${ctx.clienteId}`)
        return
      }

      const explanation = await explainMovement(movement)
      await enqueueWhatsAppText(ctx, explanation, 'orchestrator', `status_explanation:${ctx.clienteId}:${movement}`)
      return
    }

    if (shouldEscalate || classification.intencao === 'FALAR_COM_ADVOGADO') {
      await registerEscalation(ctx, ctx.clienteId, 'ESCALATION', { classification })
      await enqueueWhatsAppText(ctx, 'Vou encaminhar sua mensagem para um advogado do time seguir com você.', 'orchestrator', `escalation:${ctx.clienteId}:${ctx.message}`)
      return
    }

    await enqueueWhatsAppText(
      ctx,
      'Entendi sua mensagem. Posso ajudar com status do processo ou encaminhar para um advogado quando você preferir.',
      'orchestrator',
      `fallback_help:${ctx.clienteId}:${classification.intencao}`
    )
  } catch (error) {
    logError('orchestrator_failed', {
      request_id: ctx.requestId,
      tenant_id: ctx.tenantId,
      telefone: ctx.phone,
      error: String(error),
    })

    await enqueueWhatsAppText(
      ctx,
      'Tivemos uma instabilidade na IA. Já encaminhamos para atendimento humano continuar com você.',
      'orchestrator',
      `ai_fallback:${ctx.clienteId}:${ctx.requestId}`
    )

    await registerEscalation(ctx, ctx.clienteId, 'AI_FALLBACK', { error: String(error) })
  }
}
