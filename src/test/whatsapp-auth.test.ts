import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeSupabase, createDbState, type DbState } from './services/fake-supabase'
import { SecurityMetricsCollector, shouldRequireStepUpAuth, timingSafeCompare } from './services/security-utils'

const sentMessages: Array<{ phone: string; text: string }> = []

vi.mock('../../supabase/functions/webhook-whatsapp/services/evolution.ts', () => ({
  sendWhatsAppText: vi.fn(async (_instanceName: string, phone: string, text: string) => {
    sentMessages.push({ phone, text })
  }),
}))

describe('whatsapp auth flow hardening', () => {
  beforeEach(() => {
    sentMessages.length = 0
    vi.resetModules()
    ;(globalThis as any).Deno = {
      env: {
        get: (key: string) => {
          if (key === 'OTP_PEPPER') return 'test-pepper'
          if (key === 'OTP_MAX_PER_PHONE_WINDOW') return '2'
          if (key === 'OTP_MAX_PER_CPF_WINDOW') return '2'
          if (key === 'OTP_RATE_WINDOW_SECONDS') return '300'
          if (key === 'OTP_TTL_MINUTES') return '5'
          if (key === 'OTP_MAX_ATTEMPTS') return '3'
          return undefined
        },
      },
    }
  })

  async function makeCtx(state: DbState, message: string) {
    const { handleAuthenticationFlow, isPhoneVerified } = await import('../../supabase/functions/webhook-whatsapp/services/auth.ts')
    const supabase = new FakeSupabase(state)

    const baseCtx = {
      requestId: 'req-1',
      supabase: supabase as any,
      tenantId: 'tenant-1',
      instanceName: 'inst-1',
      instanceId: 'instance-id',
      phone: '5511999999999',
      message,
    }

    return { handleAuthenticationFlow, isPhoneVerified, baseCtx }
  }

  it('1) happy path: CPF + OTP válidos, valida telefone e remove OTP ativo', async () => {
    // Setup: conversa nova com cliente cadastrado no tenant.
    const state = createDbState()

    // Execução: inicia conversa, envia CPF válido e responde com OTP recebido.
    let ctx = await makeCtx(state, 'Oi')
    await ctx.handleAuthenticationFlow(ctx.baseCtx)
    ctx = await makeCtx(state, '12345678909')
    await ctx.handleAuthenticationFlow(ctx.baseCtx)

    const otp = sentMessages.at(-1)?.text.match(/(\d{6})/)?.[1]
    expect(otp).toBeTruthy()

    ctx = await makeCtx(state, otp!)
    const result = await ctx.handleAuthenticationFlow(ctx.baseCtx)
    const verification = await ctx.isPhoneVerified(ctx.baseCtx)

    // Asserções: autenticação concluída, telefone marcado como verificado e OTP invalidado.
    expect(result.authenticated).toBe(true)
    expect(verification.verified).toBe(true)
    expect(state.otp_validacoes).toHaveLength(0)
    expect(state.whatsapp_contacts[0]?.conversation_state).toBe('AUTHENTICATED')

    // Cleanup: estado isolado por teste (novo state em cada case).
  })

  it('2 & 11) CPF inválido e CPF não cadastrado retornam mesma mensagem anti-enumeração', async () => {
    const state = createDbState()

    let ctx = await makeCtx(state, 'Oi')
    await ctx.handleAuthenticationFlow(ctx.baseCtx)

    ctx = await makeCtx(state, '11111111111')
    await ctx.handleAuthenticationFlow(ctx.baseCtx)
    const invalidCpfMessage = sentMessages.at(-1)?.text

    ctx = await makeCtx(state, '98765432100')
    await ctx.handleAuthenticationFlow(ctx.baseCtx)
    const unknownCpfMessage = sentMessages.at(-1)?.text

    expect(invalidCpfMessage).toBe(unknownCpfMessage)
    expect(state.otp_validacoes).toHaveLength(0)
  })

  it('3) OTP incorreto incrementa tentativas e bloqueia ao exceder limite', async () => {
    const state = createDbState()

    let ctx = await makeCtx(state, 'Oi')
    await ctx.handleAuthenticationFlow(ctx.baseCtx)
    ctx = await makeCtx(state, '12345678909')
    await ctx.handleAuthenticationFlow(ctx.baseCtx)

    for (let i = 0; i < 3; i += 1) {
      ctx = await makeCtx(state, '000000')
      await ctx.handleAuthenticationFlow(ctx.baseCtx)
    }

    expect(state.otp_validacoes[0]?.tentativas).toBe(3)

    ctx = await makeCtx(state, '000000')
    await ctx.handleAuthenticationFlow(ctx.baseCtx)

    expect(state.otp_validacoes).toHaveLength(0)
    expect(state.whatsapp_contacts[0]?.conversation_state).toBe('WAITING_CPF')
  })

  it('4) OTP expirado reinicia fluxo com reset seguro', async () => {
    const state = createDbState()

    let ctx = await makeCtx(state, 'Oi')
    await ctx.handleAuthenticationFlow(ctx.baseCtx)
    ctx = await makeCtx(state, '12345678909')
    await ctx.handleAuthenticationFlow(ctx.baseCtx)

    state.otp_validacoes[0].expires_at = new Date(Date.now() - 60_000).toISOString()

    ctx = await makeCtx(state, '123456')
    await ctx.handleAuthenticationFlow(ctx.baseCtx)

    expect(state.whatsapp_contacts[0]?.conversation_state).toBe('WAITING_CPF')
    expect(state.otp_validacoes).toHaveLength(0)
  })

  it('5) bypass para telefone previamente verificado retorna acesso direto', async () => {
    const state = createDbState()
    state.whatsapp_contacts.push({
      id: 'contact-1',
      tenant_id: 'tenant-1',
      phone_number: '5511999999999',
      client_id: 'cliente-1',
      process_id: null,
      verified: true,
      conversation_state: 'AUTHENTICATED',
      cpf_attempts: 0,
      otp_attempts: 0,
      blocked_until: null,
    })

    const ctx = await makeCtx(state, 'status')
    const verification = await ctx.isPhoneVerified(ctx.baseCtx)

    expect(verification).toEqual({ verified: true, clienteId: 'cliente-1' })
  })

  it('6) falha imediatamente ao tentar emitir OTP sem OTP_PEPPER', async () => {
    const state = createDbState()
    ;(globalThis as any).Deno.env.get = (key: string) => (key === 'OTP_PEPPER' ? undefined : '5')

    let ctx = await makeCtx(state, 'Oi')
    await ctx.handleAuthenticationFlow(ctx.baseCtx)
    ctx = await makeCtx(state, '12345678909')

    await expect(ctx.handleAuthenticationFlow(ctx.baseCtx)).rejects.toThrow('otp_pepper_not_configured')
    expect(state.otp_validacoes).toHaveLength(0)
  })

  it('7 & 9) concorrência de múltiplos OTPs mantém unicidade ativa e rate-limit distribuído', async () => {
    const state = createDbState()

    let ctx = await makeCtx(state, 'Oi')
    await ctx.handleAuthenticationFlow(ctx.baseCtx)

    const first = makeCtx(state, '12345678909').then(({ handleAuthenticationFlow, baseCtx }) => handleAuthenticationFlow(baseCtx))
    const second = makeCtx(state, '12345678909').then(({ handleAuthenticationFlow, baseCtx }) => handleAuthenticationFlow(baseCtx))
    await Promise.all([first, second])

    expect(state.otp_validacoes).toHaveLength(1)

    // Nova solicitação ainda na janela deve ser bloqueada por limite PHONE + TENANT_CPF.
    state.whatsapp_contacts[0].conversation_state = 'WAITING_CPF'
    ctx = await makeCtx(state, '12345678909')
    await ctx.handleAuthenticationFlow(ctx.baseCtx)
    expect(sentMessages.at(-1)?.text).toContain('limite de tentativas')
  })

  it('12) comparação timing-safe não varia por prefixo (mitigação side-channel)', async () => {
    const sampleHash = 'abcdef1234567890'
    const mismatchEarly = 'bbcdef1234567890'
    const mismatchLate = 'abcdef1234567891'

    const loops = 30_000
    const measure = (value: string) => {
      const start = performance.now()
      for (let i = 0; i < loops; i += 1) timingSafeCompare(sampleHash, value)
      return performance.now() - start
    }

    const tEarly = measure(mismatchEarly)
    const tLate = measure(mismatchLate)
    const delta = Math.abs(tEarly - tLate)

    expect(delta).toBeLessThan(12)
  })

  it('13 & 14) step-up auth em risco + observabilidade mínima de lockout/OTP', () => {
    const metrics = new SecurityMetricsCollector()

    metrics.recordOtpIssued()
    metrics.recordOtpIssued()
    metrics.recordOtpValidated()
    metrics.recordLockout()
    metrics.recordClockDrift(42)

    expect(shouldRequireStepUpAuth({ phoneVerified: true, riskScore: 0.9 })).toBe(true)
    expect(shouldRequireStepUpAuth({ phoneVerified: true, riskScore: 0.3, geoVelocityRisk: true })).toBe(true)
    expect(shouldRequireStepUpAuth({ phoneVerified: true, riskScore: 0.2 })).toBe(false)

    expect(metrics.counters).toEqual({
      otpIssued: 2,
      otpValidated: 1,
      lockouts: 1,
      webhookRejected: 0,
    })
    expect(metrics.clockDriftSeconds).toEqual([42])
  })
})
