import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface Notificacao {
  id: string;
  user_id: string;
  tipo: string;
  titulo: string;
  mensagem: string;
  lida: boolean;
  link: string | null;
  metadata: any;
  created_at: string;
}

export function useNotificacoes() {
  const { user } = useAuth();
  const [notificacoes, setNotificacoes] = useState<Notificacao[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchNotificacoes = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('notificacoes')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (!error && data) setNotificacoes(data as Notificacao[]);
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchNotificacoes(); }, [fetchNotificacoes]);

  // Realtime subscription
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel('notificacoes-realtime')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notificacoes',
      }, (payload) => {
        const newNotif = payload.new as Notificacao;
        if (newNotif.user_id === user.id) {
          setNotificacoes(prev => [newNotif, ...prev]);
        }
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'notificacoes',
      }, () => { fetchNotificacoes(); })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user, fetchNotificacoes]);

  const naoLidas = notificacoes.filter(n => !n.lida).length;

  const marcarComoLida = async (id: string) => {
    await supabase.from('notificacoes').update({ lida: true }).eq('id', id);
    setNotificacoes(prev => prev.map(n => n.id === id ? { ...n, lida: true } : n));
  };

  const marcarTodasComoLidas = async () => {
    const ids = notificacoes.filter(n => !n.lida).map(n => n.id);
    if (ids.length === 0) return;
    await supabase.from('notificacoes').update({ lida: true }).in('id', ids);
    setNotificacoes(prev => prev.map(n => ({ ...n, lida: true })));
  };

  return { notificacoes, naoLidas, loading, marcarComoLida, marcarTodasComoLidas, refetch: fetchNotificacoes };
}
