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
    console.log(`[DEBUG-ORCH] fetchClienteInfo skip — clienteId="${clienteId}", returning generic info`)
    return { nome: 'Cliente', processos: [] }
  }

  console.log(`[DEBUG-ORCH] fetchClienteInfo start clienteId=${clienteId} tenantId=${ctx.tenantId}`)

  const { data: cliente, error: clienteError } = await ctx.supabase
    .from('clientes')
    .select('nome')
    .eq('id', clienteId)
    .eq('user_id', ctx.tenantId)
    .maybeSingle()

  console.log(`[DEBUG-ORCH] clientes query: nome=${cliente?.nome ?? 'NULL'} error=${clienteError?.message ?? 'none'}`)

  const nome = cliente?.nome ?? 'Cliente'

  const { data: bindings, error: bindingsError } = await ctx.supabase
    .from('cliente_processos')
    .select('processo_id')
    .eq('cliente_id', clienteId)
    .eq('status', 'ativo')

  console.log(`[DEBUG-ORCH] cliente_processos query: count=${bindings?.length ?? 0} error=${bindingsError?.message ?? 'none'}`)

  const processoIds = (bindings ?? []).map((b: any) => b.processo_id).filter(Boolean)

  if (processoIds.length === 0) {
    console.log(`[DEBUG-ORCH] no active processes found`)
    return { nome, processos: [] }
  }

  const { data: processosData, error: processosError } = await ctx.supabase
    .from('processos')
    .select('id, numero_cnj, tribunal, vara, classe, assunto, status, data_distribuicao')
    .eq('user_id', ctx.tenantId)
    .in('id', processoIds)

  console.log(`[DEBUG-ORCH] processos query: count=${processosData?.length ?? 0} error=${processosError?.message ?? 'none'}`)

  const processos: ProcessoInfo[] = []

  for (const proc of processosData ?? []) {
    const { data: movs } = await ctx.supabase
      .from('movimentacoes')
      .select('descricao, data_movimentacao')
      .eq('processo_id', proc.id)
      .order('data_movimentacao', { ascending: false })
      .limit(5)

    console.log(`[DEBUG-ORCH] movimentacoes for ${proc.numero_cnj}: count=${movs?.length ?? 0}`)

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

export async function handleIncomingMessage(ctx: RequestContext & { clienteId: string }) {
  try {
    console.log(`[DEBUG-ORCH] handleIncomingMessage start clienteId=${ctx.clienteId} phone=${ctx.phone} msg="${ctx.message.slice(0, 30)}"`)

    const { data: recentLogs, error: logsError } = await ctx.supabase
      .from('conversation_logs')
      .select('direction, message')
      .eq('tenant_id', ctx.tenantId)
      .eq('phone_number', ctx.phone)
      .order('created_at', { ascending: false })
      .limit(6)

    console.log(`[DEBUG-ORCH] conversation_logs: count=${recentLogs?.length ?? 0} error=${logsError?.message ?? 'none'}`)

    await logConversation(ctx, 'inbound', ctx.message)

    const history = (recentLogs ?? []).reverse()
    const contextLines = history.map((l: any) => `${l.direction === 'inbound' ? 'Cliente' : 'Bot'}: ${l.message}`).join('\n')
    const intentInput = history.length > 0 ? `${contextLines}\nCliente: ${ctx.message}` : ctx.message

    console.log(`[DEBUG-ORCH] calling classifyIntent...`)
    const intentStart = Date.now()
    const intent = await classifyIntent(intentInput)
    console.log(`[DEBUG-ORCH] classifyIntent result="${intent}" took=${Date.now() - intentStart}ms`)

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
      console.log(`[DEBUG-ORCH] enqueuing OPT_OUT response`)
      await enqueueWhatsAppText(ctx, text, 'orchestrator', `opt_out:${ctx.clienteId}:${ctx.requestId}`)
      console.log(`[DEBUG-ORCH] OPT_OUT enqueued OK`)
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
      console.log(`[DEBUG-ORCH] enqueuing HUMAN_SUPPORT response`)
      await enqueueWhatsAppText(ctx, text, 'orchestrator', `human_support:${ctx.clienteId}:${ctx.requestId}`)
      console.log(`[DEBUG-ORCH] HUMAN_SUPPORT enqueued OK`)
      return
    }

    if (intent === 'NEW_CLIENT') {
      const text = 'Obrigado pelo contato! Vou registrar seu interesse e nossa equipe entrará em contato para o atendimento inicial.'
      await registerEscalation(ctx, ctx.clienteId, 'NEW_CLIENT', { intent })
      console.log(`[DEBUG-ORCH] enqueuing NEW_CLIENT response`)
      await enqueueWhatsAppText(ctx, text, 'orchestrator', `new_client:${ctx.requestId}`)
      console.log(`[DEBUG-ORCH] NEW_CLIENT enqueued OK`)
      return
    }

    console.log(`[DEBUG-ORCH] calling fetchClienteInfo for clienteId=${ctx.clienteId}`)
    const fetchStart = Date.now()
    const clienteInfo = await fetchClienteInfo(ctx, ctx.clienteId)
    console.log(`[DEBUG-ORCH] fetchClienteInfo done: nome="${clienteInfo.nome}" processos=${clienteInfo.processos.length} took=${Date.now() - fetchStart}ms`)

    console.log(`[DEBUG-ORCH] calling generateContextualResponse...`)
    const genStart = Date.now()
    const response = await generateContextualResponse(clienteInfo, ctx.message, contextLines, intent)
    console.log(`[DEBUG-ORCH] generateContextualResponse done: responseLen=${response.length} took=${Date.now() - genStart}ms`)

    console.log(`[DEBUG-ORCH] enqueuing contextual response`)
    await enqueueWhatsAppText(ctx, response, 'orchestrator', `contextual:${ctx.clienteId}:${ctx.requestId}`)
    console.log(`[DEBUG-ORCH] contextual response enqueued OK`)
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
