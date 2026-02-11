
-- Tabela de instâncias WhatsApp por advogado
CREATE TABLE public.whatsapp_instancias (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  instance_name TEXT NOT NULL,
  instance_id TEXT,
  status TEXT NOT NULL DEFAULT 'disconnected',
  phone_number TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_instancias ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own instances"
ON public.whatsapp_instancias FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own instances"
ON public.whatsapp_instancias FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own instances"
ON public.whatsapp_instancias FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own instances"
ON public.whatsapp_instancias FOR DELETE
USING (auth.uid() = user_id);

CREATE TRIGGER update_whatsapp_instancias_updated_at
BEFORE UPDATE ON public.whatsapp_instancias
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Tabela de mensagens WhatsApp
CREATE TABLE public.whatsapp_mensagens (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  instancia_id UUID NOT NULL REFERENCES public.whatsapp_instancias(id) ON DELETE CASCADE,
  remote_jid TEXT NOT NULL,
  direcao TEXT NOT NULL DEFAULT 'in',
  conteudo TEXT,
  tipo TEXT DEFAULT 'text',
  message_id TEXT,
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_mensagens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own messages"
ON public.whatsapp_mensagens FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.whatsapp_instancias
  WHERE whatsapp_instancias.id = whatsapp_mensagens.instancia_id
  AND whatsapp_instancias.user_id = auth.uid()
));

CREATE POLICY "Users can insert own messages"
ON public.whatsapp_mensagens FOR INSERT
WITH CHECK (EXISTS (
  SELECT 1 FROM public.whatsapp_instancias
  WHERE whatsapp_instancias.id = whatsapp_mensagens.instancia_id
  AND whatsapp_instancias.user_id = auth.uid()
));

-- Tabela de contatos WhatsApp
CREATE TABLE public.whatsapp_contatos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  instancia_id UUID NOT NULL REFERENCES public.whatsapp_instancias(id) ON DELETE CASCADE,
  remote_jid TEXT NOT NULL,
  nome TEXT,
  numero TEXT,
  foto_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_contatos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own contacts"
ON public.whatsapp_contatos FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.whatsapp_instancias
  WHERE whatsapp_instancias.id = whatsapp_contatos.instancia_id
  AND whatsapp_instancias.user_id = auth.uid()
));

CREATE POLICY "Users can insert own contacts"
ON public.whatsapp_contatos FOR INSERT
WITH CHECK (EXISTS (
  SELECT 1 FROM public.whatsapp_instancias
  WHERE whatsapp_instancias.id = whatsapp_contatos.instancia_id
  AND whatsapp_instancias.user_id = auth.uid()
));

CREATE POLICY "Users can update own contacts"
ON public.whatsapp_contatos FOR UPDATE
USING (EXISTS (
  SELECT 1 FROM public.whatsapp_instancias
  WHERE whatsapp_instancias.id = whatsapp_contatos.instancia_id
  AND whatsapp_instancias.user_id = auth.uid()
));

CREATE TRIGGER update_whatsapp_contatos_updated_at
BEFORE UPDATE ON public.whatsapp_contatos
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Habilitar Realtime para mensagens
ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_mensagens;
