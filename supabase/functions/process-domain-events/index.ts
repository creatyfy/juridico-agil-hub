import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { enqueueMessage } from '../_shared/message-outbox-enqueue.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
}

const BATCH_SIZE = Number(Deno.env.get('DOMAIN_EVENTS_BATCH_SIZE') ?? '30')
const LEASE_SECONDS = Number(Deno.env.get('DOMAIN_EVENTS_LEASE_SECONDS') ?? '45')
const MAX_ATTEMPTS = Number(Deno.env.get('DOMAIN_EVENTS_MAX_ATTEMPTS') ?? '6')

function backoffMs(attempts: number): number {
  return Math.min(120_000, 1500 * 2 ** Math.max(attempts - 1, 0))
}

async function processMovementDetected(svc: ReturnType<typeof createClient>, event: any): Promise<void> {
  const payload = event.payload ?? {}
  const processoId = payload.processo_id as string | undefined
  const resumo = (payload.resumo as string | undefined) ?? 'Nova movimentação processual detectada.'

  if (!processoId) throw new Error('missing_processo_id')

  const { data: processo } = await svc
    .from('processos')
    .select('id, numero_cnj, user_id')
    .eq('id', processoId)
    .maybeSingle()

  if (!processo) throw new Error('process_not_found')

  await svc.from('notificacoes').insert({
    user_id: processo.user_id,
    tipo: 'movimentacao',
    titulo: 'Nova movimentação processual',
    mensagem: `Processo ${processo.numero_cnj} recebeu uma atualização.`,
    link: `/processos/${processo.id}`,
    metadata: { event_id: event.id, resumo },
  })

  const { data: linkedClients } = await svc
    .from('cliente_processos')
    .select('clientes(id, nome, numero_whatsapp, status_vinculo), advogado_user_id')
    .eq('processo_id', processo.id)
    .eq('status', 'ativo')

  const { data: instance } = await svc
    .from('whatsapp_instancias')
    .select('id, instance_name')
    .eq('user_id', processo.user_id)
    .eq('status', 'connected')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!instance) return

  for (const binding of linkedClients ?? []) {
    const cliente = (binding as any).clientes
    if (!cliente?.numero_whatsapp || cliente.status_vinculo !== 'ativo') continue

    const destination = String(cliente.numero_whatsapp).replace(/\D/g, '')
    const reference = `movement:${event.id}:${cliente.id}`

    await enqueueMessage({
      supabase: svc,
      tenantId: processo.user_id,
      destination,
      event: 'process_update',
      reference,
      aggregateType: 'processo',
      aggregateId: processo.id,
      payload: {
        kind: 'process_update',
        processoId: processo.id,
        processoNumero: processo.numero_cnj,
        clienteNome: cliente.nome,
        destinationNumber: destination,
        messageText: `Atualização do processo ${processo.numero_cnj}: ${resumo}`,
        instanceName: instance.instance_name,
        instanceId: instance.id,
        userId: processo.user_id,
      },
    })
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const workerId = `${Deno.env.get('DENO_DEPLOYMENT_ID') ?? 'local'}:${req.headers.get('x-request-id') ?? crypto.randomUUID()}`

  const { data: events, error: claimError } = await svc.rpc('claim_domain_events', {
    p_worker_id: workerId,
    p_batch_size: BATCH_SIZE,
    p_lease_seconds: LEASE_SECONDS,
    p_event_types: ['PROCESS_MOVEMENT_DETECTED'],
  })

  if (claimError) {
    return new Response(JSON.stringify({ error: claimError.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  const processed: Array<Record<string, unknown>> = []

  for (const event of events ?? []) {
    const startedAt = Date.now()
    try {
      if (event.event_type === 'PROCESS_MOVEMENT_DETECTED') {
        await processMovementDetected(svc, event)
      }

      const { data: ok } = await svc.rpc('complete_domain_event', {
        p_event_id: event.id,
        p_worker_id: workerId,
        p_lease_version: event.lease_version,
      })

      await svc.rpc('record_worker_metric', {
        p_worker_name: 'process-domain-events',
        p_event_id: event.id,
        p_tenant_id: event.tenant_id,
        p_event_type: event.event_type,
        p_status: ok ? 'processed' : 'lease_lost',
        p_retries: Number(event.attempts ?? 0),
        p_processing_ms: Date.now() - startedAt,
      })

      processed.push({ id: event.id, status: ok ? 'processed' : 'lease_lost' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const attempts = Number(event.attempts ?? 1)
      const shouldDeadLetter = attempts >= MAX_ATTEMPTS

      if (shouldDeadLetter) {
        await svc.rpc('dead_letter_domain_event', {
          p_event_id: event.id,
          p_worker_id: workerId,
          p_lease_version: event.lease_version,
          p_error: message,
        })
      } else {
        await svc.rpc('reschedule_domain_event_retry', {
          p_event_id: event.id,
          p_worker_id: workerId,
          p_lease_version: event.lease_version,
          p_next_retry_at: new Date(Date.now() + backoffMs(attempts)).toISOString(),
          p_error: message,
        })
      }

      await svc.rpc('record_worker_metric', {
        p_worker_name: 'process-domain-events',
        p_event_id: event.id,
        p_tenant_id: event.tenant_id,
        p_event_type: event.event_type,
        p_status: shouldDeadLetter ? 'dead_letter' : 'retry',
        p_retries: attempts,
        p_processing_ms: Date.now() - startedAt,
        p_error_code: message.slice(0, 120),
      })

      processed.push({ id: event.id, status: shouldDeadLetter ? 'dead_letter' : 'retry' })
    }
  }

  return new Response(JSON.stringify({ workerId, claimed: events?.length ?? 0, processed }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
