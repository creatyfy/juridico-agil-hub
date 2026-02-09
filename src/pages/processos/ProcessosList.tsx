import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, Filter, Eye } from 'lucide-react';
import StatusBadge from '@/components/StatusBadge';
import { Button } from '@/components/ui/button';

const processosList = [
  { id: '1', numero: '0001234-56.2025.8.26.0100', cliente: 'Maria Silva', vara: '1ª Vara Cível', status: 'Em andamento', ultimaMov: '09/02/2026' },
  { id: '2', numero: '0007890-12.2024.8.26.0100', cliente: 'João Santos', vara: '3ª Vara Trabalhista', status: 'Aguardando', ultimaMov: '08/02/2026' },
  { id: '3', numero: '0004567-89.2025.8.26.0100', cliente: 'Ana Oliveira', vara: '2ª Vara de Família', status: 'Sentenciado', ultimaMov: '07/02/2026' },
  { id: '4', numero: '0003456-78.2025.8.26.0100', cliente: 'Pedro Costa', vara: '5ª Vara Criminal', status: 'Em andamento', ultimaMov: '06/02/2026' },
  { id: '5', numero: '0009876-54.2024.8.26.0100', cliente: 'Lucia Fernandes', vara: '2ª Vara Cível', status: 'Arquivado', ultimaMov: '05/02/2026' },
  { id: '6', numero: '0005432-10.2025.8.26.0100', cliente: 'Roberto Lima', vara: '1ª Vara Trabalhista', status: 'Em andamento', ultimaMov: '04/02/2026' },
];

const statusVariant = (s: string) => {
  if (s === 'Em andamento') return 'info';
  if (s === 'Sentenciado') return 'success';
  if (s === 'Arquivado') return 'neutral';
  return 'warning';
};

export default function ProcessosList() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const filtered = processosList.filter((p) => {
    const matchSearch = !search || p.numero.includes(search) || p.cliente.toLowerCase().includes(search.toLowerCase());
    const matchStatus = !statusFilter || p.status === statusFilter;
    return matchSearch && matchStatus;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Processos</h1>
          <p className="text-muted-foreground text-sm mt-1">{processosList.length} processos cadastrados</p>
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

      {/* Table */}
      <div className="card-elevated overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b bg-secondary/50">
                <th className="text-left p-4 text-sm font-medium text-muted-foreground">Número</th>
                <th className="text-left p-4 text-sm font-medium text-muted-foreground">Cliente</th>
                <th className="text-left p-4 text-sm font-medium text-muted-foreground hidden md:table-cell">Vara</th>
                <th className="text-left p-4 text-sm font-medium text-muted-foreground">Status</th>
                <th className="text-left p-4 text-sm font-medium text-muted-foreground hidden sm:table-cell">Última Mov.</th>
                <th className="text-right p-4 text-sm font-medium text-muted-foreground">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} className="border-b last:border-0 hover:bg-secondary/30 transition-colors">
                  <td className="p-4 text-sm font-mono">{p.numero}</td>
                  <td className="p-4 text-sm font-medium">{p.cliente}</td>
                  <td className="p-4 text-sm text-muted-foreground hidden md:table-cell">{p.vara}</td>
                  <td className="p-4"><StatusBadge variant={statusVariant(p.status) as any}>{p.status}</StatusBadge></td>
                  <td className="p-4 text-sm text-muted-foreground hidden sm:table-cell">{p.ultimaMov}</td>
                  <td className="p-4 text-right">
                    <Link to={`/processos/${p.id}`}>
                      <Button variant="ghost" size="sm" className="text-accent hover:text-accent/80">
                        <Eye className="h-4 w-4 mr-1" /> Ver
                      </Button>
                    </Link>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-muted-foreground">
                    Nenhum processo encontrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
