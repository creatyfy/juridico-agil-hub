import { useState, useRef, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { MessageSquare, Send, Wifi, WifiOff, QrCode, RefreshCw, Phone, ArrowLeft, Search, Smile, X, Loader2, RotateCcw, Bot, BotOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useWhatsApp, type ChatItem, type Message } from '@/hooks/useWhatsApp';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import EmojiPicker, { EmojiStyle, Theme } from 'emoji-picker-react';

function StatusIndicator({ status }: { status: string }) {
  if (status === 'connected') return <Badge variant="default" className="bg-green-600"><Wifi className="h-3 w-3 mr-1" />Conectado</Badge>;
  if (status === 'connecting') return <Badge variant="secondary"><RefreshCw className="h-3 w-3 mr-1 animate-spin" />Conectando...</Badge>;
  return <Badge variant="outline"><WifiOff className="h-3 w-3 mr-1" />Desconectado</Badge>;
}

function QrCodeView({ qrCode, onRefresh, loading }: { qrCode: string | null; onRefresh: () => void; loading: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center space-y-6">
      <QrCode className="h-12 w-12 text-primary" />
      <div>
        <h3 className="text-lg font-semibold">Conectar WhatsApp</h3>
        <p className="text-sm text-muted-foreground mt-1 max-w-md">
          Abra o WhatsApp no celular → Menu (⋮) → Aparelhos conectados → Conectar aparelho → Escaneie o QR Code abaixo
        </p>
      </div>
      {qrCode ? (
        qrCode.startsWith('data:') || qrCode.length > 500 ? (
          <div className="bg-white p-4 rounded-xl shadow-md">
            <img src={qrCode.startsWith('data:') ? qrCode : `data:image/png;base64,${qrCode}`} alt="QR Code" className="w-64 h-64" />
          </div>
        ) : (
          <div className="bg-white p-4 rounded-xl shadow-md">
            <QRCodeSVG value={qrCode} size={256} />
          </div>
        )
      ) : (
        <div className="w-64 h-64 bg-muted rounded-xl flex items-center justify-center">
          <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}
      <Button variant="outline" onClick={onRefresh} disabled={loading}>
        <RefreshCw className="h-4 w-4 mr-2" />Atualizar QR Code
      </Button>
    </div>
  );
}

function ChatListItem({ chat, isSelected, onSelect, hasNewMessage }: { chat: ChatItem; isSelected: boolean; onSelect: () => void; hasNewMessage?: boolean }) {
  const timeStr = chat.ultimo_timestamp
    ? (() => {
        const d = new Date(chat.ultimo_timestamp);
        const now = new Date();
        const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays === 0) return format(d, 'HH:mm', { locale: ptBR });
        if (diffDays === 1) return 'Ontem';
        if (diffDays < 7) return format(d, 'EEEE', { locale: ptBR });
        return format(d, 'dd/MM/yyyy', { locale: ptBR });
      })()
    : '';

  return (
    <button
      onClick={onSelect}
      className={`w-full flex items-center gap-3 px-3 py-3 hover:bg-[#f0f2f5] dark:hover:bg-zinc-800 transition-colors text-left border-b border-border/20 relative ${
        isSelected ? 'bg-[#f0f2f5] dark:bg-zinc-800' : ''
      } ${hasNewMessage && !isSelected ? 'animate-pulse' : ''}`}
    >
      <Avatar className="h-12 w-12 shrink-0">
        <AvatarImage 
          src={chat.foto_url ?? undefined} 
          alt={chat.nome}
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
        <AvatarFallback className="text-xs bg-primary/10 text-primary font-semibold">
          {chat.nome.substring(0, 2).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-baseline">
          <span className="font-medium text-sm truncate">{chat.nome}</span>
          <span className={`text-[10px] shrink-0 ml-2 ${chat.nao_lidas > 0 ? 'text-green-600 font-semibold' : 'text-muted-foreground'}`}>
            {timeStr}
          </span>
        </div>
        <div className="flex justify-between items-center mt-0.5">
          <p className="text-xs text-muted-foreground truncate flex-1">
            {chat.direcao === 'out' && '✓ '}{chat.ultima_mensagem}
          </p>
          <div className="flex items-center gap-1 ml-2 shrink-0">
            {chat.ai_paused ? (
              <BotOff className="h-3 w-3 text-muted-foreground" />
            ) : (
              <Bot className="h-3 w-3 text-green-500" />
            )}
            {chat.nao_lidas > 0 && (
              <span className="bg-green-600 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">
                {chat.nao_lidas}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

function ConversationList({ chats, selectedChat, onSelect, searchTerm, onSearchChange, onRefresh, recentlyUpdatedJids }: {
  chats: ChatItem[];
  selectedChat: string | null;
  onSelect: (jid: string) => void;
  searchTerm: string;
  onSearchChange: (v: string) => void;
  onRefresh: () => void;
  recentlyUpdatedJids: Set<string>;
}) {
  const filtered = chats.filter(c =>
    c.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.numero.includes(searchTerm)
  );

  return (
    <div className="flex flex-col h-full border-r bg-white dark:bg-zinc-900">
      <div className="p-3 border-b bg-white dark:bg-zinc-900 space-y-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Buscar conversa..." value={searchTerm} onChange={e => onSearchChange(e.target.value)} className="pl-9" />
          </div>
          <Button variant="ghost" size="icon" className="shrink-0" onClick={onRefresh} title="Atualizar conversas">
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <ScrollArea className="flex-1">
        {filtered.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            Nenhuma conversa encontrada
          </div>
        ) : filtered.map(chat => (
          <ChatListItem
            key={chat.remote_jid}
            chat={chat}
            isSelected={selectedChat === chat.remote_jid}
            onSelect={() => onSelect(chat.remote_jid)}
            hasNewMessage={recentlyUpdatedJids.has(chat.remote_jid)}
          />
        ))}
      </ScrollArea>
    </div>
  );
}

function DeliveryTick({ status }: { status?: string | null }) {
  if (status === 'error') return <span className="text-[9px]">⚠</span>;
  if (status === 'read' || status === 'played') return <span className="text-[9px] text-blue-300">✓✓</span>;
  if (status === 'delivered') return <span className="text-[9px]">✓✓</span>;
  if (status === 'sent') return <span className="text-[9px]">✓</span>;
  return <span className="text-[9px] opacity-50">🕐</span>;
}

function formatDateLabel(timestamp: string): string {
  const d = new Date(timestamp);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.floor((today.getTime() - msgDay.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Hoje';
  if (diffDays === 1) return 'Ontem';
  return format(d, "d 'de' MMMM", { locale: ptBR });
}

function DateSeparator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 my-2">
      <div className="flex-1 h-px bg-border/40" />
      <span className="text-[10px] text-muted-foreground px-2 select-none">{label}</span>
      <div className="flex-1 h-px bg-border/40" />
    </div>
  );
}

function MessageBubble({ msg }: { msg: Message }) {
  const isOut = msg.direcao === 'out';
  return (
    <div className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] sm:max-w-[75%] rounded-lg px-3 py-2 text-sm shadow-sm ${
        isOut
          ? 'bg-[#dcf8c6] dark:bg-emerald-800 text-black dark:text-white rounded-br-none'
          : 'bg-white border border-border shadow-sm rounded-bl-none'
      }`}>
        <p className="whitespace-pre-wrap break-words">{msg.conteudo || '[mídia]'}</p>
        <p className={`text-[10px] mt-1 text-right flex items-center justify-end gap-1 ${isOut ? 'text-black/60 dark:text-white/70' : 'text-muted-foreground'}`}>
          {format(new Date(msg.timestamp), 'HH:mm')}
          {isOut && <DeliveryTick status={msg.status_entrega} />}
        </p>
      </div>
    </div>
  );
}

function ChatView({ messages, selectedChat, chats, onSend, onBack, aiPaused, onToggleAi }: {
  messages: Message[];
  selectedChat: string;
  chats: ChatItem[];
  onSend: (text: string) => void;
  onBack: () => void;
  aiPaused: boolean;
  onToggleAi: () => void;
}) {
  const [text, setText] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const emojiRef = useRef<HTMLDivElement>(null);
  const contact = chats.find(c => c.remote_jid === selectedChat);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) setShowEmoji(false);
    }
    if (showEmoji) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showEmoji]);

  const handleSend = () => {
    if (!text.trim()) return;
    onSend(text.trim());
    setText('');
    setShowEmoji(false);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 p-3 border-b bg-white dark:bg-zinc-900 shadow-sm">
        <Button variant="ghost" size="icon" className="md:hidden shrink-0" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Avatar className="h-10 w-10 shrink-0">
          {contact?.foto_url && <AvatarImage src={contact.foto_url} alt={contact?.nome || '?'} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />}
          <AvatarFallback className="text-xs bg-primary/10 text-primary font-semibold">
            {(contact?.nome || '?').substring(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm truncate">{contact?.nome || selectedChat.replace('@s.whatsapp.net', '')}</p>
          <p className="text-[10px] text-muted-foreground">{contact?.numero || ''}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={aiPaused ? 'outline' : 'secondary'}
                size="sm"
                onClick={onToggleAi}
                className="gap-1.5 text-xs"
              >
                {aiPaused ? <BotOff className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
                <span className="hidden sm:inline">{aiPaused ? 'IA Pausada' : 'IA Ativa'}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{aiPaused ? 'Retomar IA nesta conversa' : 'Pausar IA nesta conversa'}</TooltipContent>
          </Tooltip>
          <Badge variant={aiPaused ? 'outline' : 'default'} className={`text-[10px] ${aiPaused ? '' : 'bg-green-600'}`}>
            {aiPaused ? 'IA Off' : 'IA On'}
          </Badge>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-3 sm:p-4 bg-[#efeae2] dark:bg-zinc-800" style={{ backgroundImage: "radial-gradient(rgba(0,0,0,0.03) 0.8px, transparent 0.8px)", backgroundSize: "14px 14px" }}>
        <div className="space-y-2 max-w-2xl mx-auto">
          {messages.length === 0 && (
            <div className="text-center text-muted-foreground text-sm py-8">
              Nenhuma mensagem ainda. Envie a primeira!
            </div>
          )}
          {messages.map((msg, i) => {
            const label = formatDateLabel(msg.timestamp);
            const showSeparator = i === 0 || formatDateLabel(messages[i - 1].timestamp) !== label;
            return (
              <div key={msg.id}>
                {showSeparator && <DateSeparator label={label} />}
                <MessageBubble msg={msg} />
              </div>
            );
          })}
          <div ref={scrollRef} />
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="relative p-3 sm:p-4 border-t bg-white dark:bg-zinc-900">
        {showEmoji && (
          <div ref={emojiRef} className="absolute bottom-full left-0 mb-2 z-50">
            <EmojiPicker
              onEmojiClick={(emojiData: any) => setText(prev => prev + emojiData.emoji)}
              emojiStyle={EmojiStyle.NATIVE}
              theme={Theme.AUTO}
              width={320}
              height={350}
              searchPlaceholder="Buscar emoji..."
              lazyLoadEmojis
            />
          </div>
        )}
        <div className="flex gap-2 items-center">
          <Button variant="ghost" size="icon" className="shrink-0 hidden sm:flex" onClick={() => setShowEmoji(!showEmoji)}>
            {showEmoji ? <X className="h-5 w-5" /> : <Smile className="h-5 w-5" />}
          </Button>
          <Input
            placeholder="Digite uma mensagem..."
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
            className="flex-1 rounded-full px-4 py-2.5 bg-white dark:bg-zinc-800"
          />
          <Button onClick={handleSend} size="icon" className="shrink-0 rounded-full" disabled={!text.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function Atendimento() {
  const wpp = useWhatsApp();
  const [searchTerm, setSearchTerm] = useState('');
  const [recentlyUpdatedJids, setRecentlyUpdatedJids] = useState<Set<string>>(new Set());

  // Track recently updated chats for visual indicator
  useEffect(() => {
    if (wpp.status !== 'connected') return;
    const channel = supabase
      .channel('atendimento-new-msg-indicator')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'whatsapp_mensagens',
      }, (payload) => {
        const msg = payload.new as any;
        if (msg.direcao === 'in' && msg.remote_jid !== wpp.selectedChat) {
          setRecentlyUpdatedJids(prev => new Set(prev).add(msg.remote_jid));
          // Clear after 5s
          setTimeout(() => {
            setRecentlyUpdatedJids(prev => {
              const next = new Set(prev);
              next.delete(msg.remote_jid);
              return next;
            });
          }, 5000);
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [wpp.status, wpp.selectedChat]);

  // Merge AI pause state into chats
  const chatsWithAi = wpp.chats.map(c => ({
    ...c,
    ai_paused: wpp.aiPausedChats.has(c.remote_jid),
  }));

  if (wpp.status === 'loading') {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Atendimento</h1>
          <p className="text-muted-foreground text-xs sm:text-sm mt-1">Central de atendimento via WhatsApp</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {wpp.syncing && (
            <Badge variant="secondary" className="gap-1">
              <Loader2 className="h-3 w-3 animate-spin" />Sincronizando...
            </Badge>
          )}
          <StatusIndicator status={wpp.status} />
          {(wpp.status === 'connected' || wpp.status === 'connecting') && (
            <Button variant="outline" size="sm" onClick={wpp.disconnect} disabled={wpp.loading}>
              <WifiOff className="h-3 w-3 mr-1" />Desconectar
            </Button>
          )}
        </div>
      </div>

      {wpp.status === 'disconnected' && (
        <div className="card-elevated flex flex-col items-center justify-center p-8 sm:p-16 text-center">
          <Phone className="h-12 w-12 text-muted-foreground/30 mb-4" />
          <h3 className="text-lg font-semibold text-muted-foreground">WhatsApp não conectado</h3>
          <p className="text-sm text-muted-foreground/70 mt-1 max-w-sm mb-6">
            Conecte seu WhatsApp para começar a atender seus clientes diretamente por aqui.
          </p>
          <Button onClick={wpp.connect} disabled={wpp.loading}>
            <QrCode className="h-4 w-4 mr-2" />{wpp.loading ? 'Conectando...' : 'Conectar WhatsApp'}
          </Button>
        </div>
      )}

      {wpp.status === 'connecting' && (
        <div className="card-elevated">
          <QrCodeView qrCode={wpp.qrCode} onRefresh={wpp.refreshQrCode} loading={wpp.loading} />
        </div>
      )}

      {wpp.status === 'connected' && (
        <div className="card-elevated h-[calc(100vh-10rem)] sm:h-[calc(100vh-12rem)] flex overflow-hidden rounded-lg">
          <div className={`w-full md:w-80 shrink-0 ${wpp.selectedChat ? 'hidden md:flex md:flex-col' : 'flex flex-col'}`}>
            <ConversationList
              chats={chatsWithAi}
              selectedChat={wpp.selectedChat}
              onSelect={(jid) => {
                setRecentlyUpdatedJids(prev => {
                  const next = new Set(prev);
                  next.delete(jid);
                  return next;
                });
                wpp.loadMessages(jid);
              }}
              searchTerm={searchTerm}
              onSearchChange={setSearchTerm}
              onRefresh={wpp.loadChats}
              recentlyUpdatedJids={recentlyUpdatedJids}
            />
          </div>
          <div className={`flex-1 ${!wpp.selectedChat ? 'hidden md:flex' : 'flex'} flex-col`}>
            {wpp.selectedChat ? (
              <ChatView
                messages={wpp.messages}
                selectedChat={wpp.selectedChat}
                chats={chatsWithAi}
                onSend={(text) => wpp.sendMessage(wpp.selectedChat!, text)}
                onBack={() => wpp.setSelectedChat(null)}
                aiPaused={wpp.aiPausedChats.has(wpp.selectedChat)}
                onToggleAi={() => wpp.toggleAiPause(wpp.selectedChat!)}
              />
            ) : (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                <div className="text-center">
                  <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">Selecione uma conversa</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Need to import supabase for the realtime channel in the component
// eslint-disable-next-line react-refresh/only-export-components
import { supabase } from '@/integrations/supabase/client';
