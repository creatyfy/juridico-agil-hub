import { describe, expect, it } from 'vitest'
import { requiresStepUpAuth } from '../functions/webhook-whatsapp/services/stepup-auth'

describe('step-up auth adaptativa', () => {
  it('exige OTP quando telefone ainda não foi verificado', () => {
    // Setup: sessão sem vínculo de telefone previamente confiável.
    const input = { phoneVerified: false, riskScore: 0.1, deviceChanged: false, geoVelocity: 10 }

    // Execução: avaliação de risco para bypass.
    const decision = requiresStepUpAuth(input)

    // Asserção: step-up obrigatório por hardening base.
    expect(decision).toEqual({ requireOtp: true, reason: 'phone_not_verified' })

    // Isolamento: caso unitário puro, sem I/O.
  })

  it('permite bypass quando risco é baixo e contexto estável', () => {
    // Setup: telefone verificado, score baixo, sem mudança de dispositivo/geo suspeita.
    const input = { phoneVerified: true, riskScore: 0.25, deviceChanged: false, geoVelocity: 25 }

    // Execução.
    const decision = requiresStepUpAuth(input)

    // Asserção.
    expect(decision).toEqual({ requireOtp: false, reason: 'trusted' })
  })

  it('força step-up em risco alto por score, device change ou geo-velocity', () => {
    // Setup.
    const highScore = { phoneVerified: true, riskScore: 0.91, deviceChanged: false, geoVelocity: 20 }
    const changedDevice = { phoneVerified: true, riskScore: 0.2, deviceChanged: true, geoVelocity: 20 }
    const highVelocity = { phoneVerified: true, riskScore: 0.2, deviceChanged: false, geoVelocity: 180 }

    // Execução.
    const scoreDecision = requiresStepUpAuth(highScore)
    const deviceDecision = requiresStepUpAuth(changedDevice)
    const velocityDecision = requiresStepUpAuth(highVelocity)

    // Asserção.
    expect(scoreDecision).toEqual({ requireOtp: true, reason: 'high_risk_score' })
    expect(deviceDecision).toEqual({ requireOtp: true, reason: 'device_changed' })
    expect(velocityDecision).toEqual({ requireOtp: true, reason: 'geo_velocity' })

    // Isolamento: função determinística sem relógio/rede.
  })
})
