import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { tenantWriteGuard } from '../_shared/tenant-guard.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const BATCH_SIZE = Number(Deno.env.get('CAMPAIGN_BATCH_SIZE') ?? '100')
const EVOLUTION_API_URL = Deno.env.get('EVOLUTION_API_URL')!
const EVOLUTION_API_KEY = Deno.env.get('EVOLUTION_API_KEY')!

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  // deno-lint-ignore no-explicit-any
  const svc = createClient<any>(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const body = await req.json().catch(() => ({})) as { action?: string; campaign_job_id?: string }

  if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY) {
    return new Response(JSON.stringify({ error: 'evolution_not_configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (body.action === 'cancel' && body.campaign_job_id) {
    const { data: job } = await svc.from('campaign_jobs').select('id,tenant_id').eq('id', body.campaign_job_id).maybeSingle()
    if (!job) return new Response(JSON.stringify({ cancelled: 0 }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    await tenantWriteGuard({ supabase: svc, tenantIdFromContext: job.tenant_id, resourceId: job.id, resourceTable: 'campaign_jobs' })

    const { data: cancelledRows, error: cancelError } = await svc
      .from('campaign_recipients')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('campaign_job_id', body.campaign_job_id)
      .in('status', ['pending', 'queued', 'processing'])
      .select('id')

    if (cancelError) {
      return new Response(JSON.stringify({ error: cancelError.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    await svc.from('campaign_jobs')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('id', body.campaign_job_id)
      .in('status', ['pending', 'running', 'paused'])

    return new Response(JSON.stringify({ cancelled: cancelledRows?.length ?? 0 }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  let jobsQuery = svc
    .from('campaign_jobs')
    .select('id,status,instance_id,tenant_id')
    .in('status', ['pending', 'running'])
    .order('created_at', { ascending: true })
    .limit(20)

  if (body.campaign_job_id) {
    jobsQuery = jobsQuery.eq('id', body.campaign_job_id)
  }

  const { data: jobs, error: jobsError } = await jobsQuery
  console.log(`[campaign] Found ${jobs?.length ?? 0} jobs, filter: campaign_job_id=${body.campaign_job_id ?? 'all'}`)

  if (jobsError) {
    console.error('[campaign] jobsError:', jobsError.message)
    return new Response(JSON.stringify({ error: jobsError.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const processed: Array<Record<string, unknown>> = []

  for (const job of jobs ?? []) {
    const { data: recipients, error: recipientsError } = await svc
      .from('campaign_recipients')
      .select('id,tenant_id,campaign_job_id,destination,reference,payload,status,outbox_id,sent_at')
      .eq('campaign_job_id', job.id)
      .is('sent_at', null)
      .in('status', ['pending', 'queued'])
      .order('created_at', { ascending: true })
      .limit(BATCH_SIZE)

    console.log(`[campaign] Job ${job.id}: ${recipients?.length ?? 0} recipients to process`)

    if (recipientsError) {
      console.error(`[campaign] recipientsError for job ${job.id}:`, recipientsError.message)
      processed.push({ campaign_job_id: job.id, status: 'recipients_query_error', error: recipientsError.message })
      continue
    }

    for (const recipient of recipients ?? []) {
      const { data: claimRow, error: claimError } = await svc
        .from('campaign_recipients')
        .update({ status: 'processing', updated_at: new Date().toISOString() })
        .eq('id', recipient.id)
        .is('sent_at', null)
        .in('status', ['pending', 'queued'])
        .select('id')
        .maybeSingle()

      if (claimError || !claimRow) {
        processed.push({ recipient_id: recipient.id, status: 'already_claimed' })
        continue
      }

      const payload = recipient.payload as Record<string, unknown>
      const messageText = String(payload.messageText ?? payload.message ?? '')
      const destinationNumber = String(recipient.destination).replace(/\D/g, '')
      const instanceName = String(payload.instanceName ?? '')

      if (!instanceName || !messageText || !destinationNumber) {
        await svc.from('campaign_recipients')
          .update({ status: 'failed', last_error: 'invalid_campaign_payload', updated_at: new Date().toISOString() })
          .eq('id', recipient.id)
          .eq('status', 'processing')
        processed.push({ recipient_id: recipient.id, status: 'failed_invalid_payload' })
        continue
      }

      await tenantWriteGuard({ supabase: svc, tenantIdFromContext: recipient.tenant_id, resourceId: recipient.id, resourceTable: 'campaign_recipients' })

      const evoRes = await fetch(`${EVOLUTION_API_URL}/message/sendText/${instanceName}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': EVOLUTION_API_KEY,
        },
        body: JSON.stringify({ number: destinationNumber, text: messageText }),
      })

      const evoRawBody = await evoRes.text()
      let evoData: Record<string, unknown> = {}
      try { evoData = JSON.parse(evoRawBody) } catch { evoData = {} }

      if (!evoRes.ok) {
        console.error(`[campaign] Evolution API error for ${recipient.id}: HTTP ${evoRes.status}`, evoRawBody)
        await svc.from('campaign_recipients')
          .update({
            status: 'failed',
            last_error: String((evoData as any)?.error || (evoData as any)?.message || `evolution_http_${evoRes.status}`),
            updated_at: new Date().toISOString(),
          })
          .eq('id', recipient.id)
          .eq('status', 'processing')

        processed.push({ recipient_id: recipient.id, status: 'failed', http_status: evoRes.status })
        continue
      }

      const providerMessageId = String((evoData as any)?.key?.id || (evoData as any)?.message?.id || crypto.randomUUID())
      const remoteJid = `${destinationNumber}@s.whatsapp.net`

      await svc.from('campaign_recipients')
        .update({ status: 'sent', sent_at: new Date().toISOString(), updated_at: new Date().toISOString(), last_error: null })
        .eq('id', recipient.id)
        .eq('status', 'processing')

      if (recipient.outbox_id) {
        await svc.from('message_outbox')
          .update({ status: 'dead_letter', dead_lettered_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('id', recipient.outbox_id)
          .in('status', ['pending', 'retry', 'sending', 'accepted'])
      }

      await svc.from('campaign_jobs')
        .update({ status: 'running', started_at: new Date().toISOString() })
        .eq('id', recipient.campaign_job_id)
        .in('status', ['pending', 'running'])

      await svc.from('whatsapp_mensagens').insert({
        instancia_id: job.instance_id,
        remote_jid: remoteJid,
        direcao: 'out',
        conteudo: messageText,
        tipo: 'text',
        message_id: providerMessageId,
      })

      await svc.from('whatsapp_chats_cache').upsert({
        instancia_id: job.instance_id,
        remote_jid: remoteJid,
        ultima_mensagem: messageText.substring(0, 100),
        ultimo_timestamp: new Date().toISOString(),
        direcao: 'out',
      }, { onConflict: 'instancia_id,remote_jid', ignoreDuplicates: false })

      console.log(`[campaign] Sent to ${destinationNumber} via ${instanceName}, msgId=${providerMessageId}`)
      processed.push({ recipient_id: recipient.id, status: 'sent' })
    }
  }

  for (const job of jobs ?? []) {
    const { count: openRecipients, error: openRecipientsError } = await svc
      .from('campaign_recipients')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_job_id', job.id)
      .in('status', ['pending', 'queued', 'processing'])

    if (openRecipientsError) continue

    if ((openRecipients ?? 0) === 0 && (job.status === 'pending' || job.status === 'running')) {
      await svc.from('campaign_jobs')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', job.id)
        .in('status', ['pending', 'running'])
    }
  }

  return new Response(JSON.stringify({ processed: processed.length, rows: processed }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
