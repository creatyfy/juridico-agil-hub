import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const encoder = new TextEncoder()

export async function hashOtpCode(code: string, pepper: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`${code}:${pepper}`))
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function uniformOtpResponse(): Response {
  return new Response(JSON.stringify({ success: true, message: 'Se os dados estiverem corretos, o código foi processado.' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

export async function ensureOtpNotRateLimited(input: {
  supabase: SupabaseClient
  ipHash: string
  email: string
  documentHash?: string | null
}): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const { data, error } = await input.supabase.rpc('is_otp_rate_limited', {
    p_ip_hash: input.ipHash,
    p_email: input.email,
    p_document_hash: input.documentHash ?? null,
  })

  if (error) throw error
  const row = Array.isArray(data) ? data[0] : data
  return { allowed: Boolean(row?.allowed), retryAfterSeconds: Number(row?.retry_after_seconds ?? 0) }
}

export async function registerOtpRateEvent(input: {
  supabase: SupabaseClient
  ipHash: string
  email: string
  documentHash?: string | null
}): Promise<void> {
  await input.supabase.rpc('register_otp_rate_limit_event', { p_scope_type: 'ip', p_scope_key: input.ipHash })
  await input.supabase.rpc('register_otp_rate_limit_event', { p_scope_type: 'email', p_scope_key: input.email.toLowerCase() })
  if (input.documentHash) {
    await input.supabase.rpc('register_otp_rate_limit_event', { p_scope_type: 'document', p_scope_key: input.documentHash })
  }
}
