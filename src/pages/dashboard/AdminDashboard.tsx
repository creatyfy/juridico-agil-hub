import { Users, Scale, Activity, Shield } from 'lucide-react';
import StatsCard from '@/components/StatsCard';
import StatusBadge from '@/components/StatusBadge';

const advogados = [
  { name: 'Dr. Carlos Mendes', oab: '123456/SP', processos: 47, plano: 'Premium', status: 'Ativo' },
  { name: 'Dra. Fernanda Lima', oab: '789012/RJ', processos: 32, plano: 'Básico', status: 'Ativo' },
  { name: 'Dr. Ricardo Souza', oab: '345678/MG', processos: 15, plano: 'Trial', status: 'Trial' },
  { name: 'Dra. Juliana Costa', oab: '901234/SP', processos: 28, plano: 'Premium', status: 'Ativo' },
];

export default function AdminDashboard() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Painel Administrativo</h1>
        <p className="text-muted-foreground text-sm mt-1">Visão geral da plataforma</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard title="Advogados Ativos" value={24} icon={<Scale className="h-5 w-5" />} trend={{ value: '+3 este mês', positive: true }} />
        <StatsCard title="Usuários Totais" value={156} icon={<Users className="h-5 w-5" />} />
        <StatsCard title="Processos Monitorados" value={892} icon={<Activity className="h-5 w-5" />} trend={{ value: '+12%', positive: true }} />
        <StatsCard title="Integrações" value="3/4" subtitle="WhatsApp, Tribunais, IA" icon={<Shield className="h-5 w-5" />} />
      </div>

      <div className="card-elevated">
        <div className="p-6 border-b">
          <h3 className="text-lg font-semibold">Advogados Cadastrados</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-secondary/50">
                <th className="text-left p-4 text-sm font-medium text-muted-foreground">Nome</th>
                <th className="text-left p-4 text-sm font-medium text-muted-foreground">OAB</th>
                <th className="text-left p-4 text-sm font-medium text-muted-foreground">Processos</th>
                <th className="text-left p-4 text-sm font-medium text-muted-foreground">Plano</th>
                <th className="text-left p-4 text-sm font-medium text-muted-foreground">Status</th>
              </tr>
            </thead>
            <tbody>
              {advogados.map((a, i) => (
                <tr key={i} className="border-b last:border-0 hover:bg-secondary/30 transition-colors">
                  <td className="p-4 text-sm font-medium">{a.name}</td>
                  <td className="p-4 text-sm font-mono text-muted-foreground">{a.oab}</td>
                  <td className="p-4 text-sm">{a.processos}</td>
                  <td className="p-4 text-sm">{a.plano}</td>
                  <td className="p-4">
                    <StatusBadge variant={a.status === 'Ativo' ? 'success' : 'warning'}>{a.status}</StatusBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
