export type StepUpInput = {
  phoneVerified: boolean
  riskScore: number
  deviceChanged: boolean
  geoVelocity: number
  geoVelocityThreshold?: number
  riskScoreThreshold?: number
}

export type StepUpDecision = {
  requireOtp: boolean
  reason: 'phone_not_verified' | 'high_risk_score' | 'device_changed' | 'geo_velocity' | 'trusted'
}

/**
 * Decide se um telefone previamente verificado pode bypass de OTP.
 * Segurança defensiva: risco alto sempre exige step-up.
 */
export function requiresStepUpAuth(input: StepUpInput): StepUpDecision {
  const riskScoreThreshold = input.riskScoreThreshold ?? 0.7
  const geoVelocityThreshold = input.geoVelocityThreshold ?? 120

  if (!input.phoneVerified) {
    return { requireOtp: true, reason: 'phone_not_verified' }
  }

  if (input.riskScore >= riskScoreThreshold) {
    return { requireOtp: true, reason: 'high_risk_score' }
  }

  if (input.deviceChanged) {
    return { requireOtp: true, reason: 'device_changed' }
  }

  if (input.geoVelocity >= geoVelocityThreshold) {
    return { requireOtp: true, reason: 'geo_velocity' }
  }

  return { requireOtp: false, reason: 'trusted' }
}
