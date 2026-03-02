// @ts-nocheck - Deno edge function
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { computeHmacSha256, sha256Hex, timingSafeEqual } from './security.ts'

const DEFAULT_TIMESTAMP_DRIFT_SECONDS = Number(Deno.env.get('WEBHOOK_ALLOWED_DRIFT_SECONDS') ?? '300')

export type WebhookValidationInput = {
  req: Request
  rawBody: string
  supabase: SupabaseClient
  instanceName: string
}

function parseTimestamp(value: string | null): number | null {
  if (!value) return null
  const timestamp = Number(value)
  if (!Number.isFinite(timestamp)) return null
  return timestamp
}

async function reserveNonce(supabase: SupabaseClient, nonce: string, timestamp: number): Promise<boolean> {
  const nonceHash = await sha256Hex(nonce)
  const { error } = await supabase
    .from('webhook_replay_guard')
    .insert({
      nonce_hash: nonceHash,
      timestamp_seconds: timestamp,
      expires_at: new Date((timestamp + DEFAULT_TIMESTAMP_DRIFT_SECONDS) * 1000).toISOString(),
    })

  return !error
}

export async function validateWebhookSignature(input: WebhookValidationInput): Promise<{ valid: boolean; reason?: string }> {
  const secret = Deno.env.get('WEBHOOK_HMAC_SECRET')
  if (!secret) return { valid: false, reason: 'webhook_secret_not_configured' }

  const timestampHeader = input.req.headers.get('x-webhook-timestamp')
  const nonce = input.req.headers.get('x-webhook-nonce')
  const incomingSignature = input.req.headers.get('x-webhook-signature')

  if (!timestampHeader && !nonce && !incomingSignature) {
    console.warn('[webhook-security] hmac headers not present; skipping signature validation for compatibility', {
      instance_name: input.instanceName,
      reason: 'hmac_skipped_no_headers',
    })
    return { valid: true, reason: 'hmac_skipped_no_headers' }
  }

  const timestamp = parseTimestamp(timestampHeader)

  if (!timestamp || !nonce || !incomingSignature) {
    return { valid: false, reason: 'missing_hmac_headers' }
  }

  const nowSeconds = Math.floor(Date.now() / 1000)
  if (Math.abs(nowSeconds - timestamp) > DEFAULT_TIMESTAMP_DRIFT_SECONDS) {
    return { valid: false, reason: 'timestamp_out_of_range' }
  }

  const signedPayload = `${timestamp}.${nonce}.${input.instanceName}.${input.rawBody}`
  const expectedSignature = await computeHmacSha256(secret, signedPayload)

  if (!timingSafeEqual(expectedSignature, incomingSignature)) {
    return { valid: false, reason: 'invalid_signature' }
  }

  const nonceReserved = await reserveNonce(input.supabase, `${input.instanceName}:${nonce}`, timestamp)
  if (!nonceReserved) return { valid: false, reason: 'replay_detected' }

  return { valid: true }
}
