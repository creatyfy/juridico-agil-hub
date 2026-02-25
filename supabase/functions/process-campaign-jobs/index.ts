import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { enqueueMessage } from '../_shared/message-outbox-enqueue.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const BATCH_SIZE = Number(Deno.env.get('CAMPAIGN_BATCH_SIZE') ?? '100')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { data: recipients } = await svc
    .from('campaign_recipients')
    .select('id,campaign_job_id,tenant_id,destination,reference,payload,campaign_jobs!inner(id,status,instance_id)')
    .eq('status', 'pending')
    .in('campaign_jobs.status', ['pending', 'running'])
    .limit(BATCH_SIZE)

  const processed: Array<Record<string, unknown>> = []

  for (const recipient of recipients ?? []) {
    const job = Array.isArray(recipient.campaign_jobs) ? recipient.campaign_jobs[0] : recipient.campaign_jobs
    if (!job || (job.status !== 'pending' && job.status !== 'running')) continue

    const payload = recipient.payload as Record<string, unknown>
    const messageText = String(payload.messageText ?? payload.message ?? '')

    const enqueue = await enqueueMessage({
      supabase: svc,
      tenantId: recipient.tenant_id,
      destination: recipient.destination,
      reference: recipient.reference,
      event: 'campaign_message',
      aggregateType: 'campaign_job',
      aggregateId: recipient.campaign_job_id,
      campaignJobId: recipient.campaign_job_id,
      payload: {
        kind: 'campaign_message',
        destinationNumber: recipient.destination,
        messageText,
        instanceId: job.instance_id,
        instanceName: String(payload.instanceName ?? ''),
        userId: recipient.tenant_id,
      },
    })

    if (enqueue.ok && enqueue.outboxId) {
      await svc.from('campaign_recipients').update({ status: 'queued', outbox_id: enqueue.outboxId }).eq('id', recipient.id)
      await svc.from('campaign_jobs').update({ status: 'running', started_at: new Date().toISOString() }).eq('id', recipient.campaign_job_id)
    }

    if (!enqueue.ok) {
      await svc.from('campaign_recipients').update({ status: 'failed', last_error: enqueue.reason ?? enqueue.status }).eq('id', recipient.id)
    }

    processed.push({ recipient_id: recipient.id, status: enqueue.status })
  }

  await svc.rpc('finalize_completed_campaign_jobs')

  return new Response(JSON.stringify({ processed: processed.length, rows: processed }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
