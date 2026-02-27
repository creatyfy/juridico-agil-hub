import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { handleAuthenticationFlow, isPhoneVerified } from '../webhook-whatsapp/services/auth.ts'
import { handleIncomingMessage } from '../webhook-whatsapp/services/orchestrator.ts'
import { logError, logInfo } from '../webhook-whatsapp/services/logger.ts'
import type { RequestContext } from '../webhook-whatsapp/services/types.ts'

type ClaimedInbound = {
  queue_id: string
  inbound_message_id: string
  tenant_id: string
  instance_id: string
  instance_name: string
  provider_message_id: string
  lease_version: number
  fencing_token: number
  attempts: number
}

type PlainInbound = {
  phone: string
  message: string
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-request-id',
}

const BATCH_SIZE = Number(Deno.env.get('INBOUND_BATCH_SIZE') ?? '25')
const LEASE_SECONDS = Number(Deno.env.get('INBOUND_LEASE_SECONDS') ?? '45')
const MAX_ATTEMPTS = Number(Deno.env.get('INBOUND_MAX_ATTEMPTS') ?? '8')

function buildWorkerId(req: Request): string {
  const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID()
  return `${Deno.env.get('DENO_DEPLOYMENT_ID') ?? 'local'}:inbound:${requestId}`
}

function retryDelayMs(attempts: number): number {
  const base = Math.min(60000, 1000 * 2 ** Math.min(attempts, 6))
  const jitter = Math.floor(Math.random() * 500)
  return base + jitter
}

async function markRetry(params: {
  supabase: ReturnType<typeof createClient>
  row: ClaimedInbound
  workerId: string
  error: string
}) {
  const nextRetryAt = new Date(Date.now() + retryDelayMs(params.row.attempts)).toISOString()
  await params.supabase.rpc('retry_inbound_queue', {
    p_queue_id: params.row.queue_id,
    p_worker_id: params.workerId,
    p_lease_version: params.row.lease_version,
    p_fencing_token: params.row.fencing_token,
    p_next_retry_at: nextRetryAt,
    p_error: params.error,
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const workerId = buildWorkerId(req)

  const { data, error } = await supabase.rpc('claim_inbound_queue', {
    p_batch_size: BATCH_SIZE,
    p_worker_id: workerId,
    p_lease_seconds: LEASE_SECONDS,
  })

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const claimedRows = (data ?? []) as ClaimedInbound[]
  const processed: Array<Record<string, unknown>> = []

  for (const row of claimedRows) {
    try {
      const { data: plainData, error: plainError } = await supabase.rpc('get_inbound_message_plaintext', {
        p_inbound_message_id: row.inbound_message_id,
      })

      if (plainError || !plainData?.[0]) {
        await markRetry({
          supabase,
          row,
          workerId,
          error: plainError?.message ?? 'inbound_plaintext_not_found',
        })
        processed.push({ queue_id: row.queue_id, status: 'retry_plaintext' })
        continue
      }

      const plain = plainData[0] as PlainInbound
      const ctx: RequestContext = {
        requestId: row.queue_id,
        supabase,
        tenantId: row.tenant_id,
        instanceId: row.instance_id,
        instanceName: row.instance_name,
        phone: plain.phone,
        message: plain.message,
      }

      const verified = await isPhoneVerified(ctx)
      if (!verified.verified) {
        const authResult = await handleAuthenticationFlow(ctx)
        if (authResult.authenticated && authResult.clienteId) {
          await handleIncomingMessage({ ...ctx, clienteId: authResult.clienteId })
        }
      } else if (verified.clienteId) {
        await handleIncomingMessage({ ...ctx, clienteId: verified.clienteId })
      } else {
        throw new Error('verified_without_cliente')
      }

      const { data: completed } = await supabase.rpc('complete_inbound_queue', {
        p_queue_id: row.queue_id,
        p_worker_id: workerId,
        p_lease_version: row.lease_version,
        p_fencing_token: row.fencing_token,
      })

      processed.push({
        queue_id: row.queue_id,
        provider_message_id: row.provider_message_id,
        status: completed ? 'completed' : 'lease_lost',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)

      logError('inbound_worker_message_failed', {
        queue_id: row.queue_id,
        tenant_id: row.tenant_id,
        instance_id: row.instance_id,
        provider_message_id: row.provider_message_id,
        error: message,
      })

      if (row.attempts >= MAX_ATTEMPTS) {
        await supabase.rpc('fail_inbound_queue', {
          p_queue_id: row.queue_id,
          p_worker_id: workerId,
          p_lease_version: row.lease_version,
          p_fencing_token: row.fencing_token,
          p_error: message,
        })
        processed.push({ queue_id: row.queue_id, status: 'dead_letter' })
        continue
      }

      await markRetry({ supabase, row, workerId, error: message })
      processed.push({ queue_id: row.queue_id, status: 'retry' })
    }
  }

  logInfo('inbound_worker_cycle', {
    worker_id: workerId,
    claimed: claimedRows.length,
    processed: processed.length,
  })

  return new Response(JSON.stringify({ ok: true, worker_id: workerId, claimed: claimedRows.length, processed }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
