import { useState, useEffect, useCallback } from 'react';
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

  const checkStatus = useCallback(async () => {
    try {
      const res = await callEvolution('status');
      if (res.status === 'not_found') {
        setStatus('disconnected');
      } else if (res.status === 'connected') {
        setStatus('connected');
        // Ensure webhook is configured when connected (fire and forget)
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
    // Try to fetch chats directly from Evolution API first
    try {
      const res = await callEvolution('fetch-chats', undefined, {});
      if (res.conversations && res.conversations.length > 0) {
        setConversations(res.conversations);
        return;
      }
    } catch (e) {
      console.error('fetch-chats error:', e);
    }
    // Fallback to DB-based conversations
    const res = await callEvolution('conversations');
    setConversations(res.conversations || []);
  }, []);

  const loadMessages = useCallback(async (remoteJid: string) => {
    setSelectedChat(remoteJid);
    const res = await callEvolution('messages', { remoteJid });
    setMessages(res.messages || []);
  }, []);

  const sendMessage = useCallback(async (number: string, text: string) => {
    await callEvolution('send', undefined, { number, text });
    // Reload messages
    if (selectedChat) {
      await loadMessages(selectedChat);
    }
  }, [selectedChat, loadMessages]);

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

  // Realtime subscription for new messages
  useEffect(() => {
    if (status !== 'connected') return;

    const channel = supabase
      .channel('whatsapp-messages')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'whatsapp_mensagens',
      }, () => {
        loadConversations();
        if (selectedChat) loadMessages(selectedChat);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [status, selectedChat, loadConversations, loadMessages]);

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
