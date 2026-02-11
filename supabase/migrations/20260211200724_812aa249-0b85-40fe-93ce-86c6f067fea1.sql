
-- Create notifications table
CREATE TABLE public.notificacoes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  tipo TEXT NOT NULL, -- 'movimentacao', 'convite', 'sistema'
  titulo TEXT NOT NULL,
  mensagem TEXT NOT NULL,
  lida BOOLEAN NOT NULL DEFAULT false,
  link TEXT, -- optional route to navigate to
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.notificacoes ENABLE ROW LEVEL SECURITY;

-- Users can view their own notifications
CREATE POLICY "Users can view own notifications"
ON public.notificacoes FOR SELECT
USING (auth.uid() = user_id);

-- Users can update their own notifications (mark as read)
CREATE POLICY "Users can update own notifications"
ON public.notificacoes FOR UPDATE
USING (auth.uid() = user_id);

-- Users can delete their own notifications
CREATE POLICY "Users can delete own notifications"
ON public.notificacoes FOR DELETE
USING (auth.uid() = user_id);

-- Service role can insert (from edge functions/triggers)
CREATE POLICY "Service can insert notifications"
ON public.notificacoes FOR INSERT
WITH CHECK (true);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.notificacoes;

-- Create index for performance
CREATE INDEX idx_notificacoes_user_lida ON public.notificacoes(user_id, lida);
CREATE INDEX idx_notificacoes_created ON public.notificacoes(created_at DESC);
