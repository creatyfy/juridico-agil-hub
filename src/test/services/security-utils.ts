export function generateSixDigitOtp(random: Pick<Crypto, 'getRandomValues'> = crypto): string {
  const raw = new Uint32Array(6)
  random.getRandomValues(raw)
  return [...raw].map((value) => String(value % 10)).join('')
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function sha256WithPepper(value: string, pepper: string): Promise<string> {
  if (!pepper) throw new Error('otp_pepper_not_configured')
  const payload = new TextEncoder().encode(`${value}:${pepper}`)
  return toHex(await crypto.subtle.digest('SHA-256', payload))
}

export function timingSafeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false

  let mismatch = 0
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }

  return mismatch === 0
}

export async function computeWebhookHmac(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
  return toHex(signature)
}

export function redactSensitivePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(payload)) {
    if (typeof value !== 'string') {
      out[key] = value
      continue
    }

    if (key.toLowerCase().includes('cpf')) {
      const cpf = value.replace(/\D/g, '')
      out[key] = cpf.length >= 2 ? `***.***.***-${cpf.slice(-2)}` : '***'
      continue
    }

    if (key.toLowerCase().includes('telefone') || key.toLowerCase().includes('phone')) {
      const phone = value.replace(/\D/g, '')
      out[key] = phone.length >= 4 ? `***${phone.slice(-4)}` : '***'
      continue
    }

    out[key] = value
  }

  return out
}

export type StepUpRiskInput = {
  phoneVerified: boolean
  riskScore: number
  geoVelocityRisk?: boolean
  deviceChangedRecently?: boolean
}

export function shouldRequireStepUpAuth(input: StepUpRiskInput): boolean {
  if (!input.phoneVerified) return true
  if (input.riskScore >= 0.7) return true
  if (input.geoVelocityRisk) return true
  if (input.deviceChangedRecently) return true
  return false
}

export class SecurityMetricsCollector {
  counters = {
    otpIssued: 0,
    otpValidated: 0,
    lockouts: 0,
    webhookRejected: 0,
  }

  clockDriftSeconds: number[] = []

  recordOtpIssued() { this.counters.otpIssued += 1 }

  recordOtpValidated() { this.counters.otpValidated += 1 }

  recordLockout() { this.counters.lockouts += 1 }

  recordWebhookRejected() { this.counters.webhookRejected += 1 }

  recordClockDrift(seconds: number) { this.clockDriftSeconds.push(seconds) }
}
