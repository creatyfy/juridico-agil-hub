import { beforeEach, describe, expect, it, vi } from 'vitest'

const sentMessages: Array<{ phone: string; text: string }> = []

vi.mock('../../supabase/functions/webhook-whatsapp/services/evolution.ts', () => ({
  sendWhatsAppText: vi.fn(async (_instanceName: string, phone: string, text: string) => {
    sentMessages.push({ phone, text })
  }),
}))

type ConversationState = 'UNVERIFIED' | 'AWAITING_CPF' | 'AWAITING_OTP' | 'VERIFIED'

type DbState = {
  conversas: Array<{ id: string; tenant_id: string; telefone: string; estado: ConversationState; cliente_id: string | null; ultima_interacao: string }>
  clientes: Array<{ id: string; tenant_id: string; cpf: string; nome: string }>
  otp_validacoes: Array<{ id: string; tenant_id: string; telefone: string; otp_hash: string; expires_at: string; tentativas: number }>
  telefones: Array<{ tenant_id: string; cliente_id: string | null; numero: string; verificado: boolean }>
}

function createDbState(): DbState {
  return {
    conversas: [],
    clientes: [
      { id: 'cliente-1', tenant_id: 'tenant-1', cpf: '12345678909', nome: 'Cliente Teste' },
    ],
    otp_validacoes: [],
    telefones: [],
  }
}

class FakeSupabase {
  constructor(private state: DbState) {}

  from(table: keyof DbState | 'telefones') {
    return new QueryBuilder(this.state, table)
  }
}

class QueryBuilder {
  private filters: Record<string, unknown> = {}
  private op: 'select' | 'insert' | 'update' | 'delete' | null = null
  private payload: any = null
  private rows: any[] = []

  constructor(private state: DbState, private table: any) {}

  select(): this {
    this.op = 'select'
    return this
  }

  eq(column: string, value: unknown): this {
    this.filters[column] = value
    return this
  }

  insert(payload: any): this {
    this.op = 'insert'
    this.payload = payload
    const entries = Array.isArray(payload) ? payload : [payload]
    this.rows = entries.map((entry) => ({ id: crypto.randomUUID(), ...entry }))

    const tableRows = (this.state as any)[this.table]
    for (const row of this.rows) tableRows.push(row)
    return this
  }

  update(payload: any): this {
    this.op = 'update'
    this.payload = payload
    return this
  }

  delete(): this {
    this.op = 'delete'
    return this
  }

  upsert(payload: any): Promise<{ data: any; error: null }> {
    const tableRows = this.state.telefones
    const idx = tableRows.findIndex((row) => row.tenant_id === payload.tenant_id && row.numero === payload.numero)
    if (idx >= 0) {
      tableRows[idx] = { ...tableRows[idx], ...payload }
    } else {
      tableRows.push(payload)
    }
    return Promise.resolve({ data: payload, error: null })
  }

  maybeSingle(): Promise<{ data: any; error: null }> {
    return Promise.resolve({ data: this.resolveRows()[0] ?? null, error: null })
  }

  single(): Promise<{ data: any; error: null }> {
    const data = this.rows[0] ?? this.resolveRows()[0] ?? null
    return Promise.resolve({ data, error: null })
  }

  then(resolve: (value: { data: any; error: null }) => unknown) {
    return Promise.resolve({ data: this.executeMutation(), error: null }).then(resolve)
  }

  private executeMutation() {
    const tableRows = (this.state as any)[this.table]

    if (this.op === 'update') {
      const rows = this.resolveRows()
      for (const row of rows) Object.assign(row, this.payload)
      return rows
    }

    if (this.op === 'delete') {
      const rows = this.resolveRows()
      ;(this.state as any)[this.table] = tableRows.filter((row: any) => !rows.includes(row))
      return rows
    }

    if (this.op === 'insert') {
      return this.rows
    }

    return this.resolveRows()
  }

  private resolveRows() {
    const tableRows = (this.state as any)[this.table] ?? []
    return tableRows.filter((row: any) =>
      Object.entries(this.filters).every(([column, value]) => row[column] === value),
    )
  }
}

