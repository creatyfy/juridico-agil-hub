-- Hardening: restrict public SELECT on convites_vinculacao to request-scoped token only.

ALTER TABLE IF EXISTS public.convites_vinculacao ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.convites_vinculacao FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  p RECORD;
BEGIN
  FOR p IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'convites_vinculacao'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.convites_vinculacao', p.policyname);
  END LOOP;
END
$$;

-- Allow authenticated advogado to create own invites.
CREATE POLICY convites_vinculacao_advogado_insert_own
ON public.convites_vinculacao
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = advogado_user_id);

-- Allow authenticated advogado to update own invites.
CREATE POLICY convites_vinculacao_advogado_update_own
ON public.convites_vinculacao
FOR UPDATE
TO authenticated
USING (auth.uid() = advogado_user_id)
WITH CHECK (auth.uid() = advogado_user_id);

-- Allow authenticated advogado to delete own invites.
CREATE POLICY convites_vinculacao_advogado_delete_own
ON public.convites_vinculacao
FOR DELETE
TO authenticated
USING (auth.uid() = advogado_user_id);

-- Public read ONLY when request-scoped token matches row token.
-- If app.invite_token is not set (or set to empty), NULLIF returns NULL and no row matches.
CREATE POLICY convites_vinculacao_select_by_invite_token
ON public.convites_vinculacao
FOR SELECT
TO anon, authenticated
USING (
  token = NULLIF(current_setting('app.invite_token', true), '')
);
