export type SupabaseLike = {
  from: (table: string) => {
    upsert: (payload: Record<string, unknown>, options?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
  }
}

export type OtpIncrementInput = {
  supabase: SupabaseLike
  tenantId: string
  phone: string
}

export type RateLimitInput = {
  supabase: SupabaseLike
  tenantId: string
  scopeType: 'PHONE' | 'TENANT_CPF'
  scopeValue: string
  now?: Date
  windowSeconds: number
  pepper: string
}

export type AtomicCounterResult = {
  counter: number
  windowStart?: string
  scopeHash?: string
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function sha256Hex(payload: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload))
  return toHex(digest)
}

export async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
  return toHex(signature)
}

/**
 * Incrementa tentativas de OTP usando upsert atômico sobre chave única (tenant_id, telefone).
 */
export async function incrementOtpAttempt(input: OtpIncrementInput): Promise<number> {
  const { data, error } = await input.supabase
    .from('otp_validacoes')
    .upsert(
      {
        tenant_id: input.tenantId,
        telefone: input.phone,
        tentativas: 1,
      },
      {
        onConflict: 'tenant_id,telefone',
        ignoreDuplicates: false,
        atomic: {
          mode: 'increment',
          column: 'tentativas',
          initial: 1,
        },
      },
    )

  if (error) throw new Error('otp_attempt_increment_failed')

  const row = data as { tentativas?: number } | null
  if (!row?.tentativas || row.tentativas < 1) throw new Error('otp_attempt_increment_invalid')

  return row.tentativas
}

/**
 * Aplica rate-limit distribuído com chave HMAC(scope) e upsert atômico no contador por janela.
 */
export async function incrementDistributedRateLimit(input: RateLimitInput): Promise<AtomicCounterResult> {
  const now = input.now ?? new Date()
  const scopeHash = await hmacSha256Hex(input.pepper, `${input.tenantId}:${input.scopeType}:${input.scopeValue}`)

  const { data, error } = await input.supabase
    .from('whatsapp_auth_rate_limits')
    .upsert(
      {
        tenant_id: input.tenantId,
        scope_type: input.scopeType,
        scope_hash: scopeHash,
        counter: 1,
        window_start: now.toISOString(),
      },
      {
        onConflict: 'tenant_id,scope_type,scope_hash',
        ignoreDuplicates: false,
        atomic: {
          mode: 'windowed_increment',
          column: 'counter',
          initial: 1,
          windowSeconds: input.windowSeconds,
          now: now.toISOString(),
        },
      },
    )

  if (error) throw new Error('rate_limit_increment_failed')

  const row = data as { counter?: number; window_start?: string } | null
  if (!row?.counter || !row.window_start) throw new Error('rate_limit_increment_invalid')

  return {
    counter: row.counter,
    windowStart: row.window_start,
    scopeHash,
  }
}
