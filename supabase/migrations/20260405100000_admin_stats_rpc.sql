-- Admin statistics RPC
-- Only executable by users with role = 'admin' in user_metadata.
-- Uses SECURITY DEFINER to bypass RLS and read cross-tenant counts.

CREATE OR REPLACE FUNCTION public.get_admin_stats()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_total_advogados BIGINT;
  v_total_clientes BIGINT;
  v_processos_monitorados BIGINT;
  v_instancias_ativas BIGINT;
  v_advogados JSONB;
BEGIN
  -- Guard: only admin users
  SELECT raw_user_meta_data->>'role'
  INTO v_role
  FROM auth.users
  WHERE id = auth.uid();

  IF v_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT COUNT(*) INTO v_total_advogados FROM public.advogado_credentials;
  SELECT COUNT(*) INTO v_total_clientes FROM public.clientes;

  SELECT COUNT(*) INTO v_processos_monitorados
  FROM public.processo_monitoramentos
  WHERE ativo = true;

  SELECT COUNT(*) INTO v_instancias_ativas
  FROM public.whatsapp_instancias
  WHERE status = 'connected';

  -- Advogados list: nome, email, qtd processos, qtd clientes
  SELECT jsonb_agg(row_to_json(t))
  INTO v_advogados
  FROM (
    SELECT
      ac.user_id,
      au.email,
      COALESCE(au.raw_user_meta_data->>'full_name', au.email) AS nome,
      ac.oab,
      ac.uf,
      au.created_at,
      (SELECT COUNT(*) FROM public.processos p WHERE p.user_id = ac.user_id) AS qtd_processos,
      (SELECT COUNT(*) FROM public.clientes c WHERE c.user_id = ac.user_id) AS qtd_clientes
    FROM public.advogado_credentials ac
    JOIN auth.users au ON au.id = ac.user_id
    ORDER BY au.created_at DESC
    LIMIT 50
  ) t;

  RETURN jsonb_build_object(
    'total_advogados', v_total_advogados,
    'total_clientes', v_total_clientes,
    'processos_monitorados', v_processos_monitorados,
    'instancias_ativas', v_instancias_ativas,
    'advogados', COALESCE(v_advogados, '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_admin_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_stats() TO authenticated;
