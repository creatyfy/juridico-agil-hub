-- Guided onboarding for first-time lawyers (advogados)

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.tenant_onboarding_progress (
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  step TEXT NOT NULL CHECK (step IN (
    'import_first_process_judit',
    'link_first_client_to_process',
    'activate_notifications'
  )),
  completed_at TIMESTAMPTZ,
  PRIMARY KEY (tenant_id, step)
);

ALTER TABLE public.tenant_onboarding_progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own onboarding progress" ON public.tenant_onboarding_progress;
CREATE POLICY "Users can read own onboarding progress"
ON public.tenant_onboarding_progress
FOR SELECT TO authenticated
USING (tenant_id = auth.uid());

DROP POLICY IF EXISTS "Service role full access onboarding progress" ON public.tenant_onboarding_progress;
CREATE POLICY "Service role full access onboarding progress"
ON public.tenant_onboarding_progress
FOR ALL TO service_role
USING (true)
WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.complete_tenant_onboarding_step_for_tenant(
  p_tenant_id UUID,
  p_step TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := now();
  v_completed_steps INTEGER;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'tenant_id é obrigatório';
  END IF;

  IF p_step NOT IN ('import_first_process_judit', 'link_first_client_to_process', 'activate_notifications') THEN
    RAISE EXCEPTION 'Etapa de onboarding inválida: %', p_step;
  END IF;

  INSERT INTO public.tenants (id) VALUES (p_tenant_id)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.tenant_onboarding_progress (tenant_id, step, completed_at)
  VALUES (p_tenant_id, p_step, v_now)
  ON CONFLICT (tenant_id, step)
  DO UPDATE SET completed_at = COALESCE(tenant_onboarding_progress.completed_at, EXCLUDED.completed_at);

  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity, entity_id, metadata)
  VALUES (
    p_tenant_id,
    p_tenant_id,
    'onboarding_step_completed',
    'tenant_onboarding',
    p_tenant_id::TEXT,
    jsonb_build_object('event_name', 'onboarding_step_completed', 'step', p_step, 'completed_at', v_now) || COALESCE(p_metadata, '{}'::jsonb)
  );

  SELECT COUNT(*)::INTEGER
    INTO v_completed_steps
  FROM public.tenant_onboarding_progress
  WHERE tenant_id = p_tenant_id
    AND completed_at IS NOT NULL;

  IF v_completed_steps >= 3 THEN
    UPDATE public.tenants
    SET onboarding_completed = true,
        activated_at = COALESCE(activated_at, v_now),
        onboarding_block_expires_at = COALESCE(onboarding_block_expires_at, v_now)
    WHERE id = p_tenant_id
      AND onboarding_completed = false;

    IF FOUND THEN
      INSERT INTO public.audit_logs (tenant_id, user_id, action, entity, entity_id, metadata)
      VALUES (
        p_tenant_id,
        p_tenant_id,
        'onboarding_completed',
        'tenant_onboarding',
        p_tenant_id::TEXT,
        jsonb_build_object('event_name', 'onboarding_completed', 'completed_at', v_now)
      );
    END IF;
  END IF;

  RETURN jsonb_build_object('tenant_id', p_tenant_id, 'step', p_step, 'completed_steps', v_completed_steps, 'onboarding_completed', v_completed_steps >= 3);
END;
$$;

