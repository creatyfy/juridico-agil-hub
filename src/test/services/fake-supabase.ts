export type ConversationState = 'IDLE' | 'WAITING_CPF' | 'WAITING_OTP' | 'WAITING_PROCESS_SELECTION' | 'AUTHENTICATED' | 'HUMAN_REQUIRED'

export type DbState = {
  whatsapp_contacts: Array<{
    id: string
    tenant_id: string
    phone_number: string
    client_id: string | null
    process_id: string | null
    verified: boolean
    conversation_state: ConversationState
    notifications_opt_in?: boolean
    cpf_attempts: number
    otp_attempts: number
    blocked_until: string | null
    last_notification_sent_at?: string | null
    updated_at?: string
  }>
  clientes: Array<{ id: string; tenant_id: string; cpf: string; nome: string }>
  cliente_processos: Array<{ id: string; cliente_id: string; processo_id: string; status: string }>
  processos: Array<{ id: string; user_id: string; numero_cnj: string }>
  process_movement_notifications: Array<{ id: string; tenant_id: string; process_id: string; movement_id: string; contact_id: string; notified_at: string }>
  otp_validacoes: Array<{ id: string; tenant_id: string; telefone: string; otp_hash: string; expires_at: string; tentativas: number }>
  whatsapp_auth_rate_limits: Array<{ id: string; tenant_id: string; scope_type: 'PHONE' | 'TENANT_CPF'; scope_hash: string; window_start: string; counter: number }>
  webhook_replay_guard: Array<{ id: string; nonce_hash: string; timestamp_seconds: number; expires_at: string }>
  conversas?: any[]
  telefones?: any[]
}

type AtomicOptions = {
  mode?: 'increment' | 'windowed_increment'
  column?: string
  initial?: number
  windowSeconds?: number
  now?: string
}

export function createDbState(): DbState {
  return {
    whatsapp_contacts: [],
    clientes: [{ id: 'cliente-1', tenant_id: 'tenant-1', cpf: '12345678909', nome: 'Cliente Teste' }],
    cliente_processos: [{ id: 'cp-1', cliente_id: 'cliente-1', processo_id: 'processo-1', status: 'ativo' }],
    processos: [{ id: 'processo-1', user_id: 'tenant-1', numero_cnj: '0001234-56.2024.8.26.0100' }],
    process_movement_notifications: [],
    otp_validacoes: [],
    whatsapp_auth_rate_limits: [],
    webhook_replay_guard: [],
    conversas: [],
    telefones: [],
  }
}

export class FakeSupabase {
  constructor(private state: DbState) {}

  from(table: keyof DbState | string) {
    return new QueryBuilder(this.state as any, table as any)
  }
}

class QueryBuilder {
  private filters: Record<string, unknown> = {}
  private op: 'select' | 'insert' | 'update' | 'delete' | null = null
  private payload: any = null
  private rows: any[] = []

  constructor(private state: Record<string, any[]>, private table: string) {}

  select(): this {
    this.op = 'select'
    return this
  }

  eq(column: string, value: unknown): this {
    this.filters[column] = value
    return this
  }

  not(): this { return this }

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

  upsert(payload: any, options?: { onConflict?: string; atomic?: AtomicOptions }): Promise<{ data: any; error: any }> {
    const tableRows = this.getRows()
    const conflictColumns = (options?.onConflict ?? '').split(',').map((value) => value.trim()).filter(Boolean)

    const inferredConflictColumns = conflictColumns.length
      ? conflictColumns
      : this.table === 'otp_validacoes'
        ? ['tenant_id', 'telefone']
        : this.table === 'whatsapp_auth_rate_limits'
          ? ['tenant_id', 'scope_type', 'scope_hash']
          : this.table === 'whatsapp_contacts'
            ? ['tenant_id', 'phone_number']
            : []

    const idx = inferredConflictColumns.length
      ? tableRows.findIndex((row: any) => inferredConflictColumns.every((column) => row[column] === payload[column]))
      : -1

    if (idx === -1) {
      const inserted = { id: crypto.randomUUID(), ...payload }
      tableRows.push(inserted)
      return Promise.resolve({ data: inserted, error: null })
    }

    if (options?.atomic?.mode === 'increment') {
      const column = options.atomic.column ?? 'counter'
      const current = Number(tableRows[idx][column] ?? 0)
      const incremented = current + 1
      tableRows[idx] = { ...tableRows[idx], ...payload, [column]: incremented }
      return Promise.resolve({ data: tableRows[idx], error: null })
    }

    if (options?.atomic?.mode === 'windowed_increment') {
      const column = options.atomic.column ?? 'counter'
      const now = new Date(options.atomic.now ?? new Date().toISOString())
      const windowSeconds = options.atomic.windowSeconds ?? 300
      const previousWindow = new Date(tableRows[idx].window_start)
      const withinWindow = now.getTime() - previousWindow.getTime() <= windowSeconds * 1000

      if (!withinWindow) {
        tableRows[idx] = { ...tableRows[idx], ...payload, [column]: options.atomic.initial ?? 1, window_start: now.toISOString() }
      } else {
        tableRows[idx] = { ...tableRows[idx], ...payload, [column]: Number(tableRows[idx][column] ?? 0) + 1 }
      }

      return Promise.resolve({ data: tableRows[idx], error: null })
    }

    tableRows[idx] = { ...tableRows[idx], ...payload }
    return Promise.resolve({ data: tableRows[idx], error: null })
  }

  order(): this { return this }
  limit(): this { return this }
  in(): this { return this }

  maybeSingle(): Promise<{ data: any; error: any }> {
    if (this.table === 'webhook_replay_guard' && this.payload?.error) return Promise.resolve({ data: null, error: this.payload.error })
    return Promise.resolve({ data: this.resolveRows()[0] ?? null, error: null })
  }

  single(): Promise<{ data: any; error: null }> {
    const data = this.rows[0] ?? this.resolveRows()[0] ?? null
    return Promise.resolve({ data, error: null })
  }

  then(resolve: (value: { data: any; error: any }) => unknown) {
    if (this.table === 'webhook_replay_guard' && this.payload?.error) return Promise.resolve({ data: null, error: this.payload.error }).then(resolve)
    return Promise.resolve({ data: this.executeMutation(), error: null }).then(resolve)
  }

  private getRows(): any[] {
    if (!this.state[this.table]) this.state[this.table] = []
    return this.state[this.table]
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
      this.state[this.table] = tableRows.filter((row: any) => !rows.includes(row))
      return rows
    }

    return this.rows.length ? this.rows : this.resolveRows()
  }

  private resolveRows() {
    const tableRows = this.getRows()
    const rows = tableRows.filter((row: any) => Object.entries(this.filters).every(([column, value]) => row[column] === value))

    if (this.table === 'cliente_processos') {
      return rows.map((row: any) => ({
        ...row,
        processos: this.state.processos?.find((p: any) => p.id === row.processo_id) ?? null,
      }))
    }

    return rows
  }
}
