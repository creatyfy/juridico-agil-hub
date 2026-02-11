import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useClientes } from '@/hooks/useClientes';
import { Search, Filter, FileText, Plus, RefreshCw, Download, Scale, MapPin, Users, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import StatusBadge from '@/components/StatusBadge';
import { useProcessos, syncProcessMovements } from '@/hooks/useProcessos';
import ImportarProcessos from '@/components/ImportarProcessos';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export default function ProcessosList() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const { processos, loading, refetch } = useProcessos();
  const { clientes } = useClientes();

  const filtered = processos.filter(p => {
    const partes = Array.isArray(p.partes) ? p.partes : [];
    const partesNames = partes.map((pt: any) => (pt.name || '').toLowerCase()).join(' ');
    const matchSearch = !search ||
      p.numero_cnj.toLowerCase().includes(search.toLowerCase()) ||
      (p.classe || '').toLowerCase().includes(search.toLowerCase()) ||
      (p.tribunal || '').toLowerCase().includes(search.toLowerCase()) ||
      partesNames.includes(search.toLowerCase());
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
      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Buscar por número, classe, tribunal ou nome da parte..."
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
      </div>

      {/* Loading */}
      {loading && (
        <div className="card-elevated flex items-center justify-center p-12">
          <div className="h-6 w-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        </div>
      )}

      {/* List */}
      {!loading && filtered.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map(proc => {
            const partes = Array.isArray(proc.partes) ? proc.partes : [];
            const autor = partes.find((p: any) => p.side === 'Active' && p.person_type !== 'Advogado');
            const reu = partes.find((p: any) => p.side === 'Passive' && p.person_type !== 'Advogado');
            // The lawyer's client is the Active-side party (autor)
            const cliente = autor;
            const dataFormatada = proc.data_distribuicao
              ? format(new Date(proc.data_distribuicao), "dd/MM/yyyy", { locale: ptBR })
              : null;

            return (
              <Link key={proc.id} to={`/processos/${proc.id}`} className="block group">
                <div className="bg-card rounded-xl border p-5 h-full transition-all duration-200 hover:shadow-[0_8px_30px_-4px_hsl(212_88%_50%/0.18)] hover:border-accent/40">
                  <div className="flex flex-col gap-3 h-full">
                    {/* Top row: status + fonte */}
                    <div className="flex items-center justify-between">
                      <StatusBadge variant={proc.status === 'ativo' ? 'success' : 'neutral'}>
                        {proc.status || 'ativo'}
                      </StatusBadge>
                      <span className="text-[11px] text-muted-foreground/60 font-medium uppercase tracking-wider">
                        {proc.fonte === 'judit' ? 'Judit' : 'Manual'}
                      </span>
                    </div>

                    {/* Número CNJ */}
                    <div className="flex items-center gap-2">
                      <Scale className="h-4 w-4 text-accent shrink-0" />
                      <p className="font-mono text-sm font-bold text-foreground tracking-wide">{proc.numero_cnj}</p>
                    </div>

                    {/* Classe e Tribunal */}
                    <p className="text-sm font-medium text-muted-foreground">
                      {proc.classe}{proc.tribunal ? ` • ${proc.tribunal}` : ''}
                    </p>

                    {/* Partes */}
                    {(autor || reu) && (
                      <div className="flex items-start gap-2 text-xs text-muted-foreground/80">
                        <Users className="h-3.5 w-3.5 mt-0.5 shrink-0 text-accent/60" />
                        <div className="space-y-0.5">
                          {autor && <p><span className="font-medium text-foreground/70">Autor:</span> {autor.name}</p>}
                          {reu && <p><span className="font-medium text-foreground/70">Réu:</span> {reu.name}</p>}
                        </div>
                      </div>
                    )}

                    {/* Info extra row */}
                    <div className="flex flex-wrap items-center gap-2 mt-auto pt-2">
                      {proc.assunto && (
                        <span className="inline-flex items-center gap-1 text-xs bg-accent/8 text-accent px-2 py-0.5 rounded-md font-medium">
                          {proc.assunto}
                        </span>
                      )}
                      {proc.vara && (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground/70">
                          <MapPin className="h-3 w-3" />
                          {proc.vara}
                        </span>
                      )}
                      {dataFormatada && (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground/70">
                          <Calendar className="h-3 w-3" />
                          {dataFormatada}
                        </span>
                      )}
                    </div>

                    {/* Client badge */}
                    {cliente && (() => {
                      const clienteDb = clientes.find(c => c.documento && cliente.main_document && c.documento === cliente.main_document);
                      return clienteDb ? (
                        <div>
                          <Link
                            to={`/clientes/${clienteDb.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full border cursor-pointer transition-all duration-150 bg-accent/5 text-accent border-accent/20 hover:bg-accent/10 hover:border-accent/40"
                          >
                            <Users className="h-3 w-3" />
                            {cliente.name}
                          </Link>
                        </div>
                      ) : (
                        <div>
                          <span className="inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full border bg-accent/5 text-accent border-accent/20">
                            <Users className="h-3 w-3" />
                            {cliente.name}
                          </span>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </Link>
            );
          })}
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
