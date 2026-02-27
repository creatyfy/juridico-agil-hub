-- Enterprise inbound processing pipeline with durable inbox, async queue, and conversation fencing locks.

CREATE TABLE IF NOT EXISTS public.inbound_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  instance_id UUID NOT NULL REFERENCES public.whatsapp_instancias(id) ON DELETE CASCADE,
  instance_name TEXT NOT NULL,
  provider_message_id TEXT NOT NULL,
  phone_hash TEXT NOT NULL,
  phone_encrypted BYTEA NOT NULL,
  message_encrypted BYTEA NOT NULL,
  payload_encrypted BYTEA,
  processing_status TEXT NOT NULL DEFAULT 'queued' CHECK (processing_status IN ('queued', 'processing', 'processed', 'retry', 'failed')),
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, instance_id, provider_message_id)
);

CREATE INDEX IF NOT EXISTS idx_inbound_messages_received_at
  ON public.inbound_messages(received_at DESC);

CREATE INDEX IF NOT EXISTS idx_inbound_messages_processing_status
  ON public.inbound_messages(processing_status, updated_at);

CREATE TABLE IF NOT EXISTS public.inbound_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inbound_message_id UUID NOT NULL UNIQUE REFERENCES public.inbound_messages(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,
  instance_id UUID NOT NULL,
  phone_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'retry', 'completed', 'dead_letter')),
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_until TIMESTAMPTZ,
  lease_worker_id TEXT,
  lease_version BIGINT NOT NULL DEFAULT 0,
  lock_fencing_token BIGINT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inbound_queue_claim
  ON public.inbound_queue(status, available_at, lease_until, created_at);

CREATE TABLE IF NOT EXISTS public.conversation_processing_locks (
  tenant_id UUID NOT NULL,
  phone_hash TEXT NOT NULL,
  owner_worker_id TEXT,
  lease_until TIMESTAMPTZ,
  fencing_token BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, phone_hash)
);

CREATE INDEX IF NOT EXISTS idx_conversation_processing_locks_lease
  ON public.conversation_processing_locks(lease_until);

CREATE OR REPLACE FUNCTION public.set_updated_at_inbound_messages()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_updated_at_inbound_messages ON public.inbound_messages;
CREATE TRIGGER trg_set_updated_at_inbound_messages
BEFORE UPDATE ON public.inbound_messages
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at_inbound_messages();

CREATE OR REPLACE FUNCTION public.set_updated_at_inbound_queue()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_updated_at_inbound_queue ON public.inbound_queue;
CREATE TRIGGER trg_set_updated_at_inbound_queue
BEFORE UPDATE ON public.inbound_queue
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at_inbound_queue();

