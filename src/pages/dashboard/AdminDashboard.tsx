import { useEffect, useState } from 'react';
import { Users, Scale, Activity, Wifi } from 'lucide-react';
import StatsCard from '@/components/StatsCard';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';

interface AdminStats {
  total_advogados: number;
  total_clientes: number;
  processos_monitorados: number;
  instancias_ativas: number;
  advogados: Array<{
    user_id: string;
    email: string;
    nome: string;
    oab: string;
    uf: string;
    created_at: string;
    qtd_processos: number;
    qtd_clientes: number;
  }>;
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.rpc('get_admin_stats').then(({ data, error: rpcError }) => {
      if (rpcError) setError(rpcError.message);
      else setStats(data as AdminStats);
      setLoading(false);
    });
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Painel Administrativo</h1>
        <p className="text-muted-foreground text-sm mt-1">Visão geral da plataforma</p>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/20 p-4 text-sm text-destructive">
          Erro ao carregar estatísticas: {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="Advogados Ativos"
          value={loading ? '...' : (stats?.total_advogados ?? 0)}
          icon={<Scale className="h-5 w-5" />}
        />
        <StatsCard
          title="Clientes Cadastrados"
          value={loading ? '...' : (stats?.total_clientes ?? 0)}
          icon={<Users className="h-5 w-5" />}
        />
        <StatsCard
          title="Processos Monitorados"
          value={loading ? '...' : (stats?.processos_monitorados ?? 0)}
          icon={<Activity className="h-5 w-5" />}
        />
        <StatsCard
          title="WhatsApp Conectados"
          value={loading ? '...' : (stats?.instancias_ativas ?? 0)}
          subtitle={!loading && stats?.instancias_ativas === 0 ? 'Nenhuma instância ativa' : undefined}
          icon={<Wifi className="h-5 w-5" />}
        />
      </div>

      <div className="card-elevated">
        <div className="p-6 border-b">
          <h3 className="text-lg font-semibold">Advogados Cadastrados</h3>
        </div>

        {loading ? (
          <div className="flex items-center justify-center p-12">
            <p className="text-sm text-muted-foreground">Carregando...</p>
          </div>
        ) : !stats?.advogados?.length ? (
          <div className="flex flex-col items-center justify-center p-12 text-center">
            <Scale className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">Nenhum advogado cadastrado ainda</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left px-6 py-3 font-medium text-muted-foreground">Advogado</th>
                  <th className="text-left px-6 py-3 font-medium text-muted-foreground">OAB</th>
                  <th className="text-center px-6 py-3 font-medium text-muted-foreground">Processos</th>
                  <th className="text-center px-6 py-3 font-medium text-muted-foreground">Clientes</th>
                  <th className="text-left px-6 py-3 font-medium text-muted-foreground">Cadastro</th>
                </tr>
              </thead>
              <tbody>
                {stats.advogados.map((adv) => (
                  <tr key={adv.user_id} className="border-b last:border-0 hover:bg-muted/20">
                    <td className="px-6 py-4">
                      <p className="font-medium">{adv.nome}</p>
                      <p className="text-xs text-muted-foreground">{adv.email}</p>
                    </td>
                    <td className="px-6 py-4">
                      <Badge variant="outline">{adv.oab}/{adv.uf}</Badge>
                    </td>
                    <td className="px-6 py-4 text-center">{adv.qtd_processos}</td>
                    <td className="px-6 py-4 text-center">{adv.qtd_clientes}</td>
                    <td className="px-6 py-4 text-muted-foreground">
                      {new Date(adv.created_at).toLocaleDateString('pt-BR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
