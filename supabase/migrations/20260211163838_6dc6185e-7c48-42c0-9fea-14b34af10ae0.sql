
-- Table to map OAB+CPF to user for passwordless login
CREATE TABLE public.advogado_credentials (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  oab TEXT NOT NULL,
  uf TEXT NOT NULL,
  cpf TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Unique constraint: one credential set per OAB+UF
CREATE UNIQUE INDEX idx_advogado_credentials_oab_uf ON public.advogado_credentials (oab, uf);
CREATE INDEX idx_advogado_credentials_cpf ON public.advogado_credentials (cpf);

-- Enable RLS
ALTER TABLE public.advogado_credentials ENABLE ROW LEVEL SECURITY;

-- Only the edge function (service role) will insert/read this table
-- No public access needed
CREATE POLICY "Service role full access"
ON public.advogado_credentials
FOR ALL
USING (true)
WITH CHECK (true);
