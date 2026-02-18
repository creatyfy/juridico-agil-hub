export type ConversationState = 'UNVERIFIED' | 'AWAITING_CPF' | 'AWAITING_OTP' | 'VERIFIED'

export type DbState = {
  conversas: Array<{ id: string; tenant_id: string; telefone: string; estado: ConversationState; cliente_id: string | null; ultima_interacao: string }>
  clientes: Array<{ id: string; tenant_id: string; cpf: string; nome: string }>
  otp_validacoes: Array<{ id: string; tenant_id: string; telefone: string; otp_hash: string; expires_at: string; tentativas: number }>
  telefones: Array<{ tenant_id: string; cliente_id: string | null; numero: string; verificado: boolean }>
  whatsapp_auth_rate_limits: Array<{ id: string; tenant_id: string; scope_type: 'PHONE' | 'TENANT_CPF'; scope_hash: string; window_start: string; counter: number }>
  webhook_replay_guard: Array<{ id: string; nonce_hash: string; timestamp_seconds: number; expires_at: string }>
}

export function createDbState(): DbState {
  return {
    conversas: [],
    clientes: [{ id: 'cliente-1', tenant_id: 'tenant-1', cpf: '12345678909', nome: 'Cliente Teste' }],
    otp_validacoes: [],
    telefones: [],
    whatsapp_auth_rate_limits: [],
    webhook_replay_guard: [],
  }
}

export class FakeSupabase {
  constructor(private state: DbState) {}

  from(table: keyof DbState) {
    return new QueryBuilder(this.state, table)
  }
}

class QueryBuilder {
  private filters: Record<string, unknown> = {}
  private op: 'select' | 'insert' | 'update' | 'delete' | null = null
  private payload: any = null
  private rows: any[] = []

  constructor(private state: DbState, private table: keyof DbState) {}

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
    const entries = Array.isArray(payload) ? payload : [payload]

    if (this.table === 'webhook_replay_guard') {
      const tableRows = this.getRows()
      const duplicate = tableRows.find((row: any) => row.nonce_hash === entries[0]?.nonce_hash)
      if (duplicate) {
        this.rows = []
        this.payload = { error: { message: 'duplicate' } }
        return this
      }
    }

    this.rows = entries.map((entry) => ({ id: crypto.randomUUID(), ...entry }))
    this.getRows().push(...this.rows)
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

  upsert(payload: any): Promise<{ data: any; error: any }> {
    const tableRows = this.getRows()

    if (this.table === 'telefones') {
      const idx = tableRows.findIndex((row: any) => row.tenant_id === payload.tenant_id && row.numero === payload.numero)
      if (idx >= 0) tableRows[idx] = { ...tableRows[idx], ...payload }
      else tableRows.push(payload)
      return Promise.resolve({ data: payload, error: null })
    }

    if (this.table === 'otp_validacoes') {
      const idx = tableRows.findIndex((row: any) => row.tenant_id === payload.tenant_id && row.telefone === payload.telefone)
      if (idx >= 0) tableRows[idx] = { ...tableRows[idx], ...payload }
      else tableRows.push({ id: crypto.randomUUID(), ...payload })
      return Promise.resolve({ data: payload, error: null })
    }

    if (this.table === 'whatsapp_auth_rate_limits') {
      const idx = tableRows.findIndex((row: any) => row.tenant_id === payload.tenant_id
        && row.scope_type === payload.scope_type
        && row.scope_hash === payload.scope_hash)
      if (idx >= 0) tableRows[idx] = { ...tableRows[idx], ...payload }
      else tableRows.push({ id: crypto.randomUUID(), ...payload })
      return Promise.resolve({ data: payload, error: null })
    }

    return Promise.resolve({ data: payload, error: null })
  }

  order(): this { return this }
  limit(): this { return this }
  in(): this { return this }

  maybeSingle(): Promise<{ data: any; error: any }> {
    if (this.table === 'webhook_replay_guard' && this.payload?.error) {
      return Promise.resolve({ data: null, error: this.payload.error })
    }

    return Promise.resolve({ data: this.resolveRows()[0] ?? null, error: null })
  }

  single(): Promise<{ data: any; error: null }> {
    const data = this.rows[0] ?? this.resolveRows()[0] ?? null
    return Promise.resolve({ data, error: null })
  }

  then(resolve: (value: { data: any; error: any }) => unknown) {
    if (this.table === 'webhook_replay_guard' && this.payload?.error) {
      return Promise.resolve({ data: null, error: this.payload.error }).then(resolve)
    }

    return Promise.resolve({ data: this.executeMutation(), error: null }).then(resolve)
  }

  private getRows(): any[] {
    return (this.state[this.table] as any[]) ?? []
  }

  private executeMutation() {
    const tableRows = this.getRows()

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

    return this.rows.length ? this.rows : this.resolveRows()
  }

  private resolveRows() {
    const tableRows = this.getRows()
    return tableRows.filter((row: any) => Object.entries(this.filters).every(([column, value]) => row[column] === value))
  }
}
