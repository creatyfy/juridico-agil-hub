import { useState, useRef, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { MessageSquare, Send, Wifi, WifiOff, QrCode, RefreshCw, Phone, ArrowLeft, Search, Smile, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { useWhatsApp, type Conversation, type Message } from '@/hooks/useWhatsApp';
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

function ConversationList({ conversations, selectedChat, onSelect, searchTerm, onSearchChange }: {
  conversations: Conversation[];
  selectedChat: string | null;
  onSelect: (jid: string) => void;
  searchTerm: string;
  onSearchChange: (v: string) => void;
}) {
  const filtered = conversations.filter(c =>
    c.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.numero.includes(searchTerm)
  );

  return (
    <div className="flex flex-col h-full border-r">
      <div className="p-3 border-b bg-card">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar conversa..." value={searchTerm} onChange={e => onSearchChange(e.target.value)} className="pl-9" />
        </div>
      </div>
      <ScrollArea className="flex-1">
        {filtered.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            Nenhuma conversa encontrada
          </div>
        ) : filtered.map(conv => (
          <button
            key={conv.remote_jid}
            onClick={() => onSelect(conv.remote_jid)}
            className={`w-full flex items-center gap-3 p-3 hover:bg-accent/50 transition-colors text-left ${
              selectedChat === conv.remote_jid ? 'bg-accent' : ''
            }`}
          >
            <Avatar className="h-12 w-12 shrink-0">
              {conv.foto_url && <AvatarImage src={conv.foto_url} alt={conv.nome} />}
              <AvatarFallback className="text-xs bg-primary/10 text-primary">
                {conv.nome.substring(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex justify-between items-baseline">
                <span className="font-medium text-sm truncate">{conv.nome}</span>
                <span className="text-[10px] text-muted-foreground shrink-0 ml-2">
                  {conv.last_timestamp ? format(new Date(conv.last_timestamp), 'HH:mm', { locale: ptBR }) : ''}
                </span>
              </div>
              <p className="text-xs text-muted-foreground truncate">
                {conv.direcao === 'out' && '✓ '}{conv.last_message}
              </p>
            </div>
          </button>
        ))}
      </ScrollArea>
    </div>
  );
}

function MessageBubble({ msg }: { msg: Message }) {
  const isOut = msg.direcao === 'out';
  const tipo = msg.tipo || 'text';
  
  // Render content based on type
  let content: React.ReactNode;
  
  if (tipo === 'image' || tipo === 'imageMessage') {
    content = (
      <div>
        {msg.conteudo?.startsWith('http') ? (
          <img src={msg.conteudo} alt="imagem" className="max-w-full rounded-md mb-1" />
        ) : (
          <p className="whitespace-pre-wrap break-words">📷 Imagem</p>
        )}
      </div>
    );
  } else if (tipo === 'sticker' || tipo === 'stickerMessage') {
    content = (
      <div>
        {msg.conteudo?.startsWith('http') ? (
          <img src={msg.conteudo} alt="figurinha" className="w-32 h-32 object-contain" />
        ) : (
          <p className="text-3xl">🏷️</p>
        )}
      </div>
    );
  } else if (tipo === 'audio' || tipo === 'audioMessage') {
    content = <p className="whitespace-pre-wrap break-words">🎤 Áudio</p>;
  } else if (tipo === 'video' || tipo === 'videoMessage') {
    content = <p className="whitespace-pre-wrap break-words">🎥 Vídeo</p>;
  } else if (tipo === 'document' || tipo === 'documentMessage') {
    content = <p className="whitespace-pre-wrap break-words">📎 Documento</p>;
  } else {
    content = <p className="whitespace-pre-wrap break-words">{msg.conteudo || '[mídia]'}</p>;
  }

  return (
    <div className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[75%] rounded-lg px-3 py-2 text-sm shadow-sm ${
        isOut
          ? 'bg-primary text-primary-foreground rounded-br-none'
          : 'bg-muted rounded-bl-none'
      }`}>
        {content}
        <p className={`text-[10px] mt-1 text-right ${isOut ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
          {format(new Date(msg.timestamp), 'HH:mm')}
        </p>
      </div>
    </div>
  );
}

function ChatView({ messages, selectedChat, conversations, onSend, onBack }: {
  messages: Message[];
  selectedChat: string;
  conversations: Conversation[];
  onSend: (text: string) => void;
  onBack: () => void;
}) {
  const [text, setText] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const emojiRef = useRef<HTMLDivElement>(null);
  const contact = conversations.find(c => c.remote_jid === selectedChat);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Close emoji picker on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) {
        setShowEmoji(false);
      }
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

  const onEmojiClick = (emojiData: any) => {
    setText(prev => prev + emojiData.emoji);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 p-3 border-b bg-card">
        <Button variant="ghost" size="icon" className="md:hidden" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Avatar className="h-10 w-10">
          {contact?.foto_url && <AvatarImage src={contact.foto_url} alt={contact.nome} />}
          <AvatarFallback className="text-xs bg-primary/10 text-primary">
            {(contact?.nome || '?').substring(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div>
          <p className="font-medium text-sm">{contact?.nome || selectedChat.replace('@s.whatsapp.net', '')}</p>
          <p className="text-[10px] text-muted-foreground">{contact?.numero || ''}</p>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4" style={{ background: 'var(--chat-bg, hsl(var(--muted)/0.3))' }}>
        <div className="space-y-2 max-w-2xl mx-auto">
          {messages.map((msg) => (
            <MessageBubble key={msg.id} msg={msg} />
          ))}
          <div ref={scrollRef} />
        </div>
      </ScrollArea>

      {/* Input with emoji */}
      <div className="relative p-3 border-t bg-card">
        {showEmoji && (
          <div ref={emojiRef} className="absolute bottom-full left-0 mb-2 z-50">
            <EmojiPicker
              onEmojiClick={onEmojiClick}
              emojiStyle={EmojiStyle.NATIVE}
              theme={Theme.AUTO}
              width={350}
              height={400}
              searchPlaceholder="Buscar emoji..."
              lazyLoadEmojis
            />
          </div>
        )}
        <div className="flex gap-2 items-center">
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            onClick={() => setShowEmoji(!showEmoji)}
          >
            {showEmoji ? <X className="h-5 w-5" /> : <Smile className="h-5 w-5" />}
          </Button>
          <Input
            placeholder="Digite uma mensagem..."
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
            className="flex-1"
          />
          <Button onClick={handleSend} disabled={!text.trim()} size="icon" className="shrink-0">
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

  if (wpp.status === 'loading') {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Atendimento</h1>
          <p className="text-muted-foreground text-sm mt-1">Central de atendimento via WhatsApp</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusIndicator status={wpp.status} />
          {(wpp.status === 'connected' || wpp.status === 'connecting') && (
            <Button variant="outline" size="sm" onClick={wpp.disconnect} disabled={wpp.loading}>
              <WifiOff className="h-3 w-3 mr-1" />Desconectar
            </Button>
          )}
        </div>
      </div>

      {/* State: Disconnected */}
      {(wpp.status === 'disconnected') && (
        <div className="card-elevated flex flex-col items-center justify-center p-16 text-center">
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

      {/* State: Connecting (QR Code) */}
      {wpp.status === 'connecting' && (
        <div className="card-elevated">
          <QrCodeView qrCode={wpp.qrCode} onRefresh={wpp.refreshQrCode} loading={wpp.loading} />
        </div>
      )}

      {/* State: Connected (Chat) */}
      {wpp.status === 'connected' && (
        <div className="card-elevated h-[calc(100vh-12rem)] flex overflow-hidden rounded-lg">
          {/* Mobile: show list or chat */}
          <div className={`w-full md:w-80 shrink-0 ${wpp.selectedChat ? 'hidden md:flex md:flex-col' : 'flex flex-col'}`}>
            <ConversationList
              conversations={wpp.conversations}
              selectedChat={wpp.selectedChat}
              onSelect={(jid) => wpp.loadMessages(jid)}
              searchTerm={searchTerm}
              onSearchChange={setSearchTerm}
            />
          </div>
          <div className={`flex-1 ${!wpp.selectedChat ? 'hidden md:flex' : 'flex'} flex-col`}>
            {wpp.selectedChat ? (
              <ChatView
                messages={wpp.messages}
                selectedChat={wpp.selectedChat}
                conversations={wpp.conversations}
                onSend={(text) => wpp.sendMessage(wpp.selectedChat!, text)}
                onBack={() => wpp.setSelectedChat(null)}
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