describe('whatsapp auth flow', () => {
  beforeEach(() => {
    sentMessages.length = 0
    ;(globalThis as any).Deno = {
      env: {
        get: (key: string) => {
          if (key === 'OTP_PEPPER') return 'test-pepper'
          return undefined
        },
      },
    }
  })

  async function makeCtx(state: DbState, message: string) {
    const { handleAuthenticationFlow, isPhoneVerified } = await import('../../supabase/functions/webhook-whatsapp/services/auth.ts')
    const supabase = new FakeSupabase(state)

    const baseCtx = {
      requestId: 'req-1',
      supabase: supabase as any,
      tenantId: 'tenant-1',
      instanceName: 'inst-1',
      instanceId: 'instance-id',
      phone: '5511999999999',
      message,
    }

    return { handleAuthenticationFlow, isPhoneVerified, baseCtx }
  }

  it('authenticates first-time user with valid CPF and OTP', async () => {
    const state = createDbState()

    let ctx = await makeCtx(state, 'Oi')
    await ctx.handleAuthenticationFlow(ctx.baseCtx)

    ctx = await makeCtx(state, '12345678909')
    await ctx.handleAuthenticationFlow(ctx.baseCtx)

    const otpText = sentMessages.at(-1)?.text ?? ''
    const otp = otpText.match(/(\d{6})/)?.[1]
    expect(otp).toBeTruthy()

    ctx = await makeCtx(state, otp!)
    const result = await ctx.handleAuthenticationFlow(ctx.baseCtx)
    const verification = await ctx.isPhoneVerified(ctx.baseCtx)

    expect(result.authenticated).toBe(true)
    expect(verification.verified).toBe(true)
    expect(state.conversas[0]?.estado).toBe('VERIFIED')
  })

  it('rejects invalid CPF and keeps conversation unauthenticated', async () => {
    const state = createDbState()

    let ctx = await makeCtx(state, 'Olá')
    await ctx.handleAuthenticationFlow(ctx.baseCtx)

    ctx = await makeCtx(state, '11111111111')
    const result = await ctx.handleAuthenticationFlow(ctx.baseCtx)

    expect(result.authenticated).toBe(false)
    expect(sentMessages.at(-1)?.text).toContain('CPF inválido')
    expect(state.otp_validacoes).toHaveLength(0)
  })

  it('increments attempts on wrong OTP', async () => {
    const state = createDbState()

    let ctx = await makeCtx(state, 'Oi')
    await ctx.handleAuthenticationFlow(ctx.baseCtx)

    ctx = await makeCtx(state, '12345678909')
    await ctx.handleAuthenticationFlow(ctx.baseCtx)

    ctx = await makeCtx(state, '000000')
    const result = await ctx.handleAuthenticationFlow(ctx.baseCtx)

    expect(result.authenticated).toBe(false)
    expect(state.otp_validacoes[0]?.tentativas).toBe(1)
    expect(sentMessages.at(-1)?.text).toContain('OTP inválido')
  })

  it('rejects expired OTP and resets flow to CPF step', async () => {
    const state = createDbState()

    let ctx = await makeCtx(state, 'Oi')
    await ctx.handleAuthenticationFlow(ctx.baseCtx)

    ctx = await makeCtx(state, '12345678909')
    await ctx.handleAuthenticationFlow(ctx.baseCtx)

    state.otp_validacoes[0].expires_at = new Date(Date.now() - 60_000).toISOString()

    ctx = await makeCtx(state, '123456')
    const result = await ctx.handleAuthenticationFlow(ctx.baseCtx)

    expect(result.authenticated).toBe(false)
    expect(state.conversas[0]?.estado).toBe('AWAITING_CPF')
    expect(state.otp_validacoes).toHaveLength(0)
  })

  it('returns direct access for already validated phone', async () => {
    const state = createDbState()
    state.telefones.push({
      tenant_id: 'tenant-1',
      cliente_id: 'cliente-1',
      numero: '5511999999999',
      verificado: true,
    })

    const ctx = await makeCtx(state, 'status')
    const verification = await ctx.isPhoneVerified(ctx.baseCtx)

    expect(verification.verified).toBe(true)
    expect(verification.clienteId).toBe('cliente-1')
  })

  it('locks brute force attempts after max OTP tries', async () => {
    const state = createDbState()

    let ctx = await makeCtx(state, 'Oi')
    await ctx.handleAuthenticationFlow(ctx.baseCtx)

    ctx = await makeCtx(state, '12345678909')
    await ctx.handleAuthenticationFlow(ctx.baseCtx)

    for (let i = 0; i < 3; i += 1) {
      ctx = await makeCtx(state, '000000')
      await ctx.handleAuthenticationFlow(ctx.baseCtx)
    }

    ctx = await makeCtx(state, '000000')
    const result = await ctx.handleAuthenticationFlow(ctx.baseCtx)

    expect(result.authenticated).toBe(false)
    expect(state.otp_validacoes).toHaveLength(0)
    expect(state.conversas[0]?.estado).toBe('AWAITING_CPF')
    expect(sentMessages.at(-1)?.text).toContain('limite de tentativas')
  })
})
