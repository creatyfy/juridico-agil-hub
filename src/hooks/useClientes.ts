import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface Cliente {
  id: string;
  user_id: string;
  nome: string;
  documento: string | null;
  tipo_documento: string | null;
  tipo_pessoa: string | null;
  telefone: string | null;
  email: string | null;
  endereco: string | null;
  observacoes: string | null;
  numero_whatsapp: string | null;
  status: string | null;
  status_vinculo: string | null;
  created_at: string;
  updated_at: string;
}

export function useClientes() {
  const { user } = useAuth();
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchClientes = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('clientes')
      .select('*')
      .order('nome', { ascending: true });

    if (!error && data) setClientes(data as Cliente[]);
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchClientes(); }, [fetchClientes]);

  return { clientes, loading, refetch: fetchClientes };
}

export function useCliente(id: string | undefined) {
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchCliente = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('clientes')
      .select('*')
      .eq('id', id)
      .single();

    if (!error && data) setCliente(data as Cliente);
    setLoading(false);
  }, [id]);

  useEffect(() => { fetchCliente(); }, [fetchCliente]);

  return { cliente, loading, refetch: fetchCliente };
}

export async function updateCliente(id: string, updates: Partial<Cliente>) {
  const { error } = await supabase
    .from('clientes')
    .update(updates)
    .eq('id', id);
  if (error) throw error;
}
