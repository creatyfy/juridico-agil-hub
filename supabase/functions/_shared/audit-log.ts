import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface TenantAuditActionInput {
  tenantId: string;
  userId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
}

export async function logTenantAction(
  supabase: SupabaseClient,
  input: TenantAuditActionInput,
): Promise<void> {
  const { error } = await supabase
    .from("audit_logs")
    .insert({
      tenant_id: input.tenantId,
      user_id: input.userId ?? null,
      action: input.action,
      entity: input.entity,
      entity_id: input.entityId ?? null,
      metadata: input.metadata ?? {},
    });

  if (error) {
    console.error("audit_log_insert_error", {
      action: input.action,
      entity: input.entity,
      tenantId: input.tenantId,
      entityId: input.entityId ?? null,
      code: error.code,
      message: error.message,
    });
  }
}
