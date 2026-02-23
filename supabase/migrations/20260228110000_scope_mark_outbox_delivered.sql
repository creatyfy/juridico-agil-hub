-- Scope delivery confirmation by tenant + instance to prevent cross-tenant collisions
CREATE OR REPLACE FUNCTION public.mark_outbox_delivered(
  p_tenant_id UUID,
  p_instance_id UUID,
  p_provider_message_id TEXT,
  p_provider_response JSONB DEFAULT '{}'::jsonb
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE v_count INTEGER;
BEGIN
  UPDATE public.message_outbox
  SET status = 'delivered',
      delivered_at = now(),
      provider_response = COALESCE(provider_response, '{}'::jsonb) || p_provider_response,
      updated_at = now()
  WHERE tenant_id = p_tenant_id
    AND provider_message_id = p_provider_message_id
    AND status = 'accepted'
    AND (
      aggregate_id = p_instance_id
      OR payload->>'instanceId' = p_instance_id::text
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
