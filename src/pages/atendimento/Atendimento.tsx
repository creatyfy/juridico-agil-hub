import { MessageSquare, Bot, User, Wifi, WifiOff } from 'lucide-react';
import StatusBadge from '@/components/StatusBadge';

const conversas = [
  { id: '1', cliente: 'Maria Silva', ultimaMsg: 'Olá, gostaria de saber sobre o andamento do meu processo.', hora: '14:30', tipo: 'automatico', naoLidas: 2 },
  { id: '2', cliente: 'João Santos', ultimaMsg: 'Obrigado pela atualização!', hora: '11:20', tipo: 'humano', naoLidas: 0 },
  { id: '3', cliente: 'Ana Oliveira', ultimaMsg: 'Quando será a próxima audiência?', hora: '09:45', tipo: 'automatico', naoLidas: 1 },
  { id: '4', cliente: 'Pedro Costa', ultimaMsg: 'Preciso enviar documentos adicionais.', hora: 'Ontem', tipo: 'humano', naoLidas: 0 },
];

export default function Atendimento() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Atendimento</h1>
          <p className="text-muted-foreground text-sm mt-1">Central de atendimento via WhatsApp</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-success/10">
          <Wifi className="h-4 w-4 text-success" />
          <span className="text-sm font-medium text-success">WhatsApp Conectado</span>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Conversations list */}
        <div className="card-elevated overflow-hidden">
          <div className="p-4 border-b">
            <h3 className="font-semibold text-sm">Conversas</h3>
          </div>
          <div className="divide-y">
            {conversas.map((c) => (
              <div key={c.id} className="p-4 hover:bg-secondary/50 transition-colors cursor-pointer">
                <div className="flex items-start justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center shrink-0">
                      <span className="text-xs font-semibold text-primary-foreground">{c.cliente.charAt(0)}</span>
                    </div>
                    <span className="text-sm font-medium">{c.cliente}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">{c.hora}</span>
                </div>
                <p className="text-xs text-muted-foreground truncate ml-10">{c.ultimaMsg}</p>
                <div className="flex items-center gap-2 mt-2 ml-10">
                  <StatusBadge variant={c.tipo === 'automatico' ? 'info' : 'neutral'}>
                    {c.tipo === 'automatico' ? <><Bot className="h-3 w-3 mr-1" />Auto</> : <><User className="h-3 w-3 mr-1" />Humano</>}
                  </StatusBadge>
                  {c.naoLidas > 0 && (
                    <span className="bg-accent text-accent-foreground text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                      {c.naoLidas}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Chat area placeholder */}
        <div className="lg:col-span-2 card-elevated flex flex-col items-center justify-center p-12 text-center">
          <MessageSquare className="h-12 w-12 text-muted-foreground/30 mb-4" />
          <h3 className="text-lg font-semibold text-muted-foreground">Selecione uma conversa</h3>
          <p className="text-sm text-muted-foreground/70 mt-1 max-w-sm">
            Clique em uma conversa à esquerda para visualizar o histórico de mensagens e interagir com o cliente.
          </p>
        </div>
      </div>
    </div>
  );
}
