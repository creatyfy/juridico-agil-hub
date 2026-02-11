import { Bell, FileText, UserPlus, Info, CheckCheck } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useNotificacoes, Notificacao } from '@/hooks/useNotificacoes';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useState } from 'react';

const tipoIcon: Record<string, React.ReactNode> = {
  movimentacao: <FileText className="h-4 w-4 text-accent" />,
  convite: <UserPlus className="h-4 w-4 text-green-500" />,
  sistema: <Info className="h-4 w-4 text-muted-foreground" />,
};

function NotificationItem({ notif, onRead }: { notif: Notificacao; onRead: (n: Notificacao) => void }) {
  const timeAgo = formatDistanceToNow(new Date(notif.created_at), { addSuffix: true, locale: ptBR });

  return (
    <button
      onClick={() => onRead(notif)}
      className={cn(
        'w-full text-left px-4 py-3 flex gap-3 items-start hover:bg-secondary/50 transition-colors border-b border-border last:border-0',
        !notif.lida && 'bg-accent/5'
      )}
    >
      <div className="mt-0.5 shrink-0">
        {tipoIcon[notif.tipo] || tipoIcon.sistema}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={cn('text-sm font-medium truncate', !notif.lida && 'text-foreground', notif.lida && 'text-muted-foreground')}>
            {notif.titulo}
          </span>
          {!notif.lida && <span className="w-2 h-2 rounded-full bg-accent shrink-0" />}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{notif.mensagem}</p>
        <span className="text-[11px] text-muted-foreground/60 mt-1 block">{timeAgo}</span>
      </div>
    </button>
  );
}

export default function NotificationCenter() {
  const { notificacoes, naoLidas, marcarComoLida, marcarTodasComoLidas } = useNotificacoes();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const handleRead = (notif: Notificacao) => {
    if (!notif.lida) marcarComoLida(notif.id);
    if (notif.link) {
      setOpen(false);
      navigate(notif.link);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="relative p-2 rounded-md hover:bg-secondary transition-colors">
          <Bell className="h-5 w-5 text-muted-foreground" />
          {naoLidas > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-accent text-accent-foreground text-[10px] font-bold px-1">
              {naoLidas > 99 ? '99+' : naoLidas}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0" sideOffset={8}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold">Notificações</h3>
          {naoLidas > 0 && (
            <button
              onClick={marcarTodasComoLidas}
              className="flex items-center gap-1 text-xs text-accent hover:underline"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Marcar todas como lidas
            </button>
          )}
        </div>
        <ScrollArea className="max-h-[360px]">
          {notificacoes.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center px-4">
              <Bell className="h-8 w-8 text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">Nenhuma notificação</p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                Você receberá alertas sobre movimentações e convites aqui.
              </p>
            </div>
          ) : (
            notificacoes.map(n => (
              <NotificationItem key={n.id} notif={n} onRead={handleRead} />
            ))
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
