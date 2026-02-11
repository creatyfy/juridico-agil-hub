
-- Fix overly permissive INSERT policy - restrict to authenticated users inserting for themselves
-- or service role (which bypasses RLS)
DROP POLICY "Service can insert notifications" ON public.notificacoes;

CREATE POLICY "Users can insert own notifications"
ON public.notificacoes FOR INSERT
WITH CHECK (auth.uid() = user_id);
