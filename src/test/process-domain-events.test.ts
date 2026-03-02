import { beforeEach, describe, expect, it, vi } from 'vitest'

const enqueued: Array<{ reference: string; payload: any }> = []

vi.mock('../../supabase/functions/_shared/message-outbox-enqueue.ts', () => ({
  enqueueMessage: vi.fn(async (args: any) => {
    enqueued.push({ reference: args.reference, payload: args.payload })
    return { ok: true, status: 'queued', idempotencyKey: 'test-key', outboxId: 'outbox-1' }
  }),
}))

vi.mock('../../supabase/functions/webhook-whatsapp/services/ai.ts', () => ({
  explainMovement: vi.fn(async (resumo: string) => resumo),
}))

type Tables = Record<string, any[]>

class TestSupabase {
  constructor(public tables: Tables) {}

  from(table: string) {
    const tables = this.tables
    const filters: Record<string, any> = {}
    let insertPayload: any = null
    let updatePayload: any = null

    const api: any = {
      select: () => api,
      eq: (k: string, v: any) => {
        filters[k] = v
        return api
      },
      order: () => api,
      limit: () => api,
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      insert: (payload: any) => {
        insertPayload = payload
        if (!tables[table]) tables[table] = []
        const arr = Array.isArray(payload) ? payload : [payload]
        for (const r of arr) tables[table].push({ id: crypto.randomUUID(), ...r })
        return Promise.resolve({ data: arr, error: null })
      },
      upsert: (payload: any, options?: { onConflict?: string; ignoreDuplicates?: boolean }) => {
        if (!tables[table]) tables[table] = []
        const arr = Array.isArray(payload) ? payload : [payload]
        const conflictCols = (options?.onConflict ?? '').split(',').map((x) => x.trim()).filter(Boolean)
        for (const item of arr) {
          const existing = tables[table].find((row) => conflictCols.length > 0 && conflictCols.every((col) => row[col] === item[col]))
          if (existing) {
            if (!options?.ignoreDuplicates) Object.assign(existing, item)
            continue
          }
          tables[table].push({ id: crypto.randomUUID(), ...item })
        }
        return Promise.resolve({ data: arr, error: null })
      },
      update: (payload: any) => {
        updatePayload = payload
        return api
      },
      then: (resolve: any) => {
        const rs = rows()
        for (const r of rs) Object.assign(r, updatePayload)
        return Promise.resolve({ data: rs, error: null }).then(resolve)
      },
    }

    function rows() {
      const all = tables[table] ?? []
      return all.filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v))
    }

    return api
  }
}

describe('process movement whatsapp notifications', () => {
  beforeEach(() => {
    enqueued.length = 0
    ;(globalThis as any).Deno = { env: { get: () => undefined }, serve: vi.fn() }
  })

  it('envia movimentação nova para contatos verificados+opt-in e registra rastreio granular', async () => {
    const { processMovementDetected } = await import('../../supabase/functions/process-domain-events/index.ts')

    const svc = new TestSupabase({
      processos: [{ id: 'processo-1', numero_cnj: '0001', user_id: 'tenant-1' }],
      whatsapp_contacts: [{ id: 'c1', tenant_id: 'tenant-1', process_id: 'processo-1', phone_number: '551199', verified: true, notifications_opt_in: true, last_notification_sent_at: null }],
      whatsapp_instancias: [{ id: 'inst-1', instance_name: 'inst', user_id: 'tenant-1', status: 'connected', created_at: '2026-01-01T00:00:00Z' }],
      notificacoes: [],
      conversation_logs: [],
      process_movement_notifications: [],
    }) as any

    await processMovementDetected(svc, { id: 'evt-1', payload: { processo_id: 'processo-1', movement_id: '11111111-1111-1111-1111-111111111111', resumo: 'mov', total_movimentacoes: 1 } })

    expect(enqueued).toHaveLength(1)
    expect(svc.tables.process_movement_notifications).toHaveLength(1)
  })

  it('não reenvia movimentação duplicada e retry mantém idempotência por contato', async () => {
    const { processMovementDetected } = await import('../../supabase/functions/process-domain-events/index.ts')

    const svc = new TestSupabase({
      processos: [{ id: 'processo-1', numero_cnj: '0001', user_id: 'tenant-1' }],
      whatsapp_contacts: [{ id: 'c1', tenant_id: 'tenant-1', process_id: 'processo-1', phone_number: '551199', verified: true, notifications_opt_in: true, last_notification_sent_at: null }],
      whatsapp_instancias: [{ id: 'inst-1', instance_name: 'inst', user_id: 'tenant-1', status: 'connected', created_at: '2026-01-01T00:00:00Z' }],
      notificacoes: [],
      conversation_logs: [],
      process_movement_notifications: [{ id: 'n1', tenant_id: 'tenant-1', process_id: 'processo-1', movement_id: '11111111-1111-1111-1111-111111111111', contact_id: 'c1', notified_at: new Date().toISOString() }],
    }) as any

    await processMovementDetected(svc, { id: 'evt-1', payload: { processo_id: 'processo-1', movement_id: '11111111-1111-1111-1111-111111111111', resumo: 'mov', total_movimentacoes: 1 } })

    expect(enqueued).toHaveLength(0)
    expect(svc.tables.process_movement_notifications).toHaveLength(1)
  })
})
