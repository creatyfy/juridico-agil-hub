import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from '@/hooks/use-toast';

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
  ai_paused?: boolean;
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

  // Recover cached status from sessionStorage to survive navigation
  const cachedStatus = (typeof window !== 'undefined'
    ? sessionStorage.getItem('whatsapp_status') as ConnectionStatus | null
    : null) || 'loading';

  const [status, setStatusRaw] = useState<ConnectionStatus>(cachedStatus);
  const setStatus: typeof setStatusRaw = (val) => {
    setStatusRaw((prev) => {
      const next = typeof val === 'function' ? val(prev) : val;
      try { sessionStorage.setItem('whatsapp_status', next); } catch {}
      return next;
    });
  };

  const [qrCode, setQrCode] = useState<string | null>(null);
  const [chats, setChats] = useState<ChatItem[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedChat, setSelectedChat] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [aiPausedChats, setAiPausedChats] = useState<Set<string>>(new Set());
  const selectedChatRef = useRef<string | null>(null);
  const syncedRef = useRef(
    typeof window !== 'undefined' ? sessionStorage.getItem('whatsapp_synced') === 'true' : false
  );
  const lastPollRef = useRef<string | null>(null);
  const statusFailureCountRef = useRef(0);

  // Keep selectedChatRef in sync
  useEffect(() => {
    selectedChatRef.current = selectedChat;
  }, [selectedChat]);

  const playNotificationSound = useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(880, ctx.currentTime);
      gain.gain.setValueAtTime(0.001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);

      oscillator.connect(gain);
      gain.connect(ctx.destination);
      oscillator.start();
      oscillator.stop(ctx.currentTime + 0.2);
      setTimeout(() => ctx.close(), 300);
    } catch {
      // no-op
    }
  }, []);

  const checkStatus = useCallback(async () => {
    try {
      const res = await callEvolution('status');
      if (res.status === 'connected') {
        statusFailureCountRef.current = 0;
        setStatus('connected');
        callEvolution('set-webhook', undefined, {}).catch(e => console.warn('set-webhook:', e));
      } else if (res.status === 'connecting') {
        statusFailureCountRef.current = 0;
        setStatus('connecting');
      } else if (res.status === 'disconnected' || res.status === 'not_found') {
        setStatus(prev => {
          if (prev === 'connecting') return 'connecting';
          if (prev === 'connected') {
            statusFailureCountRef.current += 1;
            return statusFailureCountRef.current >= 2 ? 'disconnected' : 'connected';
          }
          statusFailureCountRef.current = 0;
          return 'disconnected';
        });
      }
    } catch {
      setStatus(prev => {
        if (prev === 'connecting') return 'connecting';
        if (prev === 'connected') {
          statusFailureCountRef.current += 1;
          return statusFailureCountRef.current >= 2 ? 'disconnected' : 'connected';
        }
        statusFailureCountRef.current = 0;
        return 'disconnected';
      });
    }
  }, []);

  const connect = useCallback(async () => {
    setLoading(true);
    try {
      const res = await callEvolution('connect', undefined, {});
      if (res.qrcode?.base64) setQrCode(res.qrcode.base64);
      else if (res.qrcode?.code) setQrCode(res.qrcode.code);
      statusFailureCountRef.current = 0;
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
      statusFailureCountRef.current = 0;
      setStatus('disconnected');
      setQrCode(null);
      setChats([]);
      setMessages([]);
      setSelectedChat(null);
      syncedRef.current = false;
      try { sessionStorage.removeItem('whatsapp_synced'); } catch {}
    } finally {
      setLoading(false);
    }
  }, []);

  const runFullSync = useCallback(async () => {
    if (syncedRef.current) return;
    setSyncing(true);
    try {
      await callEvolution('full-sync', undefined, {});
      syncedRef.current = true;
      try { sessionStorage.setItem('whatsapp_synced', 'true'); } catch {}
    } catch (e) {
      console.error('Full sync error:', e);
    } finally {
      setSyncing(false);
    }
  }, []);

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
      setChats(prev => prev.map(c =>
        c.remote_jid === remoteJid ? { ...c, nao_lidas: 0 } : c
      ));
    } catch (e) {
      console.error('Load messages error:', e);
    }
  }, []);

  const sendMessage = useCallback(async (number: string, text: string) => {
    const tempId = `temp_${crypto.randomUUID()}`;
    const optimisticMsg: Message = {
      id: tempId,
      remote_jid: number,
      direcao: 'out',
      conteudo: text,
      tipo: 'text',
      timestamp: new Date().toISOString(),
      message_id: tempId,
    };
    setMessages(prev => [...prev, optimisticMsg]);

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

  const toggleAiPause = useCallback((remoteJid: string) => {
    setAiPausedChats(prev => {
      const next = new Set(prev);
      if (next.has(remoteJid)) next.delete(remoteJid);
      else next.add(remoteJid);
      return next;
    });
  }, []);

  // Check status on mount
  useEffect(() => {
    if (user) checkStatus();
  }, [user, checkStatus]);

  // Realtime: instance connection status
  useEffect(() => {
    if (!user) return;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase
      .channel('whatsapp-instance-status')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'whatsapp_instancias',
      }, (payload) => {
        const inst = payload.new as any;
        if (inst.status === 'connected') {
          statusFailureCountRef.current = 0;
          setStatus('connected');
          if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        } else if (inst.status === 'connecting') {
          statusFailureCountRef.current = 0;
          setStatus('connecting');
        } else {
          setStatus(prev => prev === 'connecting' ? 'connecting' : 'disconnected');
          // Auto-retry after 10s to detect reconnection
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(() => {
            checkStatus().catch(() => {});
          }, 10_000);
        }
      })
      .subscribe();
    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      supabase.removeChannel(channel);
    };
  }, [user, checkStatus]);

  // Webhook healthcheck
  useEffect(() => {
    if (status !== 'connected') return;
    const interval = setInterval(() => {
      callEvolution('set-webhook', undefined, {}).catch(e => console.warn('webhook-healthcheck:', e));
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [status]);

  // Poll status periodically while connected to self-heal stale UI state (every 60s)
  useEffect(() => {
    if (status !== 'connected') return;
    const interval = setInterval(() => {
      checkStatus().catch(() => {});
    }, 60_000);
    return () => clearInterval(interval);
  }, [status, checkStatus]);

  // Poll status while connecting
  useEffect(() => {
    if (status !== 'connecting') return;
    const interval = setInterval(async () => {
      await checkStatus();
      await refreshQrCode();
    }, 15000);
    return () => clearInterval(interval);
  }, [status, checkStatus, refreshQrCode]);

  // Run full sync when connected
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
        loadChats();
      })
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'whatsapp_mensagens',
      }, (payload) => {
        const newMsg = payload.new as any;
        const currentChat = selectedChatRef.current;

        if (newMsg.direcao === 'in') {
          const chatName = chats.find(c => c.remote_jid === newMsg.remote_jid)?.nome
            || newMsg.remote_jid.replace('@s.whatsapp.net', '');
          const preview = (newMsg.conteudo || '[mídia]').slice(0, 80);

          playNotificationSound();

          toast({
            title: `💬 ${chatName}`,
            description: preview,
          });
        }

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
  }, [status, loadChats, chats, playNotificationSound]);

  // Polling fallback every 10s for active conversation
  useEffect(() => {
    if (status !== 'connected') return;

    const interval = setInterval(async () => {
      const currentChat = selectedChatRef.current;
      if (!currentChat) return;

      try {
        const res = await callEvolution('fetch-messages', { remoteJid: currentChat });
        const fetched: Message[] = res.messages || [];
        if (fetched.length === 0) return;

        setMessages(prev => {
          const existingIds = new Set(prev.map(m => m.message_id).filter(Boolean));
          const newOnes = fetched.filter(m => m.message_id && !existingIds.has(m.message_id));
          if (newOnes.length === 0) return prev;
          return [...prev, ...newOnes];
        });
      } catch {
        // Silent fallback
      }
    }, 10_000);

    return () => clearInterval(interval);
  }, [status]);

  return {
    status, qrCode, chats, messages, selectedChat, loading, syncing, aiPausedChats,
    connect, disconnect, refreshQrCode, loadChats, loadMessages, sendMessage,
    checkStatus, setSelectedChat, toggleAiPause,
  };
}
