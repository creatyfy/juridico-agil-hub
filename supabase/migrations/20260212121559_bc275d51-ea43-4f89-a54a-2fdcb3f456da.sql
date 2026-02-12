
-- Add unique index on message_id so the webhook upsert works
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_mensagens_message_id_unique 
ON public.whatsapp_mensagens (message_id) 
WHERE message_id IS NOT NULL;

-- Add unique constraint on whatsapp_contatos for upsert
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_contatos_instancia_remote_unique 
ON public.whatsapp_contatos (instancia_id, remote_jid);
