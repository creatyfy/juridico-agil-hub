import { describe, expect, it } from 'vitest'
import { buildIdempotencyKey } from '../../supabase/functions/_shared/outbox'
import { decideOutboxOutcome } from '../../supabase/functions/_shared/outbox-worker-logic'

describe('outbox resilience', () => {
  it('envio normal marca como sent', () => {
    const decision = decideOutboxOutcome({ attempts: 1, maxAttempts: 5, httpStatus: 200 })
    expect(decision).toEqual({ action: 'sent' })
  })

  it('429 agenda retry com backoff', () => {
    const decision = decideOutboxOutcome({ attempts: 2, maxAttempts: 5, httpStatus: 429 })
    expect(decision.action).toBe('retry')
    if (decision.action === 'retry') {
      expect(decision.reason).toBe('http_429')
      expect(decision.delayMs).toBeGreaterThan(0)
    }
  })

  it('timeout agenda retry', () => {
    const decision = decideOutboxOutcome({ attempts: 1, maxAttempts: 5, timedOut: true })
    expect(decision.action).toBe('retry')
  })

  it('falha permanente de negócio (4xx) não retry', () => {
    const decision = decideOutboxOutcome({ attempts: 1, maxAttempts: 5, httpStatus: 422 })
    expect(decision).toEqual({ action: 'failed', reason: 'http_422' })
  })

  it('idempotência é determinística e não duplica chave', async () => {
    const a = await buildIdempotencyKey({ tenantId: 't1', event: 'process_update', destination: '5511999999999', reference: 'proc-1' })
    const b = await buildIdempotencyKey({ tenantId: 't1', event: 'process_update', destination: '5511999999999', reference: 'proc-1' })
    const c = await buildIdempotencyKey({ tenantId: 't1', event: 'process_update', destination: '5511888888888', reference: 'proc-1' })
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })

  it('ultrapassando limite vai para dead letter', () => {
    const decision = decideOutboxOutcome({ attempts: 5, maxAttempts: 5, timedOut: true })
    expect(decision).toEqual({ action: 'dead_letter', reason: 'timeout' })
  })

  it('rate limit bloqueia envio e agenda retry', () => {
    const decision = decideOutboxOutcome({ attempts: 1, maxAttempts: 5, tenantRateLimited: true })
    expect(decision.action).toBe('retry')
    if (decision.action === 'retry') {
      expect(decision.reason).toBe('rate_limit')
    }
  })
})
