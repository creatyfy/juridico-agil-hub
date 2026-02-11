import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface Processo {
  id: string;
  numero_cnj: string;
  tribunal: string | null;
  vara: string | null;
  classe: string | null;
  assunto: string | null;
  partes: any;
  status: string | null;
  data_distribuicao: string | null;
  judit_process_id: string | null;
  fonte: string | null;
  created_at: string;
  updated_at: string;
}

export interface Movimentacao {
  id: string;
  processo_id: string;
  data_movimentacao: string | null;
  tipo: string | null;
  descricao: string;
  conteudo: string | null;
  created_at: string;
}

export function useProcessos() {
  const { user } = useAuth();
  const [processos, setProcessos] = useState<Processo[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchProcessos = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('processos')
      .select('*')
      .order('updated_at', { ascending: false });

    if (!error && data) setProcessos(data as Processo[]);
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchProcessos(); }, [fetchProcessos]);

  return { processos, loading, refetch: fetchProcessos };
}

export function useMovimentacoes(processoId: string | undefined) {
  const [movimentacoes, setMovimentacoes] = useState<Movimentacao[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchMovimentacoes = useCallback(async () => {
    if (!processoId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('movimentacoes')
      .select('*')
      .eq('processo_id', processoId)
      .order('data_movimentacao', { ascending: false });

    if (!error && data) setMovimentacoes(data as Movimentacao[]);
    setLoading(false);
  }, [processoId]);

  useEffect(() => { fetchMovimentacoes(); }, [fetchMovimentacoes]);

  // Realtime subscription
  useEffect(() => {
    if (!processoId) return;
    const channel = supabase
      .channel(`movimentacoes-${processoId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'movimentacoes',
        filter: `processo_id=eq.${processoId}`,
      }, () => { fetchMovimentacoes(); })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [processoId, fetchMovimentacoes]);

  return { movimentacoes, loading, refetch: fetchMovimentacoes };
}

export async function searchJuditProcesses(oab: string) {
  const { data, error } = await supabase.functions.invoke('search-processes', {
    body: { action: 'create', search_type: 'oab', search_key: oab },
  });
  if (error) throw error;
  return data;
}

export async function checkJuditRequestStatus(requestId: string) {
  const { data, error } = await supabase.functions.invoke('search-processes', {
    body: { action: 'status', request_id: requestId },
  });
  if (error) throw error;
  return data;
}

export async function getJuditResults(requestId: string) {
  const { data, error } = await supabase.functions.invoke('search-processes', {
    body: { action: 'results', request_id: requestId },
  });
  if (error) throw error;
  return data;
}

export async function importProcesses(processos: any[]) {
  const { data, error } = await supabase.functions.invoke('import-processes', {
    body: { processos },
  });
  if (error) throw error;
  return data;
}

export async function syncProcessMovements(processoId?: string) {
  const { data, error } = await supabase.functions.invoke('sync-movements', {
    body: processoId ? { processo_id: processoId } : {},
  });
  if (error) throw error;
  return data;
}
