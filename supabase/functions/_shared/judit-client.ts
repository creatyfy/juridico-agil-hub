const JUDIT_BASE_URL = 'https://requests.prod.judit.io'

type Json = Record<string, unknown> | unknown[]

type CircuitState = {
  failures: number
  openedAt: number | null
}

const circuitByTenant = new Map<string, CircuitState>()

function getState(tenantKey: string): CircuitState {
  if (!circuitByTenant.has(tenantKey)) {
    circuitByTenant.set(tenantKey, { failures: 0, openedAt: null })
  }
  return circuitByTenant.get(tenantKey)!
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function shouldRetry(status?: number) {
  return !status || status === 429 || status >= 500
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
  const state = getState(input.tenantKey)
  const now = Date.now()

  if (state.openedAt && now - state.openedAt < 30_000) {
    throw new Error('Judit circuit breaker aberto temporariamente')
  }

  let lastError: string | undefined

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)

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
        if (response.status === 429) {
          console.warn(JSON.stringify({ provider: 'judit', type: 'rate_limit', tenant: input.tenantKey, attempt }))
        }
        if (!shouldRetry(response.status) || attempt === maxRetries) {
          state.failures += 1
          if (state.failures >= 5) state.openedAt = Date.now()
          throw new Error(`Judit API error [${response.status}]: ${JSON.stringify(data)}`)
        }
        await wait((2 ** (attempt - 1)) * 500 + Math.floor(Math.random() * 200))
        continue
      }

      state.failures = 0
      state.openedAt = null
      console.log(JSON.stringify({ provider: 'judit', type: 'success', tenant: input.tenantKey, path: input.path, attempt }))
      return data
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      const timedOut = lastError.includes('aborted')
      if (!timedOut && attempt === maxRetries) {
        state.failures += 1
        if (state.failures >= 5) state.openedAt = Date.now()
        throw new Error(lastError)
      }
      if (attempt === maxRetries) {
        state.failures += 1
        if (state.failures >= 5) state.openedAt = Date.now()
        throw new Error(lastError)
      }
      await wait((2 ** (attempt - 1)) * 500 + Math.floor(Math.random() * 200))
    } finally {
      clearTimeout(timeout)
    }
  }

  throw new Error(lastError ?? 'Erro desconhecido na Judit API')
}