CREATE OR REPLACE FUNCTION public.enqueue_inbound_message(
  p_tenant_id UUID,
  p_instance_id UUID,
  p_instance_name TEXT,
  p_provider_message_id TEXT,
  p_phone TEXT,
  p_message TEXT,
  p_payload JSONB
)
RETURNS TABLE(
  inbound_message_id UUID,
  queue_id UUID,
  inserted BOOLEAN,
  queue_status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_message_id UUID;
  v_queue_id UUID;
  v_key TEXT := current_setting('app.settings.inbound_pii_key', true);
  v_phone_hash TEXT;
BEGIN
  IF v_key IS NULL OR btrim(v_key) = '' THEN
    RAISE EXCEPTION 'app.settings.inbound_pii_key is not configured';
  END IF;

  v_phone_hash := encode(digest(COALESCE(p_phone, ''), 'sha256'), 'hex');

  INSERT INTO public.inbound_messages (
    tenant_id,
    instance_id,
    instance_name,
    provider_message_id,
    phone_hash,
    phone_encrypted,
    message_encrypted,
    payload_encrypted,
    processing_status
  )
  VALUES (
    p_tenant_id,
    p_instance_id,
    p_instance_name,
    p_provider_message_id,
    v_phone_hash,
    pgp_sym_encrypt(COALESCE(p_phone, ''), v_key, 'cipher-algo=aes256'),
    pgp_sym_encrypt(COALESCE(p_message, ''), v_key, 'cipher-algo=aes256'),
    pgp_sym_encrypt(COALESCE(p_payload, '{}'::jsonb)::TEXT, v_key, 'cipher-algo=aes256'),
    'queued'
  )
  ON CONFLICT (tenant_id, instance_id, provider_message_id) DO NOTHING
  RETURNING id INTO v_message_id;

  inserted := v_message_id IS NOT NULL;

  IF NOT inserted THEN
    SELECT id
      INTO v_message_id
    FROM public.inbound_messages
    WHERE tenant_id = p_tenant_id
      AND instance_id = p_instance_id
      AND provider_message_id = p_provider_message_id;
  END IF;

  INSERT INTO public.inbound_queue (
    inbound_message_id,
    tenant_id,
    instance_id,
    phone_hash,
    status,
    available_at
  )
  VALUES (
    v_message_id,
    p_tenant_id,
    p_instance_id,
    v_phone_hash,
    'pending',
    now()
  )
  ON CONFLICT (inbound_message_id) DO NOTHING
  RETURNING id INTO v_queue_id;

  IF v_queue_id IS NULL THEN
    SELECT id, status
      INTO v_queue_id, queue_status
    FROM public.inbound_queue
    WHERE inbound_message_id = v_message_id;
  ELSE
    queue_status := 'pending';
  END IF;

  inbound_message_id := v_message_id;
  queue_id := v_queue_id;

  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_inbound_queue(
  p_batch_size INTEGER,
  p_worker_id TEXT,
  p_lease_seconds INTEGER DEFAULT 45
)
RETURNS TABLE(
  queue_id UUID,
  inbound_message_id UUID,
  tenant_id UUID,
  instance_id UUID,
  instance_name TEXT,
  provider_message_id TEXT,
  lease_version BIGINT,
  fencing_token BIGINT,
  attempts INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row RECORD;
  v_fencing BIGINT;
  v_lease_until TIMESTAMPTZ := now() + make_interval(secs => GREATEST(5, p_lease_seconds));
BEGIN
  FOR v_row IN
    SELECT q.id,
           q.inbound_message_id,
           q.tenant_id,
           q.instance_id,
           q.phone_hash,
           q.attempts,
           m.instance_name,
           m.provider_message_id
      FROM public.inbound_queue q
      JOIN public.inbound_messages m ON m.id = q.inbound_message_id
     WHERE q.status IN ('pending', 'retry')
       AND q.available_at <= now()
       AND (q.lease_until IS NULL OR q.lease_until < now())
     ORDER BY q.created_at
     LIMIT GREATEST(1, p_batch_size)
     FOR UPDATE OF q SKIP LOCKED
  LOOP
    INSERT INTO public.conversation_processing_locks (
      tenant_id,
      phone_hash,
      owner_worker_id,
      lease_until,
      fencing_token,
      updated_at
    )
    VALUES (
      v_row.tenant_id,
      v_row.phone_hash,
      p_worker_id,
      v_lease_until,
      1,
      now()
    )
    ON CONFLICT (tenant_id, phone_hash) DO UPDATE
      SET owner_worker_id = EXCLUDED.owner_worker_id,
          lease_until = EXCLUDED.lease_until,
          fencing_token = public.conversation_processing_locks.fencing_token + 1,
          updated_at = now()
      WHERE public.conversation_processing_locks.lease_until IS NULL
         OR public.conversation_processing_locks.lease_until < now()
    RETURNING conversation_processing_locks.fencing_token INTO v_fencing;

    IF v_fencing IS NULL THEN
      CONTINUE;
    END IF;

    UPDATE public.inbound_queue q
       SET status = 'processing',
           attempts = q.attempts + 1,
           lease_until = v_lease_until,
           lease_worker_id = p_worker_id,
           lease_version = q.lease_version + 1,
           lock_fencing_token = v_fencing,
           updated_at = now()
     WHERE q.id = v_row.id
       AND q.status IN ('pending', 'retry')
       AND q.available_at <= now()
       AND (q.lease_until IS NULL OR q.lease_until < now())
     RETURNING q.id,
               q.inbound_message_id,
               q.tenant_id,
               q.instance_id,
               v_row.instance_name,
               v_row.provider_message_id,
               q.lease_version,
               q.lock_fencing_token,
               q.attempts
      INTO queue_id,
           inbound_message_id,
           tenant_id,
           instance_id,
           instance_name,
           provider_message_id,
           lease_version,
           fencing_token,
           attempts;

    IF queue_id IS NULL THEN
      CONTINUE;
    END IF;

    UPDATE public.inbound_messages
       SET processing_status = 'processing',
           retry_count = GREATEST(v_row.attempts, retry_count)
     WHERE id = inbound_message_id;

    RETURN NEXT;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_inbound_message_plaintext(
  p_inbound_message_id UUID
)
RETURNS TABLE(
  phone TEXT,
  message TEXT,
  payload JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_key TEXT := current_setting('app.settings.inbound_pii_key', true);
BEGIN
  IF v_key IS NULL OR btrim(v_key) = '' THEN
    RAISE EXCEPTION 'app.settings.inbound_pii_key is not configured';
  END IF;

  RETURN QUERY
  SELECT
    pgp_sym_decrypt(m.phone_encrypted, v_key),
    pgp_sym_decrypt(m.message_encrypted, v_key),
    (pgp_sym_decrypt(m.payload_encrypted, v_key))::jsonb
  FROM public.inbound_messages m
  WHERE m.id = p_inbound_message_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_inbound_queue(
  p_queue_id UUID,
  p_worker_id TEXT,
  p_lease_version BIGINT,
  p_fencing_token BIGINT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row RECORD;
BEGIN
  UPDATE public.inbound_queue
     SET status = 'completed',
         lease_until = NULL,
         lease_worker_id = NULL,
         last_error = NULL,
         updated_at = now()
   WHERE id = p_queue_id
     AND status = 'processing'
     AND lease_worker_id = p_worker_id
     AND lease_version = p_lease_version
     AND lock_fencing_token = p_fencing_token
     AND lease_until IS NOT NULL
     AND lease_until >= now()
  RETURNING inbound_message_id, tenant_id, phone_hash
    INTO v_row;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  UPDATE public.inbound_messages
     SET processing_status = 'processed',
         last_error = NULL,
         updated_at = now()
   WHERE id = v_row.inbound_message_id;

  UPDATE public.conversation_processing_locks
     SET owner_worker_id = NULL,
         lease_until = NULL,
         updated_at = now()
   WHERE tenant_id = v_row.tenant_id
     AND phone_hash = v_row.phone_hash
     AND fencing_token = p_fencing_token;

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.retry_inbound_queue(
  p_queue_id UUID,
  p_worker_id TEXT,
  p_lease_version BIGINT,
  p_fencing_token BIGINT,
  p_next_retry_at TIMESTAMPTZ,
  p_error TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row RECORD;
BEGIN
  UPDATE public.inbound_queue
     SET status = 'retry',
         available_at = p_next_retry_at,
         lease_until = NULL,
         lease_worker_id = NULL,
         last_error = LEFT(COALESCE(p_error, 'processing_error'), 500),
         updated_at = now()
   WHERE id = p_queue_id
     AND status = 'processing'
     AND lease_worker_id = p_worker_id
     AND lease_version = p_lease_version
     AND lock_fencing_token = p_fencing_token
  RETURNING inbound_message_id, tenant_id, phone_hash, attempts
    INTO v_row;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  UPDATE public.inbound_messages
     SET processing_status = 'retry',
         retry_count = GREATEST(retry_count, v_row.attempts),
         last_error = LEFT(COALESCE(p_error, 'processing_error'), 500),
         updated_at = now()
   WHERE id = v_row.inbound_message_id;

  UPDATE public.conversation_processing_locks
     SET owner_worker_id = NULL,
         lease_until = NULL,
         updated_at = now()
   WHERE tenant_id = v_row.tenant_id
     AND phone_hash = v_row.phone_hash
     AND fencing_token = p_fencing_token;

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_inbound_queue(
  p_queue_id UUID,
  p_worker_id TEXT,
  p_lease_version BIGINT,
  p_fencing_token BIGINT,
  p_error TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row RECORD;
BEGIN
  UPDATE public.inbound_queue
     SET status = 'dead_letter',
         lease_until = NULL,
         lease_worker_id = NULL,
         last_error = LEFT(COALESCE(p_error, 'processing_failed'), 500),
         updated_at = now()
   WHERE id = p_queue_id
     AND status = 'processing'
     AND lease_worker_id = p_worker_id
     AND lease_version = p_lease_version
     AND lock_fencing_token = p_fencing_token
  RETURNING inbound_message_id, tenant_id, phone_hash, attempts
    INTO v_row;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  UPDATE public.inbound_messages
     SET processing_status = 'failed',
         retry_count = GREATEST(retry_count, v_row.attempts),
         last_error = LEFT(COALESCE(p_error, 'processing_failed'), 500),
         updated_at = now()
   WHERE id = v_row.inbound_message_id;

  UPDATE public.conversation_processing_locks
     SET owner_worker_id = NULL,
         lease_until = NULL,
         updated_at = now()
   WHERE tenant_id = v_row.tenant_id
     AND phone_hash = v_row.phone_hash
     AND fencing_token = p_fencing_token;

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_inbound_message(UUID, UUID, TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_inbound_queue(INTEGER, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_inbound_message_plaintext(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_inbound_queue(UUID, TEXT, BIGINT, BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.retry_inbound_queue(UUID, TEXT, BIGINT, BIGINT, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_inbound_queue(UUID, TEXT, BIGINT, BIGINT, TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.enqueue_inbound_message(UUID, UUID, TEXT, TEXT, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_inbound_queue(INTEGER, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_inbound_message_plaintext(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_inbound_queue(UUID, TEXT, BIGINT, BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION public.retry_inbound_queue(UUID, TEXT, BIGINT, BIGINT, TIMESTAMPTZ, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_inbound_queue(UUID, TEXT, BIGINT, BIGINT, TEXT) TO service_role;
