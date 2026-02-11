import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Filter, FileText, Plus, RefreshCw, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import StatusBadge from '@/components/StatusBadge';
import { useProcessos, syncProcessMovements } from '@/hooks/useProcessos';
import ImportarProcessos from '@/components/ImportarProcessos';
import { toast } from 'sonner';

export default function ProcessosList() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const { processos, loading, refetch } = useProcessos();

  const filtered = processos.filter(p => {
    const matchSearch = !search ||
      p.numero_cnj.toLowerCase().includes(search.toLowerCase()) ||
      (p.classe || '').toLowerCase().includes(search.toLowerCase()) ||
      (p.tribunal || '').toLowerCase().includes(search.toLowerCase());
    const matchStatus = !statusFilter || p.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const handleSyncAll = async () => {
    setSyncing(true);
    try {
      const result = await syncProcessMovements();
      const total = result?.results?.reduce((acc: number, r: any) => acc + (r.newMovements || 0), 0) || 0;
      toast.success(`Sincronização concluída. ${total} nova(s) movimentação(ões).`);
      refetch();
    } catch (err: any) {
      toast.error(err.message || 'Erro ao sincronizar');
    }
    setSyncing(false);
  };

  if (showImport) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Importar Processos</h1>
            <p className="text-muted-foreground text-sm mt-1">Busque e importe processos da API Judit</p>
          </div>
          <Button variant="outline" onClick={() => setShowImport(false)}>Voltar à lista</Button>
        </div>
        <ImportarProcessos onImported={() => { setShowImport(false); refetch(); }} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Processos</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {processos.length} processo(s) cadastrado(s)
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleSyncAll} disabled={syncing || processos.length === 0}>
            <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? 'animate-spin' : ''}`} />
            Atualizar Movimentações
          </Button>
          <Button size="sm" onClick={() => setShowImport(true)}>
            <Download className="h-4 w-4 mr-2" />
            Importar Processos
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Buscar por número, classe ou tribunal..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input-field w-full pl-10"
          />
        </div>
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="input-field pl-10 pr-8 appearance-none cursor-pointer min-w-[180px]"
          >
            <option value="">Todos os status</option>
            <option value="ativo">Ativo</option>
            <option value="arquivado">Arquivado</option>
          </select>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="card-elevated flex items-center justify-center p-12">
          <div className="h-6 w-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      )}

      {/* List */}
      {!loading && filtered.length > 0 && (
        <div className="space-y-2">
          {filtered.map(proc => (
            <Link key={proc.id} to={`/processos/${proc.id}`} className="block">
              <div className="card-elevated p-4 hover:bg-accent/5 transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-sm font-semibold">{proc.numero_cnj}</p>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {proc.classe}{proc.tribunal ? ` • ${proc.tribunal}` : ''}
                    </p>
                    {proc.assunto && (
                      <p className="text-xs text-muted-foreground/70 mt-0.5 truncate">{proc.assunto}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusBadge variant={proc.status === 'ativo' ? 'success' : 'neutral'}>
                      {proc.status || 'ativo'}
                    </StatusBadge>
                    <span className="text-xs text-muted-foreground">
                      {proc.fonte === 'judit' ? 'Judit' : 'Manual'}
                    </span>
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && filtered.length === 0 && (
        <div className="card-elevated flex flex-col items-center justify-center p-16 text-center">
          <FileText className="h-12 w-12 text-muted-foreground/30 mb-4" />
          <h3 className="text-lg font-semibold text-muted-foreground">
            {processos.length === 0 ? 'Nenhum processo cadastrado' : 'Nenhum resultado encontrado'}
          </h3>
          <p className="text-sm text-muted-foreground/70 mt-1 max-w-sm">
            {processos.length === 0
              ? 'Importe processos da API Judit ou adicione manualmente.'
              : 'Tente ajustar os filtros de busca.'}
          </p>
          {processos.length === 0 && (
            <Button className="mt-4" onClick={() => setShowImport(true)}>
              <Download className="h-4 w-4 mr-2" />
              Importar Processos
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
