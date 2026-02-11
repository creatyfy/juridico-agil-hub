import { useAuth } from '@/contexts/AuthContext';
import { Users, Scale, Activity, Shield } from 'lucide-react';
import StatsCard from '@/components/StatsCard';

export default function AdminDashboard() {
  const { user } = useAuth();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Painel Administrativo</h1>
        <p className="text-muted-foreground text-sm mt-1">Visão geral da plataforma</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard title="Advogados Ativos" value={0} icon={<Scale className="h-5 w-5" />} />
        <StatsCard title="Usuários Totais" value={0} icon={<Users className="h-5 w-5" />} />
        <StatsCard title="Processos Monitorados" value={0} icon={<Activity className="h-5 w-5" />} />
        <StatsCard title="Integrações" value="0" subtitle="Nenhuma integração ativa" icon={<Shield className="h-5 w-5" />} />
      </div>

      <div className="card-elevated">
        <div className="p-6 border-b">
          <h3 className="text-lg font-semibold">Advogados Cadastrados</h3>
        </div>
        <div className="flex flex-col items-center justify-center p-12 text-center">
          <Scale className="h-10 w-10 text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground">Nenhum advogado cadastrado ainda</p>
        </div>
      </div>
    </div>
  );
}
