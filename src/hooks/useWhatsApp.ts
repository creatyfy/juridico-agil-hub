import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export type ConnectionStatus = 'not_configured' | 'disconnected' | 'connecting' | 'connected' | 'loading';

export interface ChatItem {
  remote_jid: string;
  nome: string;
  numero: string;
  foto_url: string | null;
  ultima_mensagem: string;
  ultimo_timestamp: string;
  direcao: string;
  nao_lidas: number;
  is_group: boolean;
}

export interface Message {
  id: string;
  remote_jid: string;
  direcao: string;
  conteudo: string | null;
  tipo: string | null;
  timestamp: string;
  message_id: string | null;
  status_entrega?: string | null;
}

function callEvolution(action: string, params?: Record<string, string>, body?: any) {
  const url = new URL(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/evolution-whatsapp`);
  url.searchParams.set('action', action);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }

  return supabase.auth.getSession().then(({ data: { session } }) => {
    if (!session?.access_token) return Promise.reject(new Error('No active session'));
    return fetch(url.toString(), {
      method: body ? 'POST' : 'GET',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
        'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body: body ? JSON.stringify(body) : undefined,
    }).then(async (r) => {
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (r.status === 401) {
          console.warn('Session expired, signing out...');
          supabase.auth.signOut();
        }
        throw new Error(data?.error || `Edge function returned ${r.status}`);
      }
      return data;
    });
  });
}

export function useWhatsApp() {
  const { user } = useAuth();
  const [status, setStatus] = useState<ConnectionStatus>('loading');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [chats, setChats] = useState<ChatItem[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedChat, setSelectedChat] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const selectedChatRef = useRef<string | null>(null);
  const syncedRef = useRef(false);

  const checkStatus = useCallback(async () => {
    try {
      const res = await callEvolution('status');
      if (res.status === 'not_found') {
        setStatus('disconnected');
      } else if (res.status === 'connected') {
        setStatus('connected');
        callEvolution('set-webhook', undefined, {}).catch(e => console.warn('set-webhook:', e));
      } else if (res.status === 'connecting') {
        setStatus('connecting');
      } else {
        setStatus(prev => prev === 'connecting' ? 'connecting' : 'disconnected');
      }
    } catch {
      setStatus(prev => prev === 'connecting' ? 'connecting' : 'disconnected');
    }
  }, []);

  const connect = useCallback(async () => {
    setLoading(true);
    try {
      const res = await callEvolution('connect', undefined, {});
      if (res.qrcode?.base64) setQrCode(res.qrcode.base64);
      else if (res.qrcode?.code) setQrCode(res.qrcode.code);
      setStatus('connecting');
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshQrCode = useCallback(async () => {
    try {
      const res = await callEvolution('qrcode');
      if (res.qrcode) setQrCode(res.qrcode);
      else if (res.code) setQrCode(res.code);
    } catch (e) { console.error('QR refresh error:', e); }
  }, []);

  const disconnect = useCallback(async () => {
    setLoading(true);
    try {
      await callEvolution('disconnect', undefined, {});
      setStatus('disconnected');
      setQrCode(null);
      setChats([]);
      setMessages([]);
      setSelectedChat(null);
      syncedRef.current = false;
    } finally {
      setLoading(false);
    }
  }, []);

  // Full sync: contacts + chats + photos (once per session)
  const runFullSync = useCallback(async () => {
    if (syncedRef.current) return;
    setSyncing(true);
    try {
      await callEvolution('full-sync', undefined, {});
      syncedRef.current = true;
    } catch (e) {
      console.error('Full sync error:', e);
    } finally {
      setSyncing(false);
    }
  }, []);

  // Load chats from cache table
  const loadChats = useCallback(async () => {
    const { data, error } = await supabase
      .from('whatsapp_chats_cache')
      .select('*')
      .order('ultimo_timestamp', { ascending: false });

    if (error) {
      console.error('Load chats error:', error);
      return;
    }

    setChats((data || []).map((c: any) => ({
      remote_jid: c.remote_jid,
      nome: c.nome || c.remote_jid.replace('@s.whatsapp.net', ''),
      numero: c.remote_jid.replace('@s.whatsapp.net', '').replace('@g.us', '').replace('@lid', ''),
      foto_url: c.foto_url,
      ultima_mensagem: c.ultima_mensagem || '',
      ultimo_timestamp: c.ultimo_timestamp || c.updated_at,
      direcao: c.direcao || 'in',
      nao_lidas: c.nao_lidas || 0,
      is_group: c.is_group || false,
    })));
  }, []);

  const loadMessages = useCallback(async (remoteJid: string) => {
    setSelectedChat(remoteJid);
    selectedChatRef.current = remoteJid;
    try {
      const res = await callEvolution('fetch-messages', { remoteJid });
      setMessages(res.messages || []);
      // Update local unread count
      setChats(prev => prev.map(c =>
        c.remote_jid === remoteJid ? { ...c, nao_lidas: 0 } : c
      ));
    } catch (e) {
      console.error('Load messages error:', e);
    }
  }, []);

  const sendMessage = useCallback(async (number: string, text: string) => {
    const optimisticMsg: Message = {
      id: crypto.randomUUID(),
      remote_jid: number,
      direcao: 'out',
      conteudo: text,
      tipo: 'text',
      timestamp: new Date().toISOString(),
      message_id: null,
    };
    setMessages(prev => [...prev, optimisticMsg]);

    // Update chat list immediately
    setChats(prev => {
      const updated = prev.map(c =>
        c.remote_jid === number
          ? { ...c, ultima_mensagem: text, ultimo_timestamp: new Date().toISOString(), direcao: 'out' }
          : c
      );
      updated.sort((a, b) => new Date(b.ultimo_timestamp).getTime() - new Date(a.ultimo_timestamp).getTime());
      return updated;
    });

    try {
      await callEvolution('send', undefined, { number, text });
    } catch (e) {
      console.error('Send error:', e);
    }
  }, []);

  // Check status on mount
  useEffect(() => {
    if (user) checkStatus();
  }, [user, checkStatus]);

  // Realtime: instance connection status (works regardless of local status state)
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel('whatsapp-instance-status')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'whatsapp_instancias',
      }, (payload) => {
        const inst = payload.new as any;
        if (inst.status === 'connected') {
          setStatus('connected');
        } else if (inst.status === 'connecting') {
          setStatus('connecting');
        } else {
          setStatus(prev => prev === 'connecting' ? 'connecting' : 'disconnected');
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user]);

  // Webhook healthcheck: re-register every 5 min while connected to survive Evolution restarts
  useEffect(() => {
    if (status !== 'connected') return;
    const interval = setInterval(() => {
      callEvolution('set-webhook', undefined, {}).catch(e => console.warn('webhook-healthcheck:', e));
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [status]);

  // Poll status while connecting
  useEffect(() => {
    if (status !== 'connecting') return;
    const interval = setInterval(async () => {
      await checkStatus();
      await refreshQrCode();
    }, 15000);
    return () => clearInterval(interval);
  }, [status, checkStatus, refreshQrCode]);

  // Run full sync when connected, then load chats
  useEffect(() => {
    if (status === 'connected') {
      runFullSync().then(() => loadChats());
    }
  }, [status, runFullSync, loadChats]);

  // Realtime: listen to chats cache changes + new messages
  useEffect(() => {
    if (status !== 'connected') return;

    const channel = supabase
      .channel('whatsapp-realtime-v2')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'whatsapp_chats_cache',
      }, () => {
        // Reload chats on any change
        loadChats();
      })
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'whatsapp_mensagens',
      }, (payload) => {
        const newMsg = payload.new as any;
        const currentChat = selectedChatRef.current;
        if (currentChat && newMsg.remote_jid === currentChat) {
          setMessages(prev => {
            if (newMsg.message_id && prev.some(m => m.message_id === newMsg.message_id)) return prev;
            if (newMsg.direcao === 'out') {
              const recent = prev.filter(m =>
                m.direcao === 'out' &&
                m.conteudo === newMsg.conteudo &&
                Math.abs(new Date(m.timestamp).getTime() - new Date(newMsg.timestamp).getTime()) < 10000
              );
              if (recent.length > 0) return prev;
            }
            return [...prev, {
              id: newMsg.id,
              remote_jid: newMsg.remote_jid,
              direcao: newMsg.direcao,
              conteudo: newMsg.conteudo,
              tipo: newMsg.tipo,
              timestamp: newMsg.timestamp,
              message_id: newMsg.message_id,
              status_entrega: newMsg.status_entrega ?? null,
            }];
          });
        }
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'whatsapp_mensagens',
      }, (payload) => {
        const updated = payload.new as any;
        const currentChat = selectedChatRef.current;
        if (currentChat && updated.remote_jid === currentChat) {
          setMessages(prev => prev.map(m =>
            m.id === updated.id ? { ...m, status_entrega: updated.status_entrega ?? m.status_entrega } : m
          ));
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [status, loadChats]);

  return {
    status, qrCode, chats, messages, selectedChat, loading, syncing,
    connect, disconnect, refreshQrCode, loadChats, loadMessages, sendMessage, checkStatus, setSelectedChat,
  };
}
