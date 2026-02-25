-- Restrict execution of SECURITY DEFINER and sensitive worker functions.
-- Prevent direct invocation by anon/authenticated roles.

REVOKE ALL ON FUNCTION public.claim_invite_token(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_cliente_processo_invite_token(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verify_and_consume_otp(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.register_outbox_attempt(uuid, bigint) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_campaign_recipients(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cancel_campaign_recipients(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.process_inbound_event(uuid, uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tenant_write_guard(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.claim_message_outbox_with_lease(integer, text, integer, integer, numeric, integer, numeric) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_outbox_accepted(uuid, text, bigint, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reschedule_outbox_retry(uuid, text, bigint, timestamptz, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.move_outbox_dead_letter(uuid, text, bigint, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reap_orphaned_outbox_messages(integer, integer) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_invite_token(uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_cliente_processo_invite_token(uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.verify_and_consume_otp(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.register_outbox_attempt(uuid, bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_campaign_recipients(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_campaign_recipients(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.process_inbound_event(uuid, uuid, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.tenant_write_guard(uuid, uuid, text) TO service_role;

GRANT EXECUTE ON FUNCTION public.claim_message_outbox_with_lease(integer, text, integer, integer, numeric, integer, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_outbox_accepted(uuid, text, bigint, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.reschedule_outbox_retry(uuid, text, bigint, timestamptz, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.move_outbox_dead_letter(uuid, text, bigint, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.reap_orphaned_outbox_messages(integer, integer) TO service_role;
