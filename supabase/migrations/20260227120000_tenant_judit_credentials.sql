-- Per-tenant Judit credentials with encryption and strict tenant isolation

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.tenant_integrations (
  tenant_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  judit_api_key_encrypted BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.tenant_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_integrations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_integrations_select_own ON public.tenant_integrations;
CREATE POLICY tenant_integrations_select_own
  ON public.tenant_integrations
  FOR SELECT
  TO authenticated
  USING (auth.uid() = tenant_id);

REVOKE ALL ON TABLE public.tenant_integrations FROM PUBLIC;
REVOKE ALL ON TABLE public.tenant_integrations FROM anon;
REVOKE ALL ON TABLE public.tenant_integrations FROM authenticated;
GRANT SELECT ON TABLE public.tenant_integrations TO authenticated;

CREATE OR REPLACE FUNCTION public.set_tenant_judit_api_key(p_plain_api_key TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID := auth.uid();
  v_encryption_key TEXT := current_setting('app.settings.judit_credentials_key', true);
BEGIN
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF p_plain_api_key IS NULL OR btrim(p_plain_api_key) = '' THEN
    RAISE EXCEPTION 'API key is required';
  END IF;

  IF v_encryption_key IS NULL OR btrim(v_encryption_key) = '' THEN
    RAISE EXCEPTION 'Encryption key is not configured';
  END IF;

  INSERT INTO public.tenant_integrations (tenant_id, judit_api_key_encrypted)
  VALUES (
    v_tenant_id,
    pgp_sym_encrypt(p_plain_api_key, v_encryption_key, 'cipher-algo=aes256')
  )
  ON CONFLICT (tenant_id)
  DO UPDATE SET
    judit_api_key_encrypted = EXCLUDED.judit_api_key_encrypted,
    updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.get_tenant_judit_api_key()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID := auth.uid();
  v_encryption_key TEXT := current_setting('app.settings.judit_credentials_key', true);
  v_api_key TEXT;
BEGIN
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF v_encryption_key IS NULL OR btrim(v_encryption_key) = '' THEN
    RAISE EXCEPTION 'Encryption key is not configured';
  END IF;

  SELECT pgp_sym_decrypt(ti.judit_api_key_encrypted, v_encryption_key)
  INTO v_api_key
  FROM public.tenant_integrations ti
  WHERE ti.tenant_id = v_tenant_id;

  IF v_api_key IS NULL OR btrim(v_api_key) = '' THEN
    RAISE EXCEPTION 'Judit API key not configured for tenant';
  END IF;

  RETURN v_api_key;
END;
$$;

REVOKE ALL ON FUNCTION public.set_tenant_judit_api_key(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_tenant_judit_api_key() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_tenant_judit_api_key(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_tenant_judit_api_key() TO authenticated;
