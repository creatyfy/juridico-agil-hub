
-- Remove partial index
DROP INDEX IF EXISTS whatsapp_mensagens_message_id_unique;

-- Fill NULL message_ids with unique values
UPDATE whatsapp_mensagens SET message_id = gen_random_uuid()::text WHERE message_id IS NULL;

-- Make column NOT NULL with default
ALTER TABLE whatsapp_mensagens ALTER COLUMN message_id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE whatsapp_mensagens ALTER COLUMN message_id SET NOT NULL;

-- Create proper unique constraint
ALTER TABLE whatsapp_mensagens ADD CONSTRAINT whatsapp_mensagens_message_id_key UNIQUE (message_id);
