CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.outbox_attempts (
  outbox_id uuid NOT NULL REFERENCES public.message_outbox(id) ON DELETE CASCADE,
  lease_version bigint NOT NULL,
  attempt_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (outbox_id, lease_version)
);

CREATE OR REPLACE FUNCTION public.secure_text_equal(p_left text, p_right text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT length(COALESCE(p_left, '')) = length(COALESCE(p_right, ''))
    AND digest(COALESCE(p_left, ''), 'sha256') = digest(COALESCE(p_right, ''), 'sha256');
$$;

CREATE OR REPLACE FUNCTION public.claim_invite_token(
  p_invite_id uuid,
  p_nonce text,
  p_expected_tenant uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row jsonb;
BEGIN
  UPDATE public.convites_vinculacao
  SET token_used_at = now()
  WHERE id = p_invite_id
    AND invite_nonce = p_nonce
    AND advogado_user_id = p_expected_tenant
    AND token_used_at IS NULL
    AND token_expires_at >= now()
  RETURNING to_jsonb(convites_vinculacao.*) INTO v_row;

  IF v_row IS NULL THEN
    RAISE EXCEPTION 'invite_token_claim_failed' USING ERRCODE = 'P0001';
  END IF;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_cliente_processo_invite_token(
  p_invite_id uuid,
  p_nonce text,
  p_expected_tenant uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row jsonb;
BEGIN
  UPDATE public.cliente_processos
  SET token_used_at = now()
  WHERE id = p_invite_id
    AND invite_nonce = p_nonce
    AND advogado_user_id = p_expected_tenant
    AND token_used_at IS NULL
    AND token_expires_at >= now()
  RETURNING to_jsonb(cliente_processos.*) INTO v_row;

  IF v_row IS NULL THEN
    RAISE EXCEPTION 'invite_token_claim_failed' USING ERRCODE = 'P0001';
  END IF;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_and_consume_otp(
  p_identifier text,
  p_hash text,
  p_source_ip_hash text
)
RETURNS TABLE(ok boolean, otp_id uuid, reason text, otp_kind text)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_email_otp public.email_verification_codes%ROWTYPE;
  v_whatsapp_otp public.validacoes_otp%ROWTYPE;
  v_updated uuid;
BEGIN
  SELECT * INTO v_email_otp
  FROM public.email_verification_codes
  WHERE email = lower(trim(p_identifier))
    AND verified = false
    AND expires_at >= now()
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    IF v_email_otp.consumed_at IS NOT NULL OR (v_email_otp.blocked_until IS NOT NULL AND v_email_otp.blocked_until > now()) OR v_email_otp.failed_attempts >= 5 THEN
      RETURN QUERY SELECT false, v_email_otp.id, 'invalid_or_blocked', 'email';
      RETURN;
    END IF;

    IF NOT public.secure_text_equal(v_email_otp.code_hash, p_hash) THEN
      UPDATE public.email_verification_codes
      SET failed_attempts = failed_attempts + 1,
          blocked_until = CASE WHEN failed_attempts + 1 >= 5 THEN now() + interval '10 minutes' ELSE blocked_until END
      WHERE id = v_email_otp.id;

      INSERT INTO public.otp_rate_limit_events(scope_type, scope_key)
      VALUES ('ip', COALESCE(p_source_ip_hash, ''));

      RETURN QUERY SELECT false, v_email_otp.id, 'invalid_code', 'email';
      RETURN;
    END IF;

    UPDATE public.email_verification_codes
    SET verified = true,
        consumed_at = now(),
        failed_attempts = failed_attempts + 1
    WHERE id = v_email_otp.id
      AND consumed_at IS NULL
    RETURNING id INTO v_updated;

    IF v_updated IS NULL THEN
      RETURN QUERY SELECT false, v_email_otp.id, 'already_consumed', 'email';
      RETURN;
    END IF;

    RETURN QUERY SELECT true, v_updated, null::text, 'email';
    RETURN;
  END IF;

  SELECT * INTO v_whatsapp_otp
  FROM public.validacoes_otp
  WHERE convite_id::text = p_identifier
    AND validado = false
    AND expiracao >= now()
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, null::uuid, 'not_found', null::text;
    RETURN;
  END IF;

  IF v_whatsapp_otp.consumed_at IS NOT NULL OR (v_whatsapp_otp.blocked_until IS NOT NULL AND v_whatsapp_otp.blocked_until > now()) OR v_whatsapp_otp.tentativas >= 5 THEN
    RETURN QUERY SELECT false, v_whatsapp_otp.id, 'invalid_or_blocked', 'whatsapp';
    RETURN;
  END IF;

  IF NOT public.secure_text_equal(v_whatsapp_otp.codigo_otp_hash, p_hash) THEN
    UPDATE public.validacoes_otp
    SET tentativas = tentativas + 1,
        blocked_until = CASE WHEN tentativas + 1 >= 5 THEN now() + interval '10 minutes' ELSE blocked_until END,
        source_ip_hash = COALESCE(p_source_ip_hash, source_ip_hash)
    WHERE id = v_whatsapp_otp.id;

    RETURN QUERY SELECT false, v_whatsapp_otp.id, 'invalid_code', 'whatsapp';
    RETURN;
  END IF;

  UPDATE public.validacoes_otp
  SET validado = true,
      consumed_at = now(),
      tentativas = tentativas + 1,
      source_ip_hash = COALESCE(p_source_ip_hash, source_ip_hash)
  WHERE id = v_whatsapp_otp.id
    AND consumed_at IS NULL
  RETURNING id INTO v_updated;

  IF v_updated IS NULL THEN
    RETURN QUERY SELECT false, v_whatsapp_otp.id, 'already_consumed', 'whatsapp';
    RETURN;
  END IF;

  RETURN QUERY SELECT true, v_updated, null::text, 'whatsapp';
END;
$$;

CREATE OR REPLACE FUNCTION public.register_outbox_attempt(
  p_outbox_id uuid,
  p_lease_version bigint
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v_inserted integer;
BEGIN
  INSERT INTO public.outbox_attempts(outbox_id, lease_version)
  VALUES (p_outbox_id, p_lease_version)
  ON CONFLICT (outbox_id, lease_version) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_campaign_recipients(
  p_campaign_job_id uuid,
  p_limit integer DEFAULT 100
)
RETURNS SETOF public.campaign_recipients
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.campaign_recipients
  SET status = 'queued',
      updated_at = now()
  WHERE id IN (
    SELECT id
    FROM public.campaign_recipients
    WHERE campaign_job_id = p_campaign_job_id
      AND status = 'pending'
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  RETURNING *;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_campaign_recipients(
  p_campaign_job_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE v_count integer;
BEGIN
  UPDATE public.campaign_recipients
  SET status = 'cancelled',
      updated_at = now()
  WHERE campaign_job_id = p_campaign_job_id
    AND status IN ('pending', 'queued');

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.process_inbound_event(
  p_tenant_id uuid,
  p_instance_id uuid,
  p_provider_message_id text,
  p_payload jsonb
)
RETURNS TABLE(duplicate boolean, delivered_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_inserted integer;
  v_updated integer;
BEGIN
  INSERT INTO public.inbound_events(tenant_id, instance_id, provider_message_id, payload)
  VALUES (p_tenant_id, p_instance_id, p_provider_message_id, p_payload)
  ON CONFLICT (tenant_id, instance_id, provider_message_id) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  IF v_inserted = 0 THEN
    RETURN QUERY SELECT true, 0;
    RETURN;
  END IF;

  SELECT public.mark_outbox_delivered(
    p_tenant_id,
    p_instance_id,
    p_provider_message_id,
    p_payload
  ) INTO v_updated;

  RETURN QUERY SELECT false, COALESCE(v_updated, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.tenant_write_guard(
  p_tenant_id uuid,
  p_resource_id uuid,
  p_resource_table text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  CASE p_resource_table
    WHEN 'cliente_processos' THEN
      SELECT advogado_user_id INTO v_tenant_id FROM public.cliente_processos WHERE id = p_resource_id;
    WHEN 'convites_vinculacao' THEN
      SELECT advogado_user_id INTO v_tenant_id FROM public.convites_vinculacao WHERE id = p_resource_id;
    WHEN 'campaign_recipients' THEN
      SELECT tenant_id INTO v_tenant_id FROM public.campaign_recipients WHERE id = p_resource_id;
    WHEN 'campaign_jobs' THEN
      SELECT tenant_id INTO v_tenant_id FROM public.campaign_jobs WHERE id = p_resource_id;
    WHEN 'message_outbox' THEN
      SELECT tenant_id INTO v_tenant_id FROM public.message_outbox WHERE id = p_resource_id;
    ELSE
      RAISE EXCEPTION 'unsupported_resource_table';
  END CASE;

  IF v_tenant_id IS NULL OR v_tenant_id <> p_tenant_id THEN
    RAISE EXCEPTION 'forbidden_tenant_scope' USING ERRCODE = '42501';
  END IF;

  RETURN true;
END;
$$;
