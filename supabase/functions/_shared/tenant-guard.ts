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
