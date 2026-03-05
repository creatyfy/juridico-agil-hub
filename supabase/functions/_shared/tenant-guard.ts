export class ForbiddenTenantAccessError extends Error {
  constructor(message = 'forbidden_tenant_scope') {
    super(message)
    this.name = 'ForbiddenTenantAccessError'
  }
}

export function assertTenantScope(resourceTenantId: string | null | undefined, contextTenantId: string | null | undefined): void {
  if (!resourceTenantId || !contextTenantId || resourceTenantId !== contextTenantId) {
    throw new ForbiddenTenantAccessError()
  }
}

export async function tenantWriteGuard(input: {
  // deno-lint-ignore no-explicit-any
  supabase: any
  tenantIdFromContext: string
  resourceId: string
  resourceTable: 'cliente_processos' | 'convites_vinculacao' | 'campaign_recipients' | 'campaign_jobs' | 'message_outbox'
}): Promise<void> {
  const { error } = await input.supabase.rpc('tenant_write_guard', {
    p_tenant_id: input.tenantIdFromContext,
    p_resource_id: input.resourceId,
    p_resource_table: input.resourceTable,
  })

  if (!error) return

  // Fallback: some environments may not have tenant_write_guard yet
  if (error.message?.includes('Could not find the function public.tenant_write_guard')) {
    const tenantColumnByTable = {
      cliente_processos: 'advogado_user_id',
      convites_vinculacao: 'advogado_user_id',
      campaign_recipients: 'tenant_id',
      campaign_jobs: 'tenant_id',
      message_outbox: 'tenant_id',
    } as const

    const tenantColumn = tenantColumnByTable[input.resourceTable]
    const { data: row, error: rowError } = await input.supabase
      .from(input.resourceTable)
      .select(`id, ${tenantColumn}`)
      .eq('id', input.resourceId)
      .maybeSingle()

    if (rowError || !row) {
      throw new ForbiddenTenantAccessError(rowError?.message || 'forbidden_tenant_scope')
    }

    assertTenantScope(row[tenantColumn], input.tenantIdFromContext)
    return
  }

  throw new ForbiddenTenantAccessError(error.message)
}
