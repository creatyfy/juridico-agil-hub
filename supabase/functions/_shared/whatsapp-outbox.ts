// @ts-nocheck - Deno edge function
import { enqueueMessage } from './message-outbox-enqueue.ts'
import type { RequestContext } from './whatsapp-types.ts'
import { logError, logInfo } from './whatsapp-logger.ts'

export async function enqueueWhatsAppText(
  ctx: RequestContext,
  text: string,
  kind: 'auth' | 'orchestrator',
  reference: string,
): Promise<void> {
  const result = await enqueueMessage({
    supabase: ctx.supabase,
    tenantId: ctx.tenantId,
    destination: ctx.phone,
    event: kind,
    reference,
    aggregateType: kind,
    aggregateId: ctx.instanceId,
    payload: {
      kind,
      destinationNumber: ctx.phone,
      messageText: text,
      instanceName: ctx.instanceName,
      instanceId: ctx.instanceId,
      userId: ctx.tenantId,
    },
  })

  if (!result.ok) {
    logError('outbox_enqueue_failed', {
      request_id: ctx.requestId,
      tenant_id: ctx.tenantId,
      telefone: ctx.phone,
      status: result.status,
      reason: result.reason,
    })
    return
  }

  logInfo('outbox_enqueued', {
    request_id: ctx.requestId,
    tenant_id: ctx.tenantId,
    telefone: ctx.phone,
    status: result.status,
    idempotency_key: result.idempotencyKey,
  })

  await ctx.supabase.from('conversation_logs').insert({
    tenant_id: ctx.tenantId,
    phone_number: ctx.phone,
    message: text,
    direction: 'outbound',
    intent: kind,
  })
}
