import { Search, Users, User, FileText, AlertTriangle, MessageCircle } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useClientes } from '@/hooks/useClientes';
import { useProcessos } from '@/hooks/useProcessos';

export default function ClientesList() {
  const [search, setSearch] = useState('');
  const { clientes, loading } = useClientes();
  const { processos } = useProcessos();

  const filtered = clientes.filter(c => {
    if (!search) return true;
    const q = search.toLowerCase();
    return c.nome.toLowerCase().includes(q) || (c.documento || '').includes(q);
  });

  const countProcessos = (documento: string | null) => {
    if (!documento) return 0;
    return processos.filter(p => {
      const partes = Array.isArray(p.partes) ? p.partes : [];
      return partes.some((pt: any) => pt.main_document === documento);
    }).length;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Clientes</h1>
        <p className="text-muted-foreground text-sm mt-1">{clientes.length} cliente(s) cadastrado(s)</p>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Buscar por nome ou documento..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input-field w-full pl-10"
        />
      </div>

      {loading && (
        <div className="card-elevated flex items-center justify-center p-12">
          <div className="h-6 w-6 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(cliente => {
            const numProc = countProcessos(cliente.documento);
            return (
              <Link key={cliente.id} to={`/clientes/${cliente.id}`} className="block group">
                <div className="bg-card rounded-xl border p-5 h-full transition-all duration-200 hover:shadow-[0_8px_30px_-4px_hsl(212_88%_50%/0.18)] hover:border-accent/40">
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 rounded-full bg-accent/10 flex items-center justify-center shrink-0">
                      <User className="h-5 w-5 text-accent" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-foreground truncate">{cliente.nome}</p>
                      {cliente.documento && (
                        <p className="text-xs text-muted-foreground font-mono mt-0.5">
                          {cliente.tipo_documento}: {cliente.documento}
                        </p>
                      )}
                      <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground/70">
                        <FileText className="h-3 w-3" />
                        <span>{numProc} processo(s)</span>
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="card-elevated flex flex-col items-center justify-center p-16 text-center">
          <Users className="h-12 w-12 text-muted-foreground/30 mb-4" />
          <h3 className="text-lg font-semibold text-muted-foreground">
            {clientes.length === 0 ? 'Nenhum cliente cadastrado' : 'Nenhum resultado encontrado'}
          </h3>
          <p className="text-sm text-muted-foreground/70 mt-1 max-w-sm">
            {clientes.length === 0
              ? 'Seus clientes aparecerão aqui quando forem vinculados a processos importados.'
              : 'Tente ajustar os filtros de busca.'}
          </p>
        </div>
      )}
    </div>
  );
}
