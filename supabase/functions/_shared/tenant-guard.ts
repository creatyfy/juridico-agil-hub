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

  if (error) {
    throw new ForbiddenTenantAccessError(error.message)
  }
}
