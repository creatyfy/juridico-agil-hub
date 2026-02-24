-- Guided onboarding activation foundation (3 mandatory steps, lightweight gating support)

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS onboarding_step_workspace_configured_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS onboarding_step_first_case_created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS onboarding_step_first_invite_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS onboarding_block_expires_at TIMESTAMPTZ;

COMMENT ON COLUMN public.tenants.onboarding_step_workspace_configured_at IS
  'Timestamp da etapa 1 obrigatória: configuração inicial do workspace/tenant.';
COMMENT ON COLUMN public.tenants.onboarding_step_first_case_created_at IS
  'Timestamp da etapa 2 obrigatória: primeiro caso/processo criado.';
COMMENT ON COLUMN public.tenants.onboarding_step_first_invite_sent_at IS
  'Timestamp da etapa 3 obrigatória: primeiro convite enviado.';
COMMENT ON COLUMN public.tenants.activated_at IS
  'Data/hora de ativação definitiva do tenant quando as 3 etapas obrigatórias forem concluídas.';
COMMENT ON COLUMN public.tenants.onboarding_block_expires_at IS
  'Fim do bloqueio leve de onboarding. Se nulo, regras de bloqueio usam somente activated_at.';

CREATE OR REPLACE FUNCTION public.complete_tenant_onboarding_step(
  p_step TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID := auth.uid();
  v_now TIMESTAMPTZ := now();
  v_workspace_at TIMESTAMPTZ;
  v_case_at TIMESTAMPTZ;
  v_invite_at TIMESTAMPTZ;
  v_activated_at TIMESTAMPTZ;
  v_allowed_steps TEXT[] := ARRAY[
    'workspace_configured',
    'first_case_created',
    'first_invite_sent'
  ];
BEGIN
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'auth.uid() não disponível';
  END IF;

  IF NOT (p_step = ANY(v_allowed_steps)) THEN
    RAISE EXCEPTION 'Etapa de onboarding inválida: %', p_step;
  END IF;

  INSERT INTO public.tenants (id)
  VALUES (v_tenant_id)
  ON CONFLICT (id) DO NOTHING;

  UPDATE public.tenants t
  SET
    onboarding_step_workspace_configured_at = CASE
      WHEN p_step = 'workspace_configured' AND t.onboarding_step_workspace_configured_at IS NULL THEN v_now
      ELSE t.onboarding_step_workspace_configured_at
    END,
    onboarding_step_first_case_created_at = CASE
      WHEN p_step = 'first_case_created' AND t.onboarding_step_first_case_created_at IS NULL THEN v_now
      ELSE t.onboarding_step_first_case_created_at
    END,
    onboarding_step_first_invite_sent_at = CASE
      WHEN p_step = 'first_invite_sent' AND t.onboarding_step_first_invite_sent_at IS NULL THEN v_now
      ELSE t.onboarding_step_first_invite_sent_at
    END
  WHERE t.id = v_tenant_id;

  SELECT
    t.onboarding_step_workspace_configured_at,
    t.onboarding_step_first_case_created_at,
    t.onboarding_step_first_invite_sent_at,
    t.activated_at
  INTO
    v_workspace_at,
    v_case_at,
    v_invite_at,
    v_activated_at
  FROM public.tenants t
  WHERE t.id = v_tenant_id;

  INSERT INTO public.audit_logs (
    tenant_id,
    user_id,
    action,
    entity,
    entity_id,
    metadata
  ) VALUES (
    v_tenant_id,
    v_tenant_id,
    'tenant_onboarding_step_completed',
    'tenant',
    v_tenant_id::TEXT,
    jsonb_build_object(
      'event_name', 'tenant_onboarding_step_completed',
      'step', p_step,
      'completed_at', v_now
    ) || COALESCE(p_metadata, '{}'::jsonb)
  );

  IF v_workspace_at IS NOT NULL
     AND v_case_at IS NOT NULL
     AND v_invite_at IS NOT NULL
     AND v_activated_at IS NULL THEN
    UPDATE public.tenants
    SET activated_at = v_now,
        onboarding_block_expires_at = v_now
    WHERE id = v_tenant_id
      AND activated_at IS NULL;

    v_activated_at := v_now;

    INSERT INTO public.audit_logs (
      tenant_id,
      user_id,
      action,
      entity,
      entity_id,
      metadata
    ) VALUES (
      v_tenant_id,
      v_tenant_id,
      'tenant_activated',
      'tenant',
      v_tenant_id::TEXT,
      jsonb_build_object(
        'event_name', 'tenant_activated',
        'activation_model', '3_mandatory_steps',
        'activated_at', v_activated_at
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'tenant_id', v_tenant_id,
    'workspace_configured', v_workspace_at IS NOT NULL,
    'first_case_created', v_case_at IS NOT NULL,
    'first_invite_sent', v_invite_at IS NOT NULL,
    'activated', v_activated_at IS NOT NULL,
    'activated_at', v_activated_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_tenant_onboarding_step(TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_tenant_onboarding_step(TEXT, JSONB) TO service_role;

CREATE OR REPLACE VIEW public.v_tenant_activation_funnel AS
SELECT
  t.id AS tenant_id,
  t.created_at AS tenant_created_at,
  t.onboarding_step_workspace_configured_at,
  t.onboarding_step_first_case_created_at,
  t.onboarding_step_first_invite_sent_at,
  t.activated_at,
  (t.onboarding_step_workspace_configured_at IS NOT NULL) AS has_step_1_workspace_configured,
  (t.onboarding_step_first_case_created_at IS NOT NULL) AS has_step_2_first_case_created,
  (t.onboarding_step_first_invite_sent_at IS NOT NULL) AS has_step_3_first_invite_sent,
  (t.activated_at IS NOT NULL) AS is_activated,
  CASE
    WHEN t.activated_at IS NOT NULL THEN EXTRACT(EPOCH FROM (t.activated_at - t.created_at))
    ELSE NULL
  END::BIGINT AS activation_time_seconds
FROM public.tenants t;
