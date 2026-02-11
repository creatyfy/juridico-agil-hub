import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, FileText, RefreshCw, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useMovimentacoes, syncProcessMovements } from '@/hooks/useProcessos';
import type { Processo } from '@/hooks/useProcessos';
import StatusBadge from '@/components/StatusBadge';
import TimelineEvent from '@/components/TimelineEvent';
import { toast } from 'sonner';

export default function ProcessoDetail() {
  const { id } = useParams();
  const [processo, setProcesso] = useState<Processo | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const { movimentacoes, loading: movsLoading, refetch: refetchMovs } = useMovimentacoes(id);

  const fetchProcesso = useCallback(async () => {
    if (!id) return;
    const { data, error } = await supabase
      .from('processos')
      .select('*')
      .eq('id', id)
      .single();
    if (!error && data) setProcesso(data as Processo);
    setLoading(false);
  }, [id]);

  useEffect(() => { fetchProcesso(); }, [fetchProcesso]);

  const handleSync = async () => {
    if (!id) return;
    setSyncing(true);
    try {
      const result = await syncProcessMovements(id);
      const newCount = result?.results?.[0]?.newMovements || 0;
      toast.success(`${newCount} nova(s) movimentação(ões)`);
      refetchMovs();
    } catch (err: any) {
      toast.error(err.message || 'Erro ao sincronizar');
    }
    setSyncing(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="h-6 w-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (!processo) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Link to="/processos">
            <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" /> Voltar</Button>
          </Link>
        </div>
        <div className="card-elevated flex flex-col items-center justify-center p-16 text-center">
          <FileText className="h-12 w-12 text-muted-foreground/30 mb-4" />
          <h3 className="text-lg font-semibold text-muted-foreground">Processo não encontrado</h3>
        </div>
      </div>
    );
  }

  const partes = Array.isArray(processo.partes) ? processo.partes : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/processos">
            <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" /> Voltar</Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold font-mono">{processo.numero_cnj}</h1>
            <p className="text-sm text-muted-foreground">{processo.classe}{processo.tribunal ? ` • ${processo.tribunal}` : ''}</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
          <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? 'animate-spin' : ''}`} />
          Atualizar
        </Button>
      </div>

      {/* Info cards */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="card-elevated p-4">
          <p className="text-xs text-muted-foreground mb-1">Status</p>
          <StatusBadge variant={processo.status === 'ativo' ? 'success' : 'neutral'}>
            {processo.status || 'ativo'}
          </StatusBadge>
        </div>
        {processo.vara && (
          <div className="card-elevated p-4">
            <p className="text-xs text-muted-foreground mb-1">Vara</p>
            <p className="text-sm font-medium">{processo.vara}</p>
          </div>
        )}
        {processo.assunto && (
          <div className="card-elevated p-4">
            <p className="text-xs text-muted-foreground mb-1">Assunto</p>
            <p className="text-sm font-medium">{processo.assunto}</p>
          </div>
        )}
        <div className="card-elevated p-4">
          <p className="text-xs text-muted-foreground mb-1">Fonte</p>
          <p className="text-sm font-medium capitalize">{processo.fonte || 'judit'}</p>
        </div>
        {processo.data_distribuicao && (
          <div className="card-elevated p-4">
            <p className="text-xs text-muted-foreground mb-1">Distribuição</p>
            <p className="text-sm font-medium">{new Date(processo.data_distribuicao).toLocaleDateString('pt-BR')}</p>
          </div>
        )}
      </div>

      {/* Partes */}
      {partes.length > 0 && (
        <div className="card-elevated p-6">
          <h3 className="text-lg font-semibold mb-3">Partes</h3>
          <div className="space-y-2">
            {partes.map((parte: any, idx: number) => (
              <div key={idx} className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground font-medium uppercase text-xs w-24 shrink-0">
                  {parte.side || parte.tipo || parte.role || 'Parte'}
                </span>
                <span>{parte.name || parte.nome || JSON.stringify(parte)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Movimentações */}
      <div className="card-elevated p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Movimentações ({movimentacoes.length})</h3>
        </div>

        {movsLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {!movsLoading && movimentacoes.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <p className="text-sm">Nenhuma movimentação registrada</p>
            <p className="text-xs mt-1">Clique em "Atualizar" para buscar na Judit</p>
          </div>
        )}

        {!movsLoading && movimentacoes.length > 0 && (
          <div className="space-y-0">
            {movimentacoes.map((mov, idx) => (
              <TimelineEvent
                key={mov.id}
                date={mov.data_movimentacao ? new Date(mov.data_movimentacao).toLocaleDateString('pt-BR') : 'Sem data'}
                title={mov.tipo || 'Movimentação'}
                description={mov.descricao}
                isLast={idx === movimentacoes.length - 1}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
