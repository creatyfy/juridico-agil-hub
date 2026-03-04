// @ts-nocheck - Deno edge function
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { enqueueMessage } from '../_shared/message-outbox-enqueue.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Processos sem movimentação há mais de N dias recebem lembrete.
const DAYS_WITHOUT_MOVEMENT = Number(Deno.env.get('PROACTIVE_REMINDER_DAYS') ?? '7')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  // Busca todos os processos monitorados com cliente + WhatsApp verificado
  // cuja última movimentação (ou data de cadastro do processo) passou o limiar de dias
  // e cujo contato não recebeu notificação recente.
  const cutoff = new Date(Date.now() - DAYS_WITHOUT_MOVEMENT * 24 * 60 * 60 * 1000).toISOString()

  const { data: candidates, error: queryError } = await svc.rpc('get_proactive_reminder_candidates', {
    p_cutoff: cutoff,
  })

  if (queryError) {
    console.error(JSON.stringify({ level: 'error', event: 'proactive_reminders_query_failed', error: queryError.message }))
    return new Response(JSON.stringify({ ok: false, error: queryError.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const results: Array<Record<string, unknown>> = []

  for (const row of candidates ?? []) {
    const messageText =
      `Olá, ${row.cliente_nome}! 👋\n\n` +
      `Passamos para informar que seu processo *${row.numero_cnj}* segue em andamento.\n\n` +
      `Não há novas movimentações registradas até o momento — assim que houver qualquer ` +
      `atualização, você será notificado imediatamente aqui.\n\n` +
      `Qualquer dúvida, pode responder esta mensagem. ⚖️\n\n` +
      `_Mensagem automática – ${row.escritorio_nome ?? 'Escritório de Advocacia'}_`

    const phone = String(row.phone_number).startsWith('55')
      ? String(row.phone_number)
      : `55${row.phone_number}`

    const enqueue = await enqueueMessage({
      supabase: svc,
      tenantId: row.tenant_id,
      destination: phone,
      reference: `proactive:${row.processo_id}:${row.contact_id}:${cutoff.slice(0, 10)}`,
      event: 'proactive_reminder',
      aggregateType: 'processo',
      aggregateId: row.processo_id,
      payload: {
        kind: 'proactive_reminder',
        processoId: row.processo_id,
        processoNumero: row.numero_cnj,
        clienteNome: row.cliente_nome,
        destinationNumber: phone,
        messageText,
        instanceId: row.instance_id,
        instanceName: row.instance_name,
        userId: row.tenant_id,
      },
    })

    if (enqueue.ok) {
      // Atualiza last_notification_sent_at para evitar reenvio antes do próximo ciclo
      await svc
        .from('whatsapp_contacts')
        .update({ last_notification_sent_at: new Date().toISOString() })
        .eq('id', row.contact_id)
    }

    results.push({
      processo_id: row.processo_id,
      contact_id: row.contact_id,
      status: enqueue.status,
      ok: enqueue.ok,
    })
  }

  const sent = results.filter((r) => r.status === 'queued').length
  const skipped = results.filter((r) => r.status === 'duplicate').length

  console.log(JSON.stringify({
    level: 'info',
    event: 'proactive_reminders_done',
    candidates: candidates?.length ?? 0,
    sent,
    skipped,
  }))

  return new Response(
    JSON.stringify({ ok: true, candidates: candidates?.length ?? 0, sent, skipped, results }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
})
