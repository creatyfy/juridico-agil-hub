ALTER TABLE public.processo_monitoramentos
  ADD COLUMN IF NOT EXISTS judit_request_id text,
  ADD COLUMN IF NOT EXISTS judit_request_status text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS judit_request_attempts integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS judit_request_created_at timestamptz DEFAULT NULL;