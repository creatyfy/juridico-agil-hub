import { describe, expect, it } from 'vitest'
import {
  computeWebhookHmac,
  generateSixDigitOtp,
  redactSensitivePayload,
  sha256WithPepper,
  timingSafeCompare,
} from './services/security-utils'

describe('security utility helpers', () => {
  it('gera OTP com 6 dígitos numéricos', () => {
    const otp = generateSixDigitOtp()
    expect(otp).toMatch(/^\d{6}$/)
  })

  it('aplica SHA-256 com pepper obrigatório', async () => {
    const hash = await sha256WithPepper('tenant:phone:123456', 'pepper')
    expect(hash).toMatch(/^[a-f0-9]{64}$/)
    await expect(sha256WithPepper('tenant:phone:123456', '')).rejects.toThrow('otp_pepper_not_configured')
  })

  it('faz comparação timing-safe determinística', () => {
    expect(timingSafeCompare('abcd', 'abcd')).toBe(true)
    expect(timingSafeCompare('abcd', 'abce')).toBe(false)
    expect(timingSafeCompare('abcd', 'abc')).toBe(false)
  })

  it('calcula HMAC SHA-256 para payloads de webhook', async () => {
    const signature = await computeWebhookHmac('secret', 'payload')
    expect(signature).toMatch(/^[a-f0-9]{64}$/)
  })

  it('mascara CPF e telefone em payloads de logs', () => {
    const redacted = redactSensitivePayload({ cpf: '123.456.789-09', telefone: '5511999998888' })
    expect(redacted).toEqual({ cpf: '***.***.***-09', telefone: '***8888' })
  })
})
