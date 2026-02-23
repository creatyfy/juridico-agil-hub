-- RLS hardening for outbox/operational security tables (idempotent)

DO $$
DECLARE
  v_table text;
  v_tables text[] := ARRAY[
    'message_outbox',
    'outbound_rate_limits',
    'provider_circuit_breakers',
    'provider_circuit_breaker_events',
    'webhook_failures',
    'webhook_replay_guard',
    'whatsapp_auth_rate_limits',
    'outbox_dead_letter_reprocess_log'
  ];
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    IF to_regclass(format('public.%I', v_table)) IS NULL THEN
      RAISE WARNING 'CRÍTICO: tabela public.% não existe. Migração de RLS não aplicada.', v_table;
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', v_table);

    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON TABLE public.%I FROM anon, authenticated', v_table);

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name = v_table
        AND c.column_name = 'tenant_id'
    ) THEN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_policies p
        WHERE p.schemaname = 'public'
          AND p.tablename = v_table
          AND p.policyname = v_table || '_tenant_select'
      ) THEN
        EXECUTE format(
          'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (auth.uid() = tenant_id)',
          v_table || '_tenant_select',
          v_table
        );
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM pg_policies p
        WHERE p.schemaname = 'public'
          AND p.tablename = v_table
          AND p.policyname = v_table || '_service_role_write'
      ) THEN
        EXECUTE format(
          'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
          v_table || '_service_role_write',
          v_table
        );
      END IF;
    ELSE
      RAISE WARNING 'CRÍTICO: tabela public.% sem coluna tenant_id. Policy tenant-aware não pôde ser criada.', v_table;

      IF NOT EXISTS (
        SELECT 1
        FROM pg_policies p
        WHERE p.schemaname = 'public'
          AND p.tablename = v_table
          AND p.policyname = v_table || '_deny_select_authenticated'
      ) THEN
        EXECUTE format(
          'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (false)',
          v_table || '_deny_select_authenticated',
          v_table
        );
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM pg_policies p
        WHERE p.schemaname = 'public'
          AND p.tablename = v_table
          AND p.policyname = v_table || '_service_role_write'
      ) THEN
        EXECUTE format(
          'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
          v_table || '_service_role_write',
          v_table
        );
      END IF;
    END IF;
  END LOOP;
END
$$;
