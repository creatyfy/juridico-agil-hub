import { beforeEach, describe, expect, it, vi } from 'vitest'

class FakeSupabase {
  private nonces = new Set<string>()

  from(table: string) {
    if (table !== 'webhook_replay_guard') throw new Error('unexpected table')

    return {
      insert: async (payload: any) => {
        if (this.nonces.has(payload.nonce_hash)) {
          return { error: { message: 'duplicate' } }
        }

        this.nonces.add(payload.nonce_hash)
        return { error: null }
      },
    }
  }
}

describe('webhook security', () => {
  beforeEach(() => {
    vi.resetModules()
    ;(globalThis as any).Deno = {
      env: {
        get: (key: string) => {
          if (key === 'WEBHOOK_HMAC_SECRET') return 'webhook-secret'
          if (key === 'WEBHOOK_ALLOWED_DRIFT_SECONDS') return '300'
          return undefined
        },
      },
    }
  })

  it('rejects invalid signature', async () => {
    const { validateWebhookSignature } = await import('../../supabase/functions/webhook-whatsapp/services/webhook-security.ts')

    const req = new Request('https://example.com', {
      method: 'POST',
      headers: {
        'x-webhook-timestamp': String(Math.floor(Date.now() / 1000)),
        'x-webhook-nonce': 'nonce-1',
        'x-webhook-signature': 'bad-signature',
      },
    })

    const result = await validateWebhookSignature({
      req,
      rawBody: JSON.stringify({ event: 'messages.upsert' }),
      supabase: new FakeSupabase() as any,
      instanceName: 'inst-1',
    })

    expect(result.valid).toBe(false)
    expect(result.reason).toBe('invalid_signature')
  })

  it('rejects replay attack with same nonce', async () => {
    const { validateWebhookSignature } = await import('../../supabase/functions/webhook-whatsapp/services/webhook-security.ts')
    const { computeHmacSha256 } = await import('../../supabase/functions/webhook-whatsapp/services/security.ts')

    const timestamp = String(Math.floor(Date.now() / 1000))
    const nonce = 'nonce-xyz'
    const rawBody = JSON.stringify({ event: 'messages.upsert' })
    const signature = await computeHmacSha256('webhook-secret', `${timestamp}.${nonce}.inst-1.${rawBody}`)

    const req = new Request('https://example.com', {
      method: 'POST',
      headers: {
        'x-webhook-timestamp': timestamp,
        'x-webhook-nonce': nonce,
        'x-webhook-signature': signature,
      },
    })

    const supabase = new FakeSupabase()
    const first = await validateWebhookSignature({ req, rawBody, supabase: supabase as any, instanceName: 'inst-1' })
    const second = await validateWebhookSignature({ req, rawBody, supabase: supabase as any, instanceName: 'inst-1' })

    expect(first.valid).toBe(true)
    expect(second.valid).toBe(false)
    expect(second.reason).toBe('replay_detected')
  })
})
