import { Search, Users } from 'lucide-react';
import { useState } from 'react';

export default function ClientesList() {
  const [search, setSearch] = useState('');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Clientes</h1>
        <p className="text-muted-foreground text-sm mt-1">Gerencie seus clientes</p>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          type="text"
          placeholder="Buscar por nome ou CPF..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input-field w-full pl-10"
        />
      </div>

      <div className="card-elevated flex flex-col items-center justify-center p-16 text-center">
        <Users className="h-12 w-12 text-muted-foreground/30 mb-4" />
        <h3 className="text-lg font-semibold text-muted-foreground">Nenhum cliente cadastrado</h3>
        <p className="text-sm text-muted-foreground/70 mt-1 max-w-sm">
          Seus clientes aparecerão aqui quando forem vinculados a processos.
        </p>
      </div>
    </div>
  );
}
