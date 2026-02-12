import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export type ConnectionStatus = 'not_configured' | 'disconnected' | 'connecting' | 'connected' | 'loading';

export interface Conversation {
  remote_jid: string;
  nome: string;
  numero: string;
  foto_url: string | null;
  last_message: string;
  last_timestamp: string;
  direcao: string;
}

export interface Message {
  id: string;
  remote_jid: string;
  direcao: string;
  conteudo: string | null;
  tipo: string | null;
  timestamp: string;
  message_id: string | null;
}

function callEvolution(action: string, params?: Record<string, string>, body?: any) {
  const url = new URL(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/evolution-whatsapp`);
  url.searchParams.set('action', action);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }

  return supabase.auth.getSession().then(({ data: { session } }) => {
    if (!session?.access_token) {
      return Promise.reject(new Error('No active session'));
    }
    return fetch(url.toString(), {
      method: body ? 'POST' : 'GET',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
        'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body: body ? JSON.stringify(body) : undefined,
    }).then(r => r.json());
  });
}

export function useWhatsApp() {
  const { user } = useAuth();
  const [status, setStatus] = useState<ConnectionStatus>('loading');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedChat, setSelectedChat] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const selectedChatRef = useRef<string | null>(null);

  // Keep ref in sync
  useEffect(() => {
    selectedChatRef.current = selectedChat;
  }, [selectedChat]);

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
      if (res.qrcode?.base64) {
        setQrCode(res.qrcode.base64);
      } else if (res.qrcode?.code) {
        setQrCode(res.qrcode.code);
      }
      setStatus('connecting');
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshQrCode = useCallback(async () => {
    try {
      const res = await callEvolution('qrcode');
      if (res.qrcode) {
        setQrCode(res.qrcode);
      } else if (res.code) {
        setQrCode(res.code);
      }
    } catch (e) {
      console.error('QR refresh error:', e);
    }
  }, []);

  const disconnect = useCallback(async () => {
    setLoading(true);
    try {
      await callEvolution('disconnect', undefined, {});
      setStatus('disconnected');
      setQrCode(null);
      setConversations([]);
      setMessages([]);
      setSelectedChat(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadConversations = useCallback(async () => {
    try {
      const res = await callEvolution('fetch-chats', undefined, {});
      if (res.conversations && res.conversations.length > 0) {
        setConversations(res.conversations);
        return;
      }
    } catch (e) {
      console.error('fetch-chats error:', e);
    }
    const res = await callEvolution('conversations');
    setConversations(res.conversations || []);
  }, []);

  const loadMessages = useCallback(async (remoteJid: string) => {
    setSelectedChat(remoteJid);
    try {
      const res = await callEvolution('fetch-messages', { remoteJid });
      if (res.messages && res.messages.length > 0) {
        setMessages(res.messages);
        return;
      }
    } catch (e) {
      console.error('fetch-messages error:', e);
    }
    const res = await callEvolution('messages', { remoteJid });
    setMessages(res.messages || []);
  }, []);

  const sendMessage = useCallback(async (number: string, text: string) => {
    // Optimistically add the message to the UI
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

    try {
      await callEvolution('send', undefined, { number, text });
    } catch (e) {
      console.error('Send error:', e);
    }
  }, []);

  // Check status on mount
  useEffect(() => {
    if (user) {
      checkStatus();
    }
  }, [user, checkStatus]);

  // Poll status while connecting
  useEffect(() => {
    if (status !== 'connecting') return;
    const interval = setInterval(async () => {
      await checkStatus();
      await refreshQrCode();
    }, 15000);
    return () => clearInterval(interval);
  }, [status, checkStatus, refreshQrCode]);

  // Load conversations when connected
  useEffect(() => {
    if (status === 'connected') {
      loadConversations();
    }
  }, [status, loadConversations]);

  // Realtime subscription for new messages - uses ref to avoid re-subscribing on chat change
  useEffect(() => {
    if (status !== 'connected') return;

    const channel = supabase
      .channel('whatsapp-realtime')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'whatsapp_mensagens',
      }, (payload) => {
        const newMsg = payload.new as any;
        
        // Update conversation list with the new message
        setConversations(prev => {
          const idx = prev.findIndex(c => c.remote_jid === newMsg.remote_jid);
          if (idx >= 0) {
            const updated = [...prev];
            updated[idx] = {
              ...updated[idx],
              last_message: newMsg.conteudo || '[mídia]',
              last_timestamp: newMsg.timestamp,
              direcao: newMsg.direcao,
            };
            // Re-sort by timestamp
            updated.sort((a, b) => new Date(b.last_timestamp).getTime() - new Date(a.last_timestamp).getTime());
            return updated;
          }
          return prev;
        });

        // If this message belongs to the currently open chat, add it to messages
        const currentChat = selectedChatRef.current;
        if (currentChat && newMsg.remote_jid === currentChat) {
          setMessages(prev => {
            // Avoid duplicates by message_id
            if (newMsg.message_id && prev.some(m => m.message_id === newMsg.message_id)) {
              return prev;
            }
            // Also avoid duplicates for optimistic messages (same content + direction within 10s)
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
            }];
          });
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [status]);

  return {
    status,
    qrCode,
    conversations,
    messages,
    selectedChat,
    loading,
    connect,
    disconnect,
    refreshQrCode,
    loadConversations,
    loadMessages,
    sendMessage,
    checkStatus,
    setSelectedChat,
  };
}
