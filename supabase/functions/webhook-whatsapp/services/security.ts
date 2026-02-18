const OTP_DIGITS = 6

export function normalizeCpf(value: string): string {
  return value.replace(/\D/g, '')
}

export function normalizeOtp(value: string): string {
  return value.replace(/\D/g, '')
}

export function isValidCpf(rawCpf: string): boolean {
  const cpf = normalizeCpf(rawCpf)
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false

  const calcCheck = (base: string, factor: number) => {
    let total = 0
    for (const digit of base) {
      total += Number(digit) * factor
      factor -= 1
    }
    const rest = (total * 10) % 11
    return rest === 10 ? 0 : rest
  }

  const d1 = calcCheck(cpf.slice(0, 9), 10)
  const d2 = calcCheck(cpf.slice(0, 10), 11)
  return d1 === Number(cpf[9]) && d2 === Number(cpf[10])
}

export function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false

  let mismatch = 0
  for (let i = 0; i < left.length; i += 1) {
    mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i)
  }

  return mismatch === 0
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function generateSecureOtp(digits = OTP_DIGITS): string {
  const random = new Uint32Array(digits)
  crypto.getRandomValues(random)
  return [...random].map((value) => String(value % 10)).join('')
}

export async function sha256Hex(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return toHex(digest)
}

export async function hashOtp(tenantId: string, phone: string, otp: string): Promise<string> {
  const pepper = Deno.env.get('OTP_PEPPER')
  if (!pepper) throw new Error('otp_pepper_not_configured')

  return sha256Hex(`${tenantId}:${phone}:${otp}:${pepper}`)
}

export async function computeHmacSha256(secret: string, payload: string): Promise<string> {
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

export function maskCpf(cpf: string): string {
  const normalized = normalizeCpf(cpf)
  if (normalized.length < 4) return '***'
  return `***.***.***-${normalized.slice(-2)}`
}

export function maskPhone(phone: string): string {
  const normalized = phone.replace(/\D/g, '')
  if (normalized.length < 4) return '***'
  const visible = normalized.slice(-4)
  return `***${visible}`
}
