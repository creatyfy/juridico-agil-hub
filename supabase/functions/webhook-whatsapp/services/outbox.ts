import { enqueueMessage } from '../../_shared/message-outbox-enqueue.ts'
import type { RequestContext } from './types.ts'
import { logError, logInfo } from './logger.ts'

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
}
