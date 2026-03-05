// @ts-nocheck - Deno edge function
export const OTP_TTL_MINUTES = Number(Deno.env.get('OTP_TTL_MINUTES') ?? '5')
export const OTP_MAX_ATTEMPTS = Number(Deno.env.get('OTP_MAX_ATTEMPTS') ?? '3')

export const AUTH_MESSAGES = {
  ASK_CPF: 'Olá! Para continuar, informe seu CPF (somente números).',
  INVALID_OR_UNKNOWN_CPF: 'Não foi possível validar seu cadastro. Revise o CPF e tente novamente.',
  OTP_SENT: `Seu código de verificação foi enviado. Ele expira em ${OTP_TTL_MINUTES} minutos.`,
  OTP_INVALID: 'Código inválido ou expirado. Tente novamente.',
  OTP_FORMAT: 'Envie exatamente os 6 dígitos do código de verificação.',
  OTP_EXPIRED: 'Código expirado. Envie seu CPF para gerar um novo OTP.',
  OTP_LOCKED: 'Você atingiu o limite de tentativas. Envie seu CPF para reiniciar o processo.',
  VERIFIED: 'Verificação concluída com sucesso. Como posso ajudar você hoje?',
} as const

export function unifiedErrorResponse(requestId: string, code: string, status = 400): Response {
  return new Response(JSON.stringify({ ok: false, request_id: requestId, error: code }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
