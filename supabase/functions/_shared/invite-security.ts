const encoder = new TextEncoder()

function toBase64Url(input: string): string {
  return btoa(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(input: string): string {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  return atob(padded)
}

async function hmacSha256(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
  const bytes = Array.from(new Uint8Array(signature)).map((b) => String.fromCharCode(b)).join('')
  return toBase64Url(bytes)
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i += 1) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}

export type InviteTokenClaims = {
  tenant_id: string
  cliente_id: string
  identity_hint: string
  nonce: string
  invite_id: string
  exp: number
  iat: number
}

export async function signInviteJwt(claims: Omit<InviteTokenClaims, 'iat' | 'exp'> & { ttlSeconds?: number }, secret: string): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' }
  const iat = Math.floor(Date.now() / 1000)
  const exp = iat + (claims.ttlSeconds ?? 900)
  const payload: InviteTokenClaims = { ...claims, iat, exp }
  const encodedHeader = toBase64Url(JSON.stringify(header))
  const encodedPayload = toBase64Url(JSON.stringify(payload))
  const signingInput = `${encodedHeader}.${encodedPayload}`
  const signature = await hmacSha256(secret, signingInput)
  return `${signingInput}.${signature}`
}

export async function verifyInviteJwt(token: string, secret: string): Promise<InviteTokenClaims> {
  const [encodedHeader, encodedPayload, signature] = token.split('.')
  if (!encodedHeader || !encodedPayload || !signature) throw new Error('invalid_invite_token')

  const parsedHeader = JSON.parse(fromBase64Url(encodedHeader)) as { alg?: string; typ?: string }
  if (parsedHeader.alg !== 'HS256' || parsedHeader.typ !== 'JWT') {
    throw new Error('invalid_invite_token_header')
  }

  const signingInput = `${encodedHeader}.${encodedPayload}`
  const expectedSignature = await hmacSha256(secret, signingInput)
  if (!timingSafeEqual(expectedSignature, signature)) throw new Error('invalid_invite_token_signature')

  const payload = JSON.parse(fromBase64Url(encodedPayload)) as InviteTokenClaims
  const now = Math.floor(Date.now() / 1000)
  if (!payload.exp || !payload.iat) throw new Error('invalid_invite_token_claims')
  if (payload.exp < now - 30) throw new Error('invite_token_expired')
  if (payload.iat > now + 30) throw new Error('invite_token_clock_skew_exceeded')

  return payload
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function maskedIdentity(email: string | null, documento: string | null): string {
  const source = (email ?? documento ?? '').toLowerCase().replace(/\s+/g, '')
  return source.slice(0, 6)
}
