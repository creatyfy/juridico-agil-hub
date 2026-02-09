import { Search, FileText } from 'lucide-react';
import { useState } from 'react';
import StatusBadge from '@/components/StatusBadge';

const clientes = [
  { id: '1', nome: 'Maria Silva', cpf: '123.456.789-00', processos: 2, email: 'maria@email.com' },
  { id: '2', nome: 'João Santos', cpf: '987.654.321-00', processos: 1, email: 'joao@email.com' },
  { id: '3', nome: 'Ana Oliveira', cpf: '456.789.123-00', processos: 3, email: 'ana@email.com' },
  { id: '4', nome: 'Pedro Costa', cpf: '321.654.987-00', processos: 1, email: 'pedro@email.com' },
  { id: '5', nome: 'Lucia Fernandes', cpf: '654.321.987-00', processos: 2, email: 'lucia@email.com' },
];

export default function ClientesList() {
  const [search, setSearch] = useState('');

  const filtered = clientes.filter(
    (c) => !search || c.nome.toLowerCase().includes(search.toLowerCase()) || c.cpf.includes(search)
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Clientes</h1>
        <p className="text-muted-foreground text-sm mt-1">{clientes.length} clientes vinculados</p>
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

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((c) => (
          <div key={c.id} className="card-elevated p-5 hover:shadow-md transition-shadow cursor-pointer">
            <div className="flex items-start justify-between mb-3">
              <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center">
                <span className="text-sm font-semibold text-primary-foreground">{c.nome.charAt(0)}</span>
              </div>
              <StatusBadge variant="info">{c.processos} processos</StatusBadge>
            </div>
            <h3 className="font-semibold text-sm">{c.nome}</h3>
            <p className="text-xs text-muted-foreground font-mono mt-1">{c.cpf}</p>
            <p className="text-xs text-muted-foreground mt-1">{c.email}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
