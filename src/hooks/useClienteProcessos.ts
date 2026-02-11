import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface ClienteProcesso {
  id: string;
  cliente_id: string;
  processo_id: string;
  advogado_user_id: string;
  status: string;
  token: string;
  data_convite: string;
  data_aceite: string | null;
  created_at: string;
}

export function useClienteProcessos(clienteId: string | undefined) {
  const [vinculos, setVinculos] = useState<ClienteProcesso[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    if (!clienteId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('cliente_processos')
      .select('*')
      .eq('cliente_id', clienteId);

    if (!error && data) setVinculos(data as ClienteProcesso[]);
    setLoading(false);
  }, [clienteId]);

  useEffect(() => { fetch(); }, [fetch]);

  return { vinculos, loading, refetch: fetch };
}

export async function convidarProcesso(clienteId: string, processoId: string) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Não autenticado');

  const response = await supabase.functions.invoke('convidar-processo', {
    body: { cliente_id: clienteId, processo_id: processoId },
  });

  if (response.error) throw new Error(response.error.message);
  return response.data;
}
