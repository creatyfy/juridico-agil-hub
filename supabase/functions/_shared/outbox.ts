export type OutboxStatus = 'pending' | 'sending' | 'accepted' | 'delivered' | 'retry' | 'dead_letter'

const encoder = new TextEncoder()

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function buildIdempotencyKey(input: {
  tenantId: string
  event: string
  destination: string
  reference: string
}): Promise<string> {
  const normalized = `${input.tenantId}|${input.event}|${input.destination}|${input.reference}`
    .trim()
    .toLowerCase()
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(normalized))
  return toHex(digest)
}

export function shouldRetryStatus(httpStatus?: number): boolean {
  if (!httpStatus) return true
  if (httpStatus === 429) return true
  if (httpStatus >= 500 && httpStatus <= 599) return true
  return false
}

export function computeBackoffWithJitterMs(attempt: number, baseMs = 1500, maxMs = 5 * 60_000): number {
  const cappedAttempt = Math.max(1, attempt)
  const exp = Math.min(maxMs, baseMs * 2 ** (cappedAttempt - 1))
  const jitter = Math.floor(Math.random() * Math.floor(exp * 0.2 + 1))
  return Math.min(maxMs, exp + jitter)
}

export function maskSensitive(value?: string | null): string | null {
  if (!value) return value ?? null
  const digits = value.replace(/\D/g, '')
  if (digits.length >= 11) {
    return `***.***.***-${digits.slice(-2)}`
  }
  if (digits.length >= 8) {
    return `***${digits.slice(-4)}`
  }
  return '***'
}

export type OutboxPayload = {
  kind: 'process_update' | 'manual_chat' | 'auth' | 'orchestrator' | 'vinculacao_otp'
  processoId?: string
  processoNumero?: string
  clienteNome?: string
  destinationNumber: string
  messageText: string
  instanceName: string
  instanceId: string
  userId: string
}
