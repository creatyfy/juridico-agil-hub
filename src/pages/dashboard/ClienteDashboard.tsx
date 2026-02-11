import { useAuth } from '@/contexts/AuthContext';
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Scale } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import StatusBadge from '@/components/StatusBadge';

interface ProcessoVinculado {
  id: string;
  numero_cnj: string;
  classe: string | null;
  tribunal: string | null;
  status: string | null;
}

export default function ClienteDashboard() {
  const { user } = useAuth();
  const [processos, setProcessos] = useState<ProcessoVinculado[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function autoAcceptAndFetch() {
      if (!user) return;

      // Auto-accept pending invite if token stored
      const pendingToken = localStorage.getItem('pending_invite_token');
      if (pendingToken) {
        localStorage.removeItem('pending_invite_token');
        try {
          await supabase.functions.invoke('aceitar-convite', {
            body: { token: pendingToken, action: 'accept' },
          });
        } catch (e) {
          console.error('Auto-accept failed:', e);
        }
      }

      // Find cliente record linked to this auth user
      const { data: cliente } = await supabase
        .from('clientes')
        .select('id')
        .eq('auth_user_id', user.id)
        .maybeSingle();

      if (!cliente) {
        setLoading(false);
        return;
      }

      // Fetch active process links
      const { data: vinculos } = await supabase
        .from('cliente_processos')
        .select('processo_id')
        .eq('cliente_id', cliente.id)
        .eq('status', 'ativo');

      if (!vinculos || vinculos.length === 0) {
        setLoading(false);
        return;
      }

      const processoIds = vinculos.map(v => v.processo_id);
      const { data: procs } = await supabase
        .from('processos')
        .select('id, numero_cnj, classe, tribunal, status')
        .in('id', processoIds);

      if (procs) setProcessos(procs);
      setLoading(false);
    }

    autoAcceptAndFetch();
  }, [user]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Olá, {user?.name?.split(' ')[0] || 'Cliente'}</h1>
        <p className="text-muted-foreground text-sm mt-1">Acompanhe o andamento dos seus processos</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center p-12">
          <div className="h-6 w-6 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
        </div>
      ) : processos.length === 0 ? (
        <div className="card-elevated flex flex-col items-center justify-center p-16 text-center">
          <FileText className="h-12 w-12 text-muted-foreground/30 mb-4" />
          <h3 className="text-lg font-semibold text-muted-foreground">Nenhum processo encontrado</h3>
          <p className="text-sm text-muted-foreground/70 mt-1 max-w-sm">
            Seus processos aparecerão aqui quando seu advogado vinculá-los à sua conta.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {processos.map(proc => (
            <Link key={proc.id} to={`/processos/${proc.id}`} className="block">
              <div className="bg-card rounded-xl border p-4 hover:border-accent/40 hover:bg-accent/5 transition-all">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Scale className="h-5 w-5 text-accent shrink-0" />
                    <div>
                      <p className="font-mono text-sm font-semibold text-foreground">{proc.numero_cnj}</p>
                      <p className="text-xs text-muted-foreground">{proc.classe}{proc.tribunal ? ` • ${proc.tribunal}` : ''}</p>
                    </div>
                  </div>
                  <StatusBadge variant={proc.status === 'ativo' ? 'success' : 'neutral'}>
                    {proc.status || 'ativo'}
                  </StatusBadge>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
