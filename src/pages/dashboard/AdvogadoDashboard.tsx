import { useAuth } from '@/contexts/AuthContext';
import { FileText, Users, AlertTriangle, TrendingUp } from 'lucide-react';
import StatsCard from '@/components/StatsCard';
import { useProcessos } from '@/hooks/useProcessos';
import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export default function AdvogadoDashboard() {
  const { user } = useAuth();
  const { processos, loading } = useProcessos();
  const [recentMovs, setRecentMovs] = useState(0);
  const [totalClientes, setTotalClientes] = useState(0);
  const [clientesAtivos, setClientesAtivos] = useState(0);

  useEffect(() => {
    async function fetchRecentMovs() {
      if (processos.length === 0) return;
      const ids = processos.map(p => p.id);
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const { count } = await supabase
        .from('movimentacoes')
        .select('*', { count: 'exact', head: true })
        .in('processo_id', ids)
        .gte('data_movimentacao', sevenDaysAgo.toISOString());

      setRecentMovs(count || 0);
    }
    fetchRecentMovs();
  }, [processos]);

  useEffect(() => {
    async function fetchClientes() {
      const { count: total } = await supabase
        .from('clientes')
        .select('*', { count: 'exact', head: true });

      const { count: ativos } = await supabase
        .from('clientes')
        .select('*', { count: 'exact', head: true })
        .not('auth_user_id', 'is', null);

      setTotalClientes(total || 0);
      setClientesAtivos(ativos || 0);
    }
    fetchClientes();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Olá, {user?.name?.split(' ')[0] || 'Advogado'}</h1>
        <p className="text-muted-foreground text-sm mt-1">
          OAB {user?.oab}/{user?.uf} — Visão geral do seu escritório
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="Total de Processos"
          value={loading ? '...' : processos.length}
          icon={<FileText className="h-5 w-5" />}
        />
        <StatsCard
          title="Movimentações Recentes"
          value={recentMovs}
          subtitle="Últimos 7 dias"
          icon={<TrendingUp className="h-5 w-5" />}
        />
        <StatsCard title="Alertas" value={0} subtitle="Nenhum alerta" icon={<AlertTriangle className="h-5 w-5" />} />
        <StatsCard title="Clientes" value={totalClientes} subtitle={`${clientesAtivos} ativo(s) no sistema`} icon={<Users className="h-5 w-5" />} />
      </div>

      <div className="grid lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 card-elevated p-6">
          <h3 className="text-lg font-semibold mb-4">Processos Recentes</h3>
          {processos.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <FileText className="h-10 w-10 mb-3 opacity-30" />
              <p className="text-sm">Nenhum processo importado</p>
              <Link to="/processos" className="text-xs text-primary mt-1 hover:underline">Importar processos</Link>
            </div>
          ) : (
            <div className="space-y-3">
              {processos.slice(0, 5).map(p => (
                <Link key={p.id} to={`/processos/${p.id}`} className="block p-3 rounded-lg hover:bg-accent/5 transition-colors border border-border/50">
                  <p className="font-mono text-sm font-semibold">{p.numero_cnj}</p>
                  <p className="text-xs text-muted-foreground">{p.classe}{p.tribunal ? ` • ${p.tribunal}` : ''}</p>
                </Link>
              ))}
              {processos.length > 5 && (
                <Link to="/processos" className="text-sm text-primary hover:underline block text-center pt-2">
                  Ver todos ({processos.length})
                </Link>
              )}
            </div>
          )}
        </div>

        <div className="lg:col-span-2 card-elevated p-6">
          <h3 className="text-lg font-semibold mb-4">Ações Rápidas</h3>
          <div className="space-y-2">
            <Link to="/processos" className="block p-3 rounded-lg hover:bg-accent/5 transition-colors border border-border/50 text-sm">
              📥 Importar processos da Judit
            </Link>
            <Link to="/processos" className="block p-3 rounded-lg hover:bg-accent/5 transition-colors border border-border/50 text-sm">
              🔄 Atualizar movimentações
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
