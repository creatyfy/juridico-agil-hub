import { useAuth } from '@/contexts/AuthContext';
import { FileText, Users, AlertTriangle, TrendingUp, MessageCircle } from 'lucide-react';
import StatsCard from '@/components/StatsCard';
import { useProcessos } from '@/hooks/useProcessos';
import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import OnboardingBanner from '@/components/OnboardingBanner';

export default function AdvogadoDashboard() {
  const { user } = useAuth();
  const { processos, loading } = useProcessos();
  const [recentMovs, setRecentMovs] = useState(0);
  const [totalClientes, setTotalClientes] = useState(0);
  const [clientesAtivos, setClientesAtivos] = useState(0);
  const [processosSemCliente, setProcessosSemCliente] = useState(0);
  const [msgsSemana, setMsgsSemana] = useState(0);
  const [clientesWhatsApp, setClientesWhatsApp] = useState(0);

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
    async function fetchProcessosSemCliente() {
      if (processos.length === 0) {
        setProcessosSemCliente(0);
        return;
      }

      const processoIds = processos.map((p) => p.id);
      const { data } = await supabase
        .from('cliente_processos')
        .select('processo_id')
        .in('processo_id', processoIds)
        .in('status', ['pendente', 'ativo']);

      const linkedIds = new Set((data || []).map((row: any) => row.processo_id));
      setProcessosSemCliente(processoIds.filter((id) => !linkedIds.has(id)).length);
    }

    fetchProcessosSemCliente();
  }, [processos]);

  useEffect(() => {
    async function fetchClientes() {
      const { count: total } = await supabase
        .from('clientes')
        .select('*', { count: 'exact', head: true });

      const { count: ativos } = await supabase
        .from('clientes')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'ativo');

      setTotalClientes(total || 0);
      setClientesAtivos(ativos || 0);
    }
    fetchClientes();
  }, []);

  useEffect(() => {
    async function fetchWhatsAppStats() {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const { count: msgs } = await (supabase as any)
        .from('message_outbox')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', sevenDaysAgo.toISOString())
        .in('status', ['sent', 'delivered', 'pending', 'retry']);

      const { count: wppClientes } = await (supabase as any)
        .from('whatsapp_contacts')
        .select('*', { count: 'exact', head: true })
        .eq('verified', true)
        .eq('notifications_opt_in', true);

      setMsgsSemana(msgs || 0);
      setClientesWhatsApp(wppClientes || 0);
    }
    fetchWhatsAppStats();
  }, []);

  return (
    <div className="space-y-6">
      <OnboardingBanner />
      <div>
        <h1 className="text-2xl font-bold">Olá, {user?.name?.split(' ')[0] || 'Advogado'}</h1>
        <p className="text-muted-foreground text-sm mt-1">
          OAB {user?.oab}/{user?.uf} — Visão geral do seu escritório
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <div className="xl:col-span-1 sm:col-span-1">
          <StatsCard
            title="Total de Processos"
            value={loading ? '...' : processos.length}
            icon={<FileText className="h-5 w-5" />}
          />
        </div>
        <div className="xl:col-span-1 sm:col-span-1">
          <StatsCard
            title="Movimentações"
            value={recentMovs}
            subtitle="Últimos 7 dias"
            icon={<TrendingUp className="h-5 w-5" />}
          />
        </div>
        <div className="xl:col-span-1 sm:col-span-1">
          <StatsCard
            title="Alertas"
            value={processosSemCliente}
            subtitle={processosSemCliente > 0 ? 'Sem cliente vinculado' : 'Nenhum alerta'}
            icon={<AlertTriangle className="h-5 w-5" />}
          />
        </div>
        <div className="xl:col-span-1 sm:col-span-1">
          <StatsCard title="Clientes" value={totalClientes} subtitle={`${clientesAtivos} ativo(s)`} icon={<Users className="h-5 w-5" />} />
        </div>
        <div className="xl:col-span-1 sm:col-span-1">
          <StatsCard
            title="Msgs WhatsApp"
            value={msgsSemana}
            subtitle="Últimos 7 dias"
            icon={<MessageCircle className="h-5 w-5" />}
          />
        </div>
        <div className="xl:col-span-1 sm:col-span-1">
          <StatsCard
            title="Clientes c/ WhatsApp"
            value={clientesWhatsApp}
            subtitle="Notificações ativas"
            icon={<MessageCircle className="h-5 w-5" />}
          />
        </div>
      </div>

      {processosSemCliente > 0 && (
        <div className="card-elevated p-4 border-yellow-500/30 bg-yellow-500/10">
          <p className="text-sm font-medium">⚠️ Você possui {processosSemCliente} processo(s) sem cliente vinculado.</p>
          <Link to="/processos" className="text-xs text-primary hover:underline">Ir para processos e corrigir</Link>
        </div>
      )}

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
            <Link to="/campanhas" className="block p-3 rounded-lg hover:bg-accent/5 transition-colors border border-border/50 text-sm">
              📣 Criar campanha WhatsApp
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
