import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeSupabase } from './services/fake-supabase'
import { SecurityMetricsCollector, computeWebhookHmac, redactSensitivePayload } from './services/security-utils'

describe('webhook security hardening', () => {
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

  it('8) rejeita webhook sem headers obrigatórios, assinatura inválida e replay por nonce', async () => {
    const stateSupabase = new FakeSupabase({
      whatsapp_contacts: [],
      conversas: [],
      clientes: [],
      otp_validacoes: [],
      telefones: [],
      whatsapp_auth_rate_limits: [],
      webhook_replay_guard: [],
    })
    const { validateWebhookSignature } = await import('../../supabase/functions/webhook-whatsapp/services/webhook-security.ts')

    const rawBody = JSON.stringify({ event: 'messages.upsert' })
    const reqMissing = new Request('https://example.com', { method: 'POST' })
    const missing = await validateWebhookSignature({ req: reqMissing, rawBody, supabase: stateSupabase as any, instanceName: 'inst-1' })

    const timestamp = String(Math.floor(Date.now() / 1000))
    const nonce = 'nonce-xyz'
    const validSignature = await computeWebhookHmac('webhook-secret', `${timestamp}.${nonce}.inst-1.${rawBody}`)

    const reqBadSig = new Request('https://example.com', {
      method: 'POST',
      headers: {
        'x-webhook-timestamp': timestamp,
        'x-webhook-nonce': nonce,
        'x-webhook-signature': 'bad-signature',
      },
    })

    const invalidSig = await validateWebhookSignature({ req: reqBadSig, rawBody, supabase: stateSupabase as any, instanceName: 'inst-1' })

    const reqValid = new Request('https://example.com', {
      method: 'POST',
      headers: {
        'x-webhook-timestamp': timestamp,
        'x-webhook-nonce': nonce,
        'x-webhook-signature': validSignature,
      },
    })

    const first = await validateWebhookSignature({ req: reqValid, rawBody, supabase: stateSupabase as any, instanceName: 'inst-1' })
    const replay = await validateWebhookSignature({ req: reqValid, rawBody, supabase: stateSupabase as any, instanceName: 'inst-1' })

    expect(missing).toEqual({ valid: false, reason: 'missing_hmac_headers' })
    expect(invalidSig).toEqual({ valid: false, reason: 'invalid_signature' })
    expect(first).toEqual({ valid: true })
    expect(replay).toEqual({ valid: false, reason: 'replay_detected' })
  })

  it('14) observa rejeição por drift de relógio para métricas de segurança', async () => {
    const metrics = new SecurityMetricsCollector()
    const { validateWebhookSignature } = await import('../../supabase/functions/webhook-whatsapp/services/webhook-security.ts')
    const rawBody = JSON.stringify({ event: 'messages.upsert' })

    const staleTimestamp = String(Math.floor(Date.now() / 1000) - 1000)
    const nonce = 'nonce-stale'
    const signature = await computeWebhookHmac('webhook-secret', `${staleTimestamp}.${nonce}.inst-1.${rawBody}`)

    const req = new Request('https://example.com', {
      method: 'POST',
      headers: {
        'x-webhook-timestamp': staleTimestamp,
        'x-webhook-nonce': nonce,
        'x-webhook-signature': signature,
      },
    })

    const result = await validateWebhookSignature({
      req,
      rawBody,
      supabase: new FakeSupabase({ whatsapp_contacts: [], conversas: [], clientes: [], otp_validacoes: [], telefones: [], whatsapp_auth_rate_limits: [], webhook_replay_guard: [] }) as any,
      instanceName: 'inst-1',
    })

    if (result.reason === 'timestamp_out_of_range') {
      metrics.recordWebhookRejected()
      metrics.recordClockDrift(1000)
    }

    expect(result).toEqual({ valid: false, reason: 'timestamp_out_of_range' })
    expect(metrics.counters.webhookRejected).toBe(1)
    expect(metrics.clockDriftSeconds[0]).toBe(1000)
  })

  it('10) sanitização de logs remove PII em CPF/telefone', () => {
    const payload = redactSensitivePayload({
      tenant_id: 'tenant-1',
      cpf: '12345678909',
      telefone: '+55 (11) 99999-9999',
      msg: 'ok',
    })

    expect(payload.cpf).toBe('***.***.***-09')
    expect(payload.telefone).toBe('***9999')
    expect(JSON.stringify(payload)).not.toContain('12345678909')
    expect(JSON.stringify(payload)).not.toContain('99999-9999')
  })
})
