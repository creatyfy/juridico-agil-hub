import { maskCpf, maskPhone } from './security.ts'

const SENSITIVE_KEYWORDS = ['mensagem', 'message', 'conteudo', 'payload', 'body', 'text', 'otp', 'cpf', 'telefone', 'phone']

function isSensitiveKey(key: string): boolean {
  const lowered = key.toLowerCase()
  return SENSITIVE_KEYWORDS.some((token) => lowered.includes(token))
}

function sanitizePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === 'string' && key.toLowerCase().includes('telefone')) {
      sanitized[key] = maskPhone(value)
      continue
    }

    if (typeof value === 'string' && key.toLowerCase().includes('cpf')) {
      sanitized[key] = maskCpf(value)
      continue
    }

    if (typeof value === 'string' && isSensitiveKey(key)) {
      sanitized[key] = '[REDACTED]'
      continue
    }

    if (value && typeof value === 'object' && isSensitiveKey(key)) {
      sanitized[key] = '[REDACTED_OBJECT]'
      continue
    }

    sanitized[key] = value
  }

  return sanitized
}

function toLogLine(level: 'info' | 'error', event: string, payload: Record<string, unknown>) {
  const sanitized = sanitizePayload(payload)
  if (!('correlation_id' in sanitized) && typeof sanitized.request_id === 'string') {
    sanitized.correlation_id = sanitized.request_id
  }

  return JSON.stringify({
    level,
    event,
    retention_policy: 'minimal',
    ...sanitized,
  })
}

export function logInfo(event: string, payload: Record<string, unknown>) {
  console.log(toLogLine('info', event, payload))
}

export function logError(event: string, payload: Record<string, unknown>) {
  console.error(toLogLine('error', event, payload))
}
