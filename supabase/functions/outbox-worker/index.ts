import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { computeBackoffWithJitterMs, maskSensitive, shouldRetryStatus, type OutboxPayload } from '../_shared/outbox.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const EVOLUTION_API_URL = Deno.env.get('EVOLUTION_API_URL')!
const EVOLUTION_API_KEY = Deno.env.get('EVOLUTION_API_KEY')!
const MAX_ATTEMPTS = Number(Deno.env.get('OUTBOX_MAX_ATTEMPTS') ?? '8')
const BATCH_SIZE = Number(Deno.env.get('OUTBOX_BATCH_SIZE') ?? '20')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: rows, error: claimError } = await svc.rpc('claim_message_outbox', { batch_size: BATCH_SIZE })

  if (claimError) {
    return new Response(JSON.stringify({ error: claimError.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  const processed: Array<Record<string, unknown>> = []

  for (const row of rows ?? []) {
    const payload = row.payload as OutboxPayload

    const tenantAllowed = await svc.rpc('consume_rate_limit_tokens', {
      p_tenant_id: row.tenant_id,
      p_scope_type: 'tenant',
      p_scope_key: row.tenant_id,
      p_capacity: Number(Deno.env.get('TENANT_BUCKET_CAPACITY') ?? '30'),
      p_refill_per_second: Number(Deno.env.get('TENANT_BUCKET_REFILL_PER_SECOND') ?? '1'),
      p_amount: 1,
    })
    const instanceAllowed = await svc.rpc('consume_rate_limit_tokens', {
      p_tenant_id: row.tenant_id,
      p_scope_type: 'instance',
      p_scope_key: payload.instanceId,
      p_capacity: Number(Deno.env.get('INSTANCE_BUCKET_CAPACITY') ?? '10'),
      p_refill_per_second: Number(Deno.env.get('INSTANCE_BUCKET_REFILL_PER_SECOND') ?? '0.5'),
      p_amount: 1,
    })

    if (!tenantAllowed.data || !instanceAllowed.data) {
      const backoff = computeBackoffWithJitterMs(row.attempts)
      await svc.from('message_outbox').update({
        status: 'retry',
        next_retry_at: new Date(Date.now() + backoff).toISOString(),
        last_error: 'rate_limit_blocked',
      }).eq('id', row.id)
      processed.push({ id: row.id, status: 'retry_rate_limit' })
      continue
    }

    try {
      const response = await fetch(`${EVOLUTION_API_URL}/message/sendText/${payload.instanceName}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': EVOLUTION_API_KEY,
        },
        body: JSON.stringify({ number: payload.destinationNumber, text: payload.messageText }),
      })

      const evoData = await response.json().catch(() => ({}))

      if (!response.ok) {
        if (shouldRetryStatus(response.status) && row.attempts < MAX_ATTEMPTS) {
          const backoff = computeBackoffWithJitterMs(row.attempts)
          await svc.from('message_outbox').update({
            status: 'retry',
            next_retry_at: new Date(Date.now() + backoff).toISOString(),
            last_error: `http_${response.status}`,
          }).eq('id', row.id)
          processed.push({ id: row.id, status: 'retry_http', http: response.status })
          continue
        }

        await svc.from('message_outbox').update({
          status: row.attempts >= MAX_ATTEMPTS ? 'dead_letter' : 'failed',
          last_error: `http_${response.status}`,
        }).eq('id', row.id)
        processed.push({ id: row.id, status: 'failed_http', http: response.status })
        continue
      }

      const remoteJid = `${payload.destinationNumber}@s.whatsapp.net`

      await svc.from('whatsapp_mensagens').insert({
        instancia_id: payload.instanceId,
        remote_jid: remoteJid,
        direcao: 'out',
        conteudo: payload.messageText,
        tipo: 'text',
        message_id: evoData?.key?.id || crypto.randomUUID(),
      })

      await svc.from('whatsapp_chats_cache').upsert({
        instancia_id: payload.instanceId,
        remote_jid: remoteJid,
        ultima_mensagem: payload.messageText.substring(0, 100),
        ultimo_timestamp: new Date().toISOString(),
        direcao: 'out',
      }, { onConflict: 'instancia_id,remote_jid', ignoreDuplicates: false })

      await svc.from('message_outbox').update({
        status: 'sent',
        next_retry_at: null,
        last_error: null,
      }).eq('id', row.id)

      processed.push({ id: row.id, status: 'sent', to: maskSensitive(payload.destinationNumber) })
    } catch (error) {
      const attempt = Number(row.attempts ?? 1)
      if (attempt >= MAX_ATTEMPTS) {
        await svc.from('message_outbox').update({
          status: 'dead_letter',
          last_error: error instanceof Error ? error.message : String(error),
        }).eq('id', row.id)
        processed.push({ id: row.id, status: 'dead_letter' })
        continue
      }

      const backoff = computeBackoffWithJitterMs(attempt)
      await svc.from('message_outbox').update({
        status: 'retry',
        next_retry_at: new Date(Date.now() + backoff).toISOString(),
        last_error: error instanceof Error ? error.message : String(error),
      }).eq('id', row.id)
      processed.push({ id: row.id, status: 'retry_exception' })
    }
  }

  return new Response(JSON.stringify({ processed, claimed: rows?.length ?? 0 }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
