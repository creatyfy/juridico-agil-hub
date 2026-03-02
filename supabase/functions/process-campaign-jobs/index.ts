import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { enqueueMessage } from '../_shared/message-outbox-enqueue.ts'
import { tenantWriteGuard } from '../_shared/tenant-guard.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const BATCH_SIZE = Number(Deno.env.get('CAMPAIGN_BATCH_SIZE') ?? '100')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  // deno-lint-ignore no-explicit-any
  const svc = createClient<any>(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const body = await req.json().catch(() => ({})) as { action?: string; campaign_job_id?: string }

  if (body.action === 'cancel' && body.campaign_job_id) {
    const { data: job } = await svc.from('campaign_jobs').select('id,tenant_id').eq('id', body.campaign_job_id).maybeSingle()
    if (!job) return new Response(JSON.stringify({ cancelled: 0 }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    await tenantWriteGuard({ supabase: svc, tenantIdFromContext: job.tenant_id, resourceId: job.id, resourceTable: 'campaign_jobs' })
    const { data: cancelled } = await svc.rpc('cancel_campaign_recipients', { p_campaign_job_id: body.campaign_job_id })
    await svc.from('campaign_jobs').update({ status: 'cancelled', cancelled_at: new Date().toISOString() }).eq('id', body.campaign_job_id).in('status', ['pending', 'running', 'paused'])
    return new Response(JSON.stringify({ cancelled: cancelled ?? 0 }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  const { data: jobs } = await svc
    .from('campaign_jobs')
    .select('id,status,instance_id,tenant_id')
    .in('status', ['pending', 'running'])
    .order('created_at', { ascending: true })
    .limit(20)

  const processed: Array<Record<string, unknown>> = []

  for (const job of jobs ?? []) {
    const { data: recipients } = await svc.rpc('claim_campaign_recipients', {
      p_campaign_job_id: job.id,
      p_limit: BATCH_SIZE,
    })

    for (const recipient of recipients ?? []) {
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

      await tenantWriteGuard({ supabase: svc, tenantIdFromContext: recipient.tenant_id, resourceId: recipient.id, resourceTable: 'campaign_recipients' })

      if (enqueue.ok && enqueue.outboxId) {
        await svc.from('campaign_recipients').update({ outbox_id: enqueue.outboxId, updated_at: new Date().toISOString() }).eq('id', recipient.id).eq('status', 'queued')
        await svc.from('campaign_jobs').update({ status: 'running', started_at: new Date().toISOString() }).eq('id', recipient.campaign_job_id).in('status', ['pending', 'running'])
      } else {
        await svc.from('campaign_recipients').update({ status: 'failed', last_error: enqueue.reason ?? enqueue.status, updated_at: new Date().toISOString() }).eq('id', recipient.id).eq('status', 'queued')
      }

      processed.push({ recipient_id: recipient.id, status: enqueue.status })
    }
  }

  await svc.rpc('finalize_completed_campaign_jobs')

  return new Response(JSON.stringify({ processed: processed.length, rows: processed }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
