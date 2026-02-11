import { useState } from 'react';
import { Search, Filter, FileText } from 'lucide-react';

export default function ProcessosList() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Processos</h1>
          <p className="text-muted-foreground text-sm mt-1">Gerencie seus processos judiciais</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Buscar por número ou cliente..."
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
            <option value="Em andamento">Em andamento</option>
            <option value="Aguardando">Aguardando</option>
            <option value="Sentenciado">Sentenciado</option>
            <option value="Arquivado">Arquivado</option>
          </select>
        </div>
      </div>

      {/* Empty state */}
      <div className="card-elevated flex flex-col items-center justify-center p-16 text-center">
        <FileText className="h-12 w-12 text-muted-foreground/30 mb-4" />
        <h3 className="text-lg font-semibold text-muted-foreground">Nenhum processo cadastrado</h3>
        <p className="text-sm text-muted-foreground/70 mt-1 max-w-sm">
          Seus processos aparecerão aqui quando forem cadastrados no sistema.
        </p>
      </div>
    </div>
  );
}
