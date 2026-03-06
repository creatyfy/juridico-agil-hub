CREATE UNIQUE INDEX IF NOT EXISTS idx_clientes_numero_whatsapp_unique 
ON public.clientes (numero_whatsapp) WHERE numero_whatsapp IS NOT NULL;