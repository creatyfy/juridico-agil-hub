import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export type NotificationRow = {
  id: string
  tenant_id: string
  process_id: string
  retry_count: number
  type: string
}

type GatewayProvider = 'evolution' | 'generic'

const DEFAULT_TIMEOUT_MS = Number(Deno.env.get('NOTIFICATIONS_GATEWAY_TIMEOUT_MS') ?? '10000')

function sanitizePhone(phone: string): string {
  return phone.replace(/\D/g, '')
}

function maskPhone(phone: string): string {
  const normalized = sanitizePhone(phone)
  if (normalized.length <= 4) return '****'
  return `${'*'.repeat(Math.max(normalized.length - 4, 1))}${normalized.slice(-4)}`
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort('timeout'), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

export async function sendNotification(
  supabase: SupabaseClient,
  notification: NotificationRow,
): Promise<{ providerMessageId: string; gatewayStatus: number; gatewayBody: unknown }> {
  const { data: processRow, error: processError } = await supabase
    .from('processos')
    .select('id, user_id, numero_cnj')
    .eq('id', notification.process_id)
    .maybeSingle()

  if (processError) {
    throw new Error(`process_lookup_error:${processError.message}`)
  }

  if (!processRow || processRow.user_id !== notification.tenant_id) {
    throw new Error('process_not_found_or_tenant_mismatch')
  }

  const { data: instanceRow, error: instanceError } = await supabase
    .from('whatsapp_instancias')
    .select('instance_name, phone_number, status')
    .eq('user_id', notification.tenant_id)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (instanceError) {
    throw new Error(`instance_lookup_error:${instanceError.message}`)
  }

  if (!instanceRow?.phone_number) {
    throw new Error('lawyer_phone_not_configured')
  }

  const destinationPhone = sanitizePhone(instanceRow.phone_number)
  const processNumber = processRow.numero_cnj
  const message = `Seu processo ${processNumber} teve nova movimentação. Acesse a plataforma para ver detalhes.`

  const provider = (Deno.env.get('WHATSAPP_GATEWAY_PROVIDER') ?? 'evolution').toLowerCase() as GatewayProvider
  const timeoutMs = Number(Deno.env.get('NOTIFICATIONS_GATEWAY_TIMEOUT_MS') ?? DEFAULT_TIMEOUT_MS)

  let url = ''
  let headers: Record<string, string> = { 'Content-Type': 'application/json' }
  let body: Record<string, unknown> = {}

  if (provider === 'evolution') {
    const evolutionApiUrl = Deno.env.get('EVOLUTION_API_URL')
    const evolutionApiKey = Deno.env.get('EVOLUTION_API_KEY')
    if (!evolutionApiUrl || !evolutionApiKey) {
      throw new Error('evolution_env_not_configured')
    }

    if (instanceRow.status !== 'connected') {
      throw new Error(`whatsapp_instance_not_connected:${instanceRow.status}`)
    }

    url = `${evolutionApiUrl}/message/sendText/${instanceRow.instance_name}`
    headers.apikey = evolutionApiKey
    body = {
      number: destinationPhone,
      text: message,
    }
  } else {
    const gatewayUrl = Deno.env.get('WHATSAPP_GATEWAY_URL')
    const gatewayToken = Deno.env.get('WHATSAPP_GATEWAY_TOKEN')
    if (!gatewayUrl) {
      throw new Error('generic_gateway_url_not_configured')
    }

    if (gatewayToken) headers.Authorization = `Bearer ${gatewayToken}`
    url = gatewayUrl
    body = {
      tenant_id: notification.tenant_id,
      process_id: notification.process_id,
      to: destinationPhone,
      message,
    }
  }

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  }, timeoutMs)

  const gatewayBody = await response.json().catch(() => ({}))

  console.log(JSON.stringify({
    level: 'info',
    event: 'notifications_gateway_response',
    notification_id: notification.id,
    tenant_id: notification.tenant_id,
    process_id: notification.process_id,
    provider,
    http_status: response.status,
    destination_masked: maskPhone(destinationPhone),
    gateway_body: gatewayBody,
  }))

  if (!response.ok) {
    throw new Error(`gateway_http_error:${response.status}`)
  }

  const providerMessageId = String(
    (gatewayBody as Record<string, unknown>)?.['messageId']
      ?? (gatewayBody as Record<string, unknown>)?.['id']
      ?? (gatewayBody as Record<string, unknown>)?.['key']
      ?? crypto.randomUUID(),
  )

  return {
    providerMessageId,
    gatewayStatus: response.status,
    gatewayBody,
  }
}
