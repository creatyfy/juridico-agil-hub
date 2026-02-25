CREATE OR REPLACE FUNCTION public.claim_and_accept_invite(
  p_invite_id uuid,
  p_token text,
  p_nonce text,
  p_expected_tenant uuid,
  p_invite_kind text,
  p_ip_aceite text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row jsonb;
BEGIN
  IF p_invite_kind = 'cliente_processo' THEN
    UPDATE public.cliente_processos
    SET token_used_at = now(),
        status = 'ativo',
        data_aceite = now()
    WHERE id = p_invite_id
      AND token = p_token
      AND invite_nonce = p_nonce
      AND advogado_user_id = p_expected_tenant
      AND token_used_at IS NULL
      AND token_expires_at >= now()
      AND status = 'pendente'
    RETURNING to_jsonb(cliente_processos.*) INTO v_row;
  ELSIF p_invite_kind = 'convite_vinculacao' THEN
    UPDATE public.convites_vinculacao
    SET token_used_at = now(),
        status = 'ativo',
        data_aceite = now(),
        ip_aceite = COALESCE(p_ip_aceite, ip_aceite)
    WHERE id = p_invite_id
      AND token = p_token
      AND invite_nonce = p_nonce
      AND advogado_user_id = p_expected_tenant
      AND token_used_at IS NULL
      AND token_expires_at >= now()
      AND status = 'pendente'
    RETURNING to_jsonb(convites_vinculacao.*) INTO v_row;
  ELSE
    RAISE EXCEPTION 'invite_kind_invalid' USING ERRCODE = 'P0001';
  END IF;

  IF v_row IS NULL THEN
    RAISE EXCEPTION 'invite_conflict_or_invalid' USING ERRCODE = 'P0001';
  END IF;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_and_accept_invite(uuid, text, text, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_and_accept_invite(uuid, text, text, uuid, text, text) TO service_role;
