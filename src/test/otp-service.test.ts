import { describe, expect, it } from 'vitest'
import { incrementDistributedRateLimit, incrementOtpAttempt } from '../functions/webhook-whatsapp/services/otp-service'
import { FakeSupabase, createDbState } from './services/fake-supabase'

describe('otp-service atomic counters', () => {
  it('incrementa tentativas OTP de forma determinística com upsert atômico', async () => {
    // Setup: banco fake isolado com tenant/telefone únicos por teste.
    const state = createDbState()
    const supabase = new FakeSupabase(state)

    // Execução: simula concorrência de múltiplos erros de OTP para o mesmo telefone.
    const increments = await Promise.all([
      incrementOtpAttempt({ supabase: supabase as any, tenantId: 'tenant-1', phone: '5511999999999' }),
      incrementOtpAttempt({ supabase: supabase as any, tenantId: 'tenant-1', phone: '5511999999999' }),
      incrementOtpAttempt({ supabase: supabase as any, tenantId: 'tenant-1', phone: '5511999999999' }),
    ])

    // Asserção: apenas um registro ativo e contador final monotônico/estável.
    expect(state.otp_validacoes).toHaveLength(1)
    expect(state.otp_validacoes[0].tentativas).toBe(3)
    expect(increments.sort((a, b) => a - b)).toEqual([1, 2, 3])

    // Isolamento: state recriado a cada teste.
  })

  it('aplica rate-limit distribuído atômico e reinicia janela expirada', async () => {
    // Setup: escopo de limite por hash HMAC (tenant + scope), com pepper conhecido.
    const state = createDbState()
    const supabase = new FakeSupabase(state)
    const pepper = 'pepper-rate-limit'

    // Execução: duas chamadas na mesma janela e uma após expiração da janela.
    const first = await incrementDistributedRateLimit({
      supabase: supabase as any,
      tenantId: 'tenant-1',
      scopeType: 'PHONE',
      scopeValue: '5511999999999',
      now: new Date('2026-01-01T10:00:00.000Z'),
      windowSeconds: 300,
      pepper,
    })

    const second = await incrementDistributedRateLimit({
      supabase: supabase as any,
      tenantId: 'tenant-1',
      scopeType: 'PHONE',
      scopeValue: '5511999999999',
      now: new Date('2026-01-01T10:01:00.000Z'),
      windowSeconds: 300,
      pepper,
    })

    const third = await incrementDistributedRateLimit({
      supabase: supabase as any,
      tenantId: 'tenant-1',
      scopeType: 'PHONE',
      scopeValue: '5511999999999',
      now: new Date('2026-01-01T10:10:01.000Z'),
      windowSeconds: 300,
      pepper,
    })

    // Asserção: hash de escopo estável, incremento atômico e reset de janela previsível.
    expect(first.scopeHash).toBe(second.scopeHash)
    expect(first.counter).toBe(1)
    expect(second.counter).toBe(2)
    expect(third.counter).toBe(1)
    expect(state.whatsapp_auth_rate_limits).toHaveLength(1)
    expect(state.whatsapp_auth_rate_limits[0].window_start).toBe('2026-01-01T10:10:01.000Z')

    // Isolamento: sem dependência de rede/Supabase real.
  })
})