CREATE OR REPLACE FUNCTION public.start_tenant_onboarding_step(
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
BEGIN
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'auth.uid() não disponível';
  END IF;

  IF p_step NOT IN ('import_first_process_judit', 'link_first_client_to_process', 'activate_notifications') THEN
    RAISE EXCEPTION 'Etapa de onboarding inválida: %', p_step;
  END IF;

  INSERT INTO public.tenants (id) VALUES (v_tenant_id)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.tenant_onboarding_progress (tenant_id, step, completed_at)
  VALUES (v_tenant_id, p_step, NULL)
  ON CONFLICT (tenant_id, step) DO NOTHING;

  INSERT INTO public.audit_logs (tenant_id, user_id, action, entity, entity_id, metadata)
  VALUES (
    v_tenant_id,
    v_tenant_id,
    'onboarding_step_started',
    'tenant_onboarding',
    v_tenant_id::TEXT,
    jsonb_build_object('event_name', 'onboarding_step_started', 'step', p_step, 'started_at', now()) || COALESCE(p_metadata, '{}'::jsonb)
  );

  RETURN jsonb_build_object('ok', true, 'tenant_id', v_tenant_id, 'step', p_step);
END;
$$;

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
BEGIN
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'auth.uid() não disponível';
  END IF;

  RETURN public.complete_tenant_onboarding_step_for_tenant(v_tenant_id, p_step, p_metadata);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_tenant_onboarding_status()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID := auth.uid();
  v_process_count INTEGER := 0;
  v_step1_completed BOOLEAN := false;
  v_step2_completed BOOLEAN := false;
  v_step3_completed BOOLEAN := false;
  v_onboarding_completed BOOLEAN := false;
BEGIN
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'auth.uid() não disponível';
  END IF;

  INSERT INTO public.tenants (id) VALUES (v_tenant_id)
  ON CONFLICT (id) DO NOTHING;

  SELECT COUNT(*)::INTEGER INTO v_process_count
  FROM public.processos p
  WHERE p.user_id = v_tenant_id;

  SELECT
    EXISTS (SELECT 1 FROM public.tenant_onboarding_progress top WHERE top.tenant_id = v_tenant_id AND top.step = 'import_first_process_judit' AND top.completed_at IS NOT NULL),
    EXISTS (SELECT 1 FROM public.tenant_onboarding_progress top WHERE top.tenant_id = v_tenant_id AND top.step = 'link_first_client_to_process' AND top.completed_at IS NOT NULL),
    EXISTS (SELECT 1 FROM public.tenant_onboarding_progress top WHERE top.tenant_id = v_tenant_id AND top.step = 'activate_notifications' AND top.completed_at IS NOT NULL),
    COALESCE(t.onboarding_completed, false)
  INTO v_step1_completed, v_step2_completed, v_step3_completed, v_onboarding_completed
  FROM public.tenants t
  WHERE t.id = v_tenant_id;

  RETURN jsonb_build_object(
    'tenant_id', v_tenant_id,
    'is_first_access', v_process_count = 0,
    'onboarding_completed', v_onboarding_completed,
    'steps', jsonb_build_array(
      jsonb_build_object('step', 'import_first_process_judit', 'completed', v_step1_completed),
      jsonb_build_object('step', 'link_first_client_to_process', 'completed', v_step2_completed),
      jsonb_build_object('step', 'activate_notifications', 'completed', v_step3_completed)
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_complete_onboarding_step_from_process_import()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.fonte = 'judit' THEN
    PERFORM public.complete_tenant_onboarding_step_for_tenant(
      NEW.user_id,
      'import_first_process_judit',
      jsonb_build_object('source', 'trigger_processos_insert', 'processo_id', NEW.id)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_complete_onboarding_step_process_import ON public.processos;
CREATE TRIGGER trg_auto_complete_onboarding_step_process_import
AFTER INSERT ON public.processos
FOR EACH ROW EXECUTE FUNCTION public.auto_complete_onboarding_step_from_process_import();

CREATE OR REPLACE FUNCTION public.auto_complete_onboarding_step_from_cliente_vinculo()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.complete_tenant_onboarding_step_for_tenant(
    NEW.advogado_user_id,
    'link_first_client_to_process',
    jsonb_build_object('source', 'trigger_cliente_processos_insert', 'cliente_processo_id', NEW.id, 'processo_id', NEW.processo_id, 'cliente_id', NEW.cliente_id)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_complete_onboarding_step_cliente_vinculo ON public.cliente_processos;
CREATE TRIGGER trg_auto_complete_onboarding_step_cliente_vinculo
AFTER INSERT ON public.cliente_processos
FOR EACH ROW EXECUTE FUNCTION public.auto_complete_onboarding_step_from_cliente_vinculo();

CREATE OR REPLACE VIEW public.v_tenant_health_score AS
WITH usage_base AS (
  SELECT tu.tenant_id, COALESCE(tu.current_usage, 0)::numeric AS current_usage, COALESCE(tu.max_usage, 0)::numeric AS max_usage
  FROM public.tenant_usage tu
),
metrics_30d AS (
  SELECT
    al.tenant_id,
    COUNT(*) FILTER (WHERE al.created_at >= now() - interval '30 days')::numeric AS eventos_30d,
    COUNT(DISTINCT al.user_id) FILTER (WHERE al.created_at >= now() - interval '30 days' AND al.user_id IS NOT NULL)::numeric AS usuarios_ativos_30d,
    COUNT(*) FILTER (
      WHERE al.created_at >= now() - interval '30 days'
        AND (COALESCE(al.metadata->>'plan_tier', '') = 'premium' OR COALESCE(al.metadata->>'feature_tier', '') = 'premium' OR COALESCE(al.metadata->>'event_name', '') IN ('primeira_feature_premium', 'feature_premium_used'))
    )::numeric AS eventos_premium_30d
  FROM public.audit_logs al
  GROUP BY al.tenant_id
),
prepared AS (
  SELECT
    ub.tenant_id,
    COALESCE(m.eventos_30d, 0) AS eventos_30d,
    COALESCE(m.usuarios_ativos_30d, 0) AS usuarios_ativos_30d,
    COALESCE(m.eventos_premium_30d, 0) AS eventos_premium_30d,
    CASE WHEN ub.max_usage > 0 THEN LEAST((ub.current_usage / ub.max_usage) * 100, 100) ELSE 0 END AS percentual_uso_plano,
    COALESCE(t.onboarding_completed, false) AS onboarding_completed
  FROM usage_base ub
  LEFT JOIN metrics_30d m ON m.tenant_id = ub.tenant_id
  LEFT JOIN public.tenants t ON t.id = ub.tenant_id
),
normalized AS (
  SELECT
    p.*,
    LEAST(p.eventos_30d / 100.0, 1.0) AS eventos_norm,
    LEAST(p.usuarios_ativos_30d / 20.0, 1.0) AS ativos_norm,
    LEAST(p.eventos_premium_30d / 15.0, 1.0) AS premium_norm,
    LEAST(p.percentual_uso_plano / 100.0, 1.0) AS plano_norm,
    CASE WHEN p.onboarding_completed THEN 1.0 ELSE 0.0 END AS onboarding_norm
  FROM prepared p
)
SELECT
  n.tenant_id,
  n.eventos_30d,
  n.usuarios_ativos_30d,
  n.eventos_premium_30d,
  ROUND(n.percentual_uso_plano, 2) AS percentual_uso_plano,
  n.onboarding_completed,
  ROUND(100 * (0.25 * n.eventos_norm + 0.20 * n.ativos_norm + 0.15 * n.premium_norm + 0.20 * n.plano_norm + 0.20 * n.onboarding_norm))::int AS health_score,
  CASE
    WHEN (100 * (0.25 * n.eventos_norm + 0.20 * n.ativos_norm + 0.15 * n.premium_norm + 0.20 * n.plano_norm + 0.20 * n.onboarding_norm)) >= 70 THEN 'healthy'
    WHEN (100 * (0.25 * n.eventos_norm + 0.20 * n.ativos_norm + 0.15 * n.premium_norm + 0.20 * n.plano_norm + 0.20 * n.onboarding_norm)) >= 40 THEN 'at-risk'
    ELSE 'churn-risk'
  END AS health_category
FROM normalized n;

GRANT EXECUTE ON FUNCTION public.complete_tenant_onboarding_step_for_tenant(UUID, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.start_tenant_onboarding_step(TEXT, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_tenant_onboarding_step(TEXT, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_tenant_onboarding_status() TO authenticated, service_role;
