
-- Create clientes table
CREATE TABLE public.clientes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  nome TEXT NOT NULL,
  documento TEXT,
  tipo_documento TEXT DEFAULT 'CPF',
  tipo_pessoa TEXT DEFAULT 'fisica',
  telefone TEXT,
  email TEXT,
  endereco TEXT,
  observacoes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, documento)
);

-- Enable RLS
ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view own clientes" ON public.clientes
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own clientes" ON public.clientes
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own clientes" ON public.clientes
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own clientes" ON public.clientes
  FOR DELETE USING (auth.uid() = user_id);

-- Trigger for updated_at
CREATE TRIGGER update_clientes_updated_at
  BEFORE UPDATE ON public.clientes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Populate clientes from existing processos
INSERT INTO public.clientes (user_id, nome, documento, tipo_documento, tipo_pessoa)
SELECT DISTINCT
  p.user_id,
  parte->>'name' AS nome,
  parte->>'main_document' AS documento,
  CASE WHEN length(parte->>'main_document') > 14 THEN 'CNPJ' ELSE 'CPF' END AS tipo_documento,
  CASE WHEN length(parte->>'main_document') > 14 THEN 'juridica' ELSE 'fisica' END AS tipo_pessoa
FROM public.processos p,
  jsonb_array_elements(p.partes) AS parte
WHERE parte->>'side' = 'Active'
  AND parte->>'person_type' != 'Advogado'
  AND parte->>'name' IS NOT NULL
ON CONFLICT (user_id, documento) DO NOTHING;
