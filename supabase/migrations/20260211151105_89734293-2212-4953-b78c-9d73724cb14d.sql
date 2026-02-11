
-- Tabela de processos importados
CREATE TABLE public.processos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  numero_cnj TEXT NOT NULL,
  tribunal TEXT,
  vara TEXT,
  classe TEXT,
  assunto TEXT,
  partes JSONB DEFAULT '[]'::jsonb,
  status TEXT DEFAULT 'ativo',
  data_distribuicao TIMESTAMP WITH TIME ZONE,
  judit_process_id TEXT,
  fonte TEXT DEFAULT 'judit' CHECK (fonte IN ('judit', 'manual')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, numero_cnj)
);

-- Tabela de movimentações
CREATE TABLE public.movimentacoes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  processo_id UUID NOT NULL REFERENCES public.processos(id) ON DELETE CASCADE,
  data_movimentacao TIMESTAMP WITH TIME ZONE,
  tipo TEXT,
  descricao TEXT NOT NULL,
  conteudo TEXT,
  judit_movement_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Tabela de monitoramento de processos
CREATE TABLE public.processo_monitoramentos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  processo_id UUID NOT NULL REFERENCES public.processos(id) ON DELETE CASCADE UNIQUE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ativo BOOLEAN NOT NULL DEFAULT true,
  ultima_sync TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_processos_user_id ON public.processos(user_id);
CREATE INDEX idx_processos_numero_cnj ON public.processos(numero_cnj);
CREATE INDEX idx_movimentacoes_processo_id ON public.movimentacoes(processo_id);
CREATE INDEX idx_monitoramentos_ativo ON public.processo_monitoramentos(ativo) WHERE ativo = true;

-- Enable RLS
ALTER TABLE public.processos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.movimentacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processo_monitoramentos ENABLE ROW LEVEL SECURITY;

-- RLS: processos
CREATE POLICY "Users can view own processos" ON public.processos FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own processos" ON public.processos FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own processos" ON public.processos FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own processos" ON public.processos FOR DELETE USING (auth.uid() = user_id);

-- RLS: movimentacoes (via processo ownership)
CREATE POLICY "Users can view movimentacoes of own processos" ON public.movimentacoes
  FOR SELECT USING (EXISTS (SELECT 1 FROM public.processos WHERE processos.id = movimentacoes.processo_id AND processos.user_id = auth.uid()));
CREATE POLICY "Users can insert movimentacoes to own processos" ON public.movimentacoes
  FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM public.processos WHERE processos.id = movimentacoes.processo_id AND processos.user_id = auth.uid()));

-- RLS: monitoramentos
CREATE POLICY "Users can view own monitoramentos" ON public.processo_monitoramentos FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own monitoramentos" ON public.processo_monitoramentos FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own monitoramentos" ON public.processo_monitoramentos FOR UPDATE USING (auth.uid() = user_id);

-- Allow service role to manage movimentacoes (for sync edge function)
CREATE POLICY "Service role can manage movimentacoes" ON public.movimentacoes
  FOR ALL USING (true) WITH CHECK (true);

-- Updated_at triggers
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_processos_updated_at BEFORE UPDATE ON public.processos FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_monitoramentos_updated_at BEFORE UPDATE ON public.processo_monitoramentos FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime for movimentacoes
ALTER PUBLICATION supabase_realtime ADD TABLE public.movimentacoes;
