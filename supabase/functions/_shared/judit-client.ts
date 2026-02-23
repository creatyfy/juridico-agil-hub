import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const JUDIT_BASE_URL = 'https://requests.prod.judit.io'

type Json = Record<string, unknown> | unknown[]

let adminClient: ReturnType<typeof createClient> | null = null

function getAdminClient() {
  if (!adminClient) {
    adminClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  }
  return adminClient
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function shouldRetry(status?: number) {
  return !status || status === 429 || status >= 500
}

async function allowCircuit(tenantId: string): Promise<boolean> {
  const svc = getAdminClient()
  const { data, error } = await svc.rpc('judit_circuit_allow', { p_tenant_id: tenantId })
  if (error) throw new Error(`judit_circuit_allow_failed: ${error.message}`)
  return Boolean(data)
}

async function recordCircuit(tenantId: string, success: boolean, statusCode?: number) {
  const svc = getAdminClient()
  await svc.rpc('judit_circuit_record', {
    p_tenant_id: tenantId,
    p_success: success,
    p_status_code: statusCode ?? null,
  })
}

export async function juditRequest(input: {
  tenantKey: string
  apiKey: string
  path: string
  method?: 'GET' | 'POST'
  body?: Json
  timeoutMs?: number
  maxRetries?: number
}) {
  const method = input.method ?? 'GET'
  const timeoutMs = input.timeoutMs ?? 8000
  const maxRetries = input.maxRetries ?? 3

  const allowed = await allowCircuit(input.tenantKey)
  if (!allowed) throw new Error('Judit circuit breaker aberto temporariamente')

  let lastError: string | undefined

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort('timeout'), timeoutMs)

    try {
      const response = await fetch(`${JUDIT_BASE_URL}${input.path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'api-key': input.apiKey,
        },
        body: input.body ? JSON.stringify(input.body) : undefined,
        signal: controller.signal,
      })
      const text = await response.text()
      const data = text ? JSON.parse(text) : null

      if (!response.ok) {
        if (!shouldRetry(response.status) || attempt === maxRetries) {
          await recordCircuit(input.tenantKey, false, response.status)
          throw new Error(`Judit API error [${response.status}]: ${JSON.stringify(data)}`)
        }
        await wait((2 ** (attempt - 1)) * 500 + Math.floor(Math.random() * 200))
        continue
      }

      await recordCircuit(input.tenantKey, true, response.status)
      return data
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      if (attempt === maxRetries) {
        await recordCircuit(input.tenantKey, false)
        throw new Error(lastError)
      }
      await wait((2 ** (attempt - 1)) * 500 + Math.floor(Math.random() * 200))
    } finally {
      clearTimeout(timeout)
    }
  }

  throw new Error(lastError ?? 'Erro desconhecido na Judit API')
}
