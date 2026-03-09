ALTER TABLE public.convites_vinculacao
  ADD COLUMN IF NOT EXISTS invite_nonce text,
  ADD COLUMN IF NOT EXISTS token_expires_at timestamp with time zone;