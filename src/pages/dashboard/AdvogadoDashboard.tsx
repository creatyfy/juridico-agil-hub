import { FileText, Users, AlertTriangle, MessageSquare, TrendingUp } from 'lucide-react';
import StatsCard from '@/components/StatsCard';
import StatusBadge from '@/components/StatusBadge';
import TimelineEvent from '@/components/TimelineEvent';

const recentMovements = [
  { date: '09/02/2026 14:30', title: 'Despacho publicado', description: 'Processo 0001234-56.2025.8.26.0100 — Intimação para manifestação em 15 dias.', type: 'important' as const },
  { date: '08/02/2026 09:15', title: 'Juntada de petição', description: 'Processo 0007890-12.2024.8.26.0100 — Petição intermediária protocolada.', type: 'default' as const },
  { date: '07/02/2026 16:45', title: 'Sentença proferida', description: 'Processo 0004567-89.2025.8.26.0100 — Julgamento procedente. Recurso possível.', type: 'alert' as const },
  { date: '06/02/2026 11:00', title: 'Audiência designada', description: 'Processo 0002345-67.2025.8.26.0100 — Audiência de conciliação para 15/03/2026.', type: 'default' as const },
];

const recentProcessos = [
  { numero: '0001234-56.2025.8.26.0100', cliente: 'Maria Silva', status: 'Em andamento', vara: '1ª Vara Cível' },
  { numero: '0007890-12.2024.8.26.0100', cliente: 'João Santos', status: 'Aguardando', vara: '3ª Vara Trabalhista' },
  { numero: '0004567-89.2025.8.26.0100', cliente: 'Ana Oliveira', status: 'Sentenciado', vara: '2ª Vara de Família' },
];

export default function AdvogadoDashboard() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">Visão geral do seu escritório</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="Total de Processos"
          value={47}
          icon={<FileText className="h-5 w-5" />}
          trend={{ value: '3 novos este mês', positive: true }}
        />
        <StatsCard
          title="Movimentações Recentes"
          value={12}
          subtitle="Últimos 7 dias"
          icon={<TrendingUp className="h-5 w-5" />}
        />
        <StatsCard
          title="Alertas"
          value={3}
          subtitle="Prazos próximos"
          icon={<AlertTriangle className="h-5 w-5" />}
          trend={{ value: '1 urgente', positive: false }}
        />
        <StatsCard
          title="WhatsApp"
          value="Ativo"
          subtitle="5 conversas abertas"
          icon={<MessageSquare className="h-5 w-5" />}
        />
      </div>

      <div className="grid lg:grid-cols-5 gap-6">
        {/* Recent movements */}
        <div className="lg:col-span-3 card-elevated p-6">
          <h3 className="text-lg font-semibold mb-4">Últimas Movimentações</h3>
          <div className="space-y-0">
            {recentMovements.map((m, i) => (
              <TimelineEvent
                key={i}
                date={m.date}
                title={m.title}
                description={m.description}
                type={m.type}
                isLast={i === recentMovements.length - 1}
              />
            ))}
          </div>
        </div>

        {/* Recent processos */}
        <div className="lg:col-span-2 card-elevated p-6">
          <h3 className="text-lg font-semibold mb-4">Processos Recentes</h3>
          <div className="space-y-3">
            {recentProcessos.map((p, i) => (
              <div key={i} className="p-3 rounded-lg bg-secondary/50 hover:bg-secondary transition-colors cursor-pointer">
                <p className="text-xs font-mono text-muted-foreground">{p.numero}</p>
                <p className="text-sm font-medium mt-1">{p.cliente}</p>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-xs text-muted-foreground">{p.vara}</span>
                  <StatusBadge variant={p.status === 'Em andamento' ? 'info' : p.status === 'Sentenciado' ? 'success' : 'warning'}>
                    {p.status}
                  </StatusBadge>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
