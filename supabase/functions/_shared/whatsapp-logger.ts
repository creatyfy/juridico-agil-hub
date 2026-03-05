// @ts-nocheck - Deno edge function
import { maskCpf, maskPhone } from './whatsapp-security.ts'

function sanitizeValue(key: string, value: unknown): unknown {
  const normalizedKey = key.toLowerCase()

  if (typeof value === 'string') {
    if (normalizedKey.includes('cpf')) return maskCpf(value)
    if (normalizedKey.includes('telefone') || normalizedKey.includes('phone')) return maskPhone(value)
    if (normalizedKey.includes('mensagem') || normalizedKey.includes('message') || normalizedKey.includes('conteudo')) {
      return '[redacted_message_content]'
    }
    return value
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(key, item))
  }

  if (value && typeof value === 'object') {
    const nested: Record<string, unknown> = {}
    for (const [nestedKey, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      nested[nestedKey] = sanitizeValue(nestedKey, nestedValue)
    }
    return nested
  }

  return value
}

function sanitizePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(payload)) {
    sanitized[key] = sanitizeValue(key, value)
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
    lgpd_safe: true,
    ...sanitized,
  })
}

export function logInfo(event: string, payload: Record<string, unknown>) {
  console.log(toLogLine('info', event, payload))
}

export function logError(event: string, payload: Record<string, unknown>) {
  console.error(toLogLine('error', event, payload))
}
