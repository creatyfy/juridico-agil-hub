import { logError } from './logger.ts'

const EVOLUTION_API_URL = Deno.env.get('EVOLUTION_API_URL')
const EVOLUTION_API_KEY = Deno.env.get('EVOLUTION_API_KEY')
const EVOLUTION_TIMEOUT_MS = Number(Deno.env.get('EVOLUTION_TIMEOUT_MS') ?? '10000')

function headers() {
  return {
    'Content-Type': 'application/json',
    apikey: EVOLUTION_API_KEY ?? '',
  }
}

export function normalizePhone(raw: string): string {
  return raw.replace('@s.whatsapp.net', '').replace('@lid', '').replace(/\D/g, '')
}

export async function sendWhatsAppText(instanceName: string, phone: string, text: string) {
  if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY) {
    logError('evolution_config_missing', { instanceName })
    return
  }

  const number = normalizePhone(phone)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort('timeout'), EVOLUTION_TIMEOUT_MS)

  try {
    const response = await fetch(`${EVOLUTION_API_URL}/message/sendText/${instanceName}`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ number, text }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const detail = await response.text()
      logError('evolution_send_failed', { instanceName, number, status: response.status, detail })
    }
  } catch (error) {
    logError('evolution_send_exception', {
      instanceName,
      number,
      error: error instanceof Error ? error.message : String(error),
    })
  } finally {
    clearTimeout(timeout)
  }
}
