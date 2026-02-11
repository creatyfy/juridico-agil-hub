import { useAuth } from '@/contexts/AuthContext';
import { FileText, Users, AlertTriangle, MessageSquare, TrendingUp } from 'lucide-react';
import StatsCard from '@/components/StatsCard';

export default function AdvogadoDashboard() {
  const { user } = useAuth();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Olá, {user?.name?.split(' ')[0] || 'Advogado'}</h1>
        <p className="text-muted-foreground text-sm mt-1">
          OAB {user?.oab}/{user?.uf} — Visão geral do seu escritório
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="Total de Processos"
          value={0}
          icon={<FileText className="h-5 w-5" />}
          trend={{ value: 'Nenhum processo cadastrado', positive: true }}
        />
        <StatsCard
          title="Movimentações Recentes"
          value={0}
          subtitle="Últimos 7 dias"
          icon={<TrendingUp className="h-5 w-5" />}
        />
        <StatsCard
          title="Alertas"
          value={0}
          subtitle="Nenhum alerta"
          icon={<AlertTriangle className="h-5 w-5" />}
        />
        <StatsCard
          title="Clientes"
          value={0}
          subtitle="Nenhum cliente cadastrado"
          icon={<Users className="h-5 w-5" />}
        />
      </div>

      <div className="grid lg:grid-cols-5 gap-6">
        {/* Recent movements */}
        <div className="lg:col-span-3 card-elevated p-6">
          <h3 className="text-lg font-semibold mb-4">Últimas Movimentações</h3>
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <MessageSquare className="h-10 w-10 mb-3 opacity-30" />
            <p className="text-sm">Nenhuma movimentação encontrada</p>
            <p className="text-xs mt-1">Cadastre processos para acompanhar movimentações</p>
          </div>
        </div>

        {/* Recent processos */}
        <div className="lg:col-span-2 card-elevated p-6">
          <h3 className="text-lg font-semibold mb-4">Processos Recentes</h3>
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <FileText className="h-10 w-10 mb-3 opacity-30" />
            <p className="text-sm">Nenhum processo cadastrado</p>
          </div>
        </div>
      </div>
    </div>
  );
}
