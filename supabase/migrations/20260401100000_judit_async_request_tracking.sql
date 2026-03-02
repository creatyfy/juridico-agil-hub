ALTER TABLE public.processo_monitoramentos
  ADD COLUMN judit_request_id TEXT,
  ADD COLUMN judit_request_status TEXT DEFAULT NULL,
  ADD COLUMN judit_request_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN judit_request_created_at TIMESTAMPTZ;
