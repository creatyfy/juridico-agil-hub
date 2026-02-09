import TimelineEvent from '@/components/TimelineEvent';
import StatusBadge from '@/components/StatusBadge';

const processos = [
  {
    numero: '0001234-56.2025.8.26.0100',
    vara: '1ª Vara Cível — São Paulo/SP',
    status: 'Em andamento',
    advogado: 'Dr. Carlos Mendes',
    movimentacoes: [
      { date: '09/02/2026', title: 'Despacho publicado', description: 'Intimação para manifestação em 15 dias.', type: 'important' as const },
      { date: '01/02/2026', title: 'Petição protocolada', description: 'Petição intermediária juntada aos autos.', type: 'default' as const },
      { date: '15/01/2026', title: 'Distribuição', description: 'Processo distribuído à 1ª Vara Cível.', type: 'default' as const },
    ],
  },
];

export default function ClienteDashboard() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Meus Processos</h1>
        <p className="text-muted-foreground text-sm mt-1">Acompanhe o andamento dos seus processos</p>
      </div>

      {processos.map((p, i) => (
        <div key={i} className="card-elevated p-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-2">
            <div>
              <p className="font-mono text-sm text-muted-foreground">{p.numero}</p>
              <p className="text-sm mt-1">{p.vara}</p>
              <p className="text-xs text-muted-foreground mt-1">Advogado: {p.advogado}</p>
            </div>
            <StatusBadge variant="info">{p.status}</StatusBadge>
          </div>

          <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">Movimentações</h3>
          <div className="space-y-0">
            {p.movimentacoes.map((m, j) => (
              <TimelineEvent
                key={j}
                date={m.date}
                title={m.title}
                description={m.description}
                type={m.type}
                isLast={j === p.movimentacoes.length - 1}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
