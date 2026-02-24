import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendNotification, type NotificationRow } from '../_shared/whatsapp-adapter.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const MAX_RETRIES = Number(Deno.env.get('NOTIFICATIONS_MAX_RETRIES') ?? '3')

function buildWorkerId(req: Request): string {
  const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID()
  return `${Deno.env.get('DENO_DEPLOYMENT_ID') ?? 'local'}:${requestId}`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const workerId = buildWorkerId(req)
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const body = await req.json().catch(() => ({}))
  const batchSize = Number(body.batch_size ?? Deno.env.get('NOTIFICATIONS_BATCH_SIZE') ?? 100)
  const safeBatchSize = Number.isFinite(batchSize) ? Math.max(1, Math.trunc(batchSize)) : 100

  const { data: notifications, error: pendingError } = await supabase
    .from('notifications')
    .select('id, tenant_id, process_id, retry_count, type, status')
    .eq('status', 'pending')
    .lt('retry_count', MAX_RETRIES)
    .order('created_at', { ascending: true })
    .limit(safeBatchSize)

  if (pendingError) {
    return new Response(JSON.stringify({ error: pendingError.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  let sentTotal = 0
  let failedTotal = 0
  const processed: Array<Record<string, unknown>> = []

  for (const row of notifications ?? []) {
    const notification = row as NotificationRow

    try {
      console.log(JSON.stringify({
        level: 'info',
        event: 'notifications_processing_started',
        worker_id: workerId,
        notification_id: notification.id,
        tenant_id: notification.tenant_id,
        process_id: notification.process_id,
        retry_count: notification.retry_count,
      }))

      const adapterResult = await sendNotification(supabase, notification)

      const { error: sentError } = await supabase
        .from('notifications')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          error_message: null,
        })
        .eq('id', notification.id)
        .eq('status', 'pending')

      if (sentError) {
        throw new Error(`notification_update_sent_error:${sentError.message}`)
      }

      await supabase
        .from('processos')
        .update({
          last_notified_at: new Date().toISOString(),
          notification_pending: false,
        })
        .eq('id', notification.process_id)

      sentTotal += 1
      processed.push({
        id: notification.id,
        status: 'sent',
        provider_message_id: adapterResult.providerMessageId,
      })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      const nextRetryCount = Number(notification.retry_count ?? 0) + 1

      await supabase
        .from('notifications')
        .update({
          status: 'failed',
          retry_count: nextRetryCount,
          error_message: errorMessage,
        })
        .eq('id', notification.id)
        .eq('status', 'pending')

      console.error(JSON.stringify({
        level: 'error',
        event: 'notifications_processing_failed',
        worker_id: workerId,
        notification_id: notification.id,
        tenant_id: notification.tenant_id,
        process_id: notification.process_id,
        retry_count: nextRetryCount,
        max_retries: MAX_RETRIES,
        error_message: errorMessage,
      }))

      failedTotal += 1
      processed.push({ id: notification.id, status: 'failed', retry_count: nextRetryCount, error: errorMessage })
    }
  }

  return new Response(JSON.stringify({
    success: true,
    worker: 'process-pending-notifications',
    workerId,
    result: {
      processed_total: sentTotal + failedTotal,
      sent_total: sentTotal,
      failed_total: failedTotal,
    },
    processed,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
