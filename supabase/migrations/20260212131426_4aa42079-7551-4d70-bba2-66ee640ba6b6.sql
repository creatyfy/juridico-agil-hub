
-- Add new action: full sync endpoint
-- Add profilePictureUrl column to whatsapp_contatos
ALTER TABLE public.whatsapp_contatos ADD COLUMN IF NOT EXISTS push_name text;
ALTER TABLE public.whatsapp_contatos ADD COLUMN IF NOT EXISTS verified_name text;

-- Create chats cache table
CREATE TABLE IF NOT EXISTS public.whatsapp_chats_cache (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  instancia_id uuid NOT NULL REFERENCES public.whatsapp_instancias(id) ON DELETE CASCADE,
  remote_jid text NOT NULL,
  nome text,
  foto_url text,
  ultima_mensagem text,
  ultimo_timestamp timestamp with time zone DEFAULT now(),
  direcao text DEFAULT 'in',
  nao_lidas integer DEFAULT 0,
  is_group boolean DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(instancia_id, remote_jid)
);

-- Enable RLS
ALTER TABLE public.whatsapp_chats_cache ENABLE ROW LEVEL SECURITY;

-- RLS policies for chats cache
CREATE POLICY "Users can view own chats cache"
ON public.whatsapp_chats_cache
FOR SELECT
USING (EXISTS (
  SELECT 1 FROM whatsapp_instancias
  WHERE whatsapp_instancias.id = whatsapp_chats_cache.instancia_id
  AND whatsapp_instancias.user_id = auth.uid()
));

CREATE POLICY "Users can insert own chats cache"
ON public.whatsapp_chats_cache
FOR INSERT
WITH CHECK (EXISTS (
  SELECT 1 FROM whatsapp_instancias
  WHERE whatsapp_instancias.id = whatsapp_chats_cache.instancia_id
  AND whatsapp_instancias.user_id = auth.uid()
));

CREATE POLICY "Users can update own chats cache"
ON public.whatsapp_chats_cache
FOR UPDATE
USING (EXISTS (
  SELECT 1 FROM whatsapp_instancias
  WHERE whatsapp_instancias.id = whatsapp_chats_cache.instancia_id
  AND whatsapp_instancias.user_id = auth.uid()
));

CREATE POLICY "Users can delete own chats cache"
ON public.whatsapp_chats_cache
FOR DELETE
USING (EXISTS (
  SELECT 1 FROM whatsapp_instancias
  WHERE whatsapp_instancias.id = whatsapp_chats_cache.instancia_id
  AND whatsapp_instancias.user_id = auth.uid()
));

-- Enable realtime for chats cache and messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_chats_cache;

-- Add trigger for updated_at
CREATE TRIGGER update_whatsapp_chats_cache_updated_at
  BEFORE UPDATE ON public.whatsapp_chats_cache
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
