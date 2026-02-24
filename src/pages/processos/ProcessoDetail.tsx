import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, FileText, RefreshCw, Loader2, AlertTriangle, UserRound, Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  useMovimentacoes,
  syncProcessMovements,
  getProcessSyncHistory,
  linkProcessClient,
  type Processo,
  type ProcessoClientLink,
  type ProcessoSyncHistoryItem,
} from '@/hooks/useProcessos';
import { useClientes } from '@/hooks/useClientes';
import StatusBadge from '@/components/StatusBadge';
import TimelineEvent from '@/components/TimelineEvent';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

export default function ProcessoDetail() {
  const { id } = useParams();
  const [processo, setProcesso] = useState<Processo | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncHistory, setSyncHistory] = useState<ProcessoSyncHistoryItem[]>([]);
  const [linkedClient, setLinkedClient] = useState<ProcessoClientLink | null>(null);
  const [selectedClient, setSelectedClient] = useState('');
  const [savingClient, setSavingClient] = useState(false);
  const { movimentacoes, loading: movsLoading, refetch: refetchMovs } = useMovimentacoes(id);
  const { clientes } = useClientes();

  const fetchLinkedClient = useCallback(async () => {
    if (!id) return;
    const { data } = await supabase
      .from('cliente_processos')
      .select('status, clientes(id, nome, email)')
      .eq('processo_id', id)
      .in('status', ['pendente', 'ativo'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const client = (data as any)?.clientes;
    if (client) {
      setLinkedClient({
        id: client.id,
        nome: client.nome,
        email: client.email,
        status: (data as any).status,
      });
    } else {
      setLinkedClient(null);
    }
  }, [id]);

  const fetchSyncHistory = useCallback(async () => {
    if (!id) return;
    try {
      const history = await getProcessSyncHistory(id);
      setSyncHistory(history);
    } catch {
      setSyncHistory([]);
    }
  }, [id]);

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
  useEffect(() => { fetchLinkedClient(); }, [fetchLinkedClient]);
  useEffect(() => { fetchSyncHistory(); }, [fetchSyncHistory]);

  const handleSync = async () => {
    if (!id) return;
    setSyncing(true);
    try {
      const result = await syncProcessMovements(id);
      const newCount = result?.results?.[0]?.newMovements || 0;
      toast.success(`${newCount} nova(s) movimentação(ões)`);
      await refetchMovs();
      await fetchSyncHistory();
    } catch (err: any) {
      toast.error(err.message || 'Erro ao sincronizar');
    }
    setSyncing(false);
  };

  const handleLinkClient = async () => {
    if (!id || !selectedClient) return;
    setSavingClient(true);
    try {
      await linkProcessClient(id, selectedClient);
      toast.success('Cliente vinculado ao processo');
      setSelectedClient('');
      await fetchLinkedClient();
    } catch (err: any) {
      toast.error(err.message || 'Erro ao vincular cliente');
    }
    setSavingClient(false);
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
  const ultimaMovimentacao = movimentacoes[0];

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

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="card-elevated p-4">
          <p className="text-xs text-muted-foreground mb-1">Status</p>
          <StatusBadge variant={processo.status === 'ativo' ? 'success' : 'neutral'}>
            {processo.status || 'ativo'}
          </StatusBadge>
        </div>
        <div className="card-elevated p-4">
          <p className="text-xs text-muted-foreground mb-1">Cliente vinculado</p>
          {linkedClient ? (
            <p className="text-sm font-medium">{linkedClient.nome}</p>
          ) : (
            <div className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded border border-yellow-400/40 bg-yellow-500/10 text-yellow-700">
              <AlertTriangle className="h-3 w-3" /> Sem cliente vinculado
            </div>
          )}
        </div>
        <div className="card-elevated p-4 flex items-end justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Gestão do cliente</p>
            <p className="text-sm text-muted-foreground">Convide ou altere o cliente deste processo</p>
          </div>
          <Dialog>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline"><Pencil className="h-4 w-4 mr-2" /> Editar cliente</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Vincular cliente ao processo</DialogTitle>
                <DialogDescription>
                  Selecione um cliente cadastrado para enviar o vínculo deste processo.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <select
                  value={selectedClient}
                  onChange={(e) => setSelectedClient(e.target.value)}
                  className="input-field w-full"
                >
                  <option value="">Selecione um cliente</option>
                  {clientes.map((cliente) => (
                    <option key={cliente.id} value={cliente.id}>{cliente.nome}</option>
                  ))}
                </select>
                <Button onClick={handleLinkClient} disabled={!selectedClient || savingClient} className="w-full">
                  <UserRound className="h-4 w-4 mr-2" />
                  {savingClient ? 'Salvando...' : 'Vincular cliente'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
        {processo.vara && (
          <div className="card-elevated p-4">
            <p className="text-xs text-muted-foreground mb-1">Vara</p>
            <p className="text-sm font-medium">{processo.vara}</p>
          </div>
        )}
        <div className="card-elevated p-4">
          <p className="text-xs text-muted-foreground mb-1">Fonte</p>
          <p className="text-sm font-medium capitalize">{processo.fonte || 'judit'}</p>
        </div>
      </div>

      {ultimaMovimentacao && (
        <div className="card-elevated p-5 border-primary/30 bg-primary/5">
          <p className="text-xs text-primary font-semibold uppercase tracking-wide mb-1">Última movimentação</p>
          <p className="font-medium">{ultimaMovimentacao.descricao}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {ultimaMovimentacao.data_movimentacao ? new Date(ultimaMovimentacao.data_movimentacao).toLocaleString('pt-BR') : 'Sem data'}
          </p>
        </div>
      )}

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

      <div className="card-elevated p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Timeline de movimentações ({movimentacoes.length})</h3>
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
                type={idx === 0 ? 'important' : 'default'}
                isLast={idx === movimentacoes.length - 1}
              />
            ))}
          </div>
        )}
      </div>

      <div className="card-elevated p-6">
        <h3 className="text-lg font-semibold mb-4">Histórico de sincronizações</h3>
        {syncHistory.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum histórico registrado até o momento.</p>
        ) : (
          <div className="space-y-2">
            {syncHistory.map((item) => (
              <div key={item.id} className="rounded-md border p-3">
                <p className="text-sm font-medium">{item.action}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(item.created_at).toLocaleString('pt-BR')}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
