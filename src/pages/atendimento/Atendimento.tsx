import { MessageSquare } from 'lucide-react';

export default function Atendimento() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Atendimento</h1>
        <p className="text-muted-foreground text-sm mt-1">Central de atendimento via WhatsApp</p>
      </div>

      <div className="card-elevated flex flex-col items-center justify-center p-16 text-center">
        <MessageSquare className="h-12 w-12 text-muted-foreground/30 mb-4" />
        <h3 className="text-lg font-semibold text-muted-foreground">Nenhuma conversa</h3>
        <p className="text-sm text-muted-foreground/70 mt-1 max-w-sm">
          As conversas com seus clientes aparecerão aqui quando o WhatsApp for integrado.
        </p>
      </div>
    </div>
  );
}
