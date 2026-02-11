import { useParams, Link } from 'react-router-dom';
import { useState } from 'react';
import { ArrowLeft, User, FileText, Phone, Mail, MapPin, Save, Scale } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useCliente, updateCliente } from '@/hooks/useClientes';
import { useProcessos } from '@/hooks/useProcessos';
import StatusBadge from '@/components/StatusBadge';
import { toast } from 'sonner';

export default function ClienteDetail() {
  const { id } = useParams<{ id: string }>();
  const { cliente, loading, refetch } = useCliente(id);
  const { processos } = useProcessos();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ telefone: '', email: '', endereco: '', observacoes: '' });

  const processosVinculados = processos.filter(p => {
    const partes = Array.isArray(p.partes) ? p.partes : [];
    return partes.some((pt: any) =>
      pt.main_document && cliente?.documento && pt.main_document === cliente.documento
    );
  });

  const startEditing = () => {
    setForm({
      telefone: cliente?.telefone || '',
      email: cliente?.email || '',
      endereco: cliente?.endereco || '',
      observacoes: cliente?.observacoes || '',
    });
    setEditing(true);
  };

  const handleSave = async () => {
    if (!id) return;
    setSaving(true);
    try {
      await updateCliente(id, form);
      toast.success('Dados atualizados com sucesso');
      setEditing(false);
      refetch();
    } catch {
      toast.error('Erro ao salvar');
    }
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="h-6 w-6 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
      </div>
    );
  }

  if (!cliente) {
    return (
      <div className="space-y-4">
        <Link to="/clientes" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Voltar
        </Link>
        <p className="text-muted-foreground">Cliente não encontrado.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link to="/clientes" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-4 w-4" /> Voltar aos clientes
      </Link>

      {/* Header */}
      <div className="bg-card rounded-xl border p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-full bg-accent/10 flex items-center justify-center">
              <User className="h-7 w-7 text-accent" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">{cliente.nome}</h1>
              <div className="flex items-center gap-3 mt-1">
                {cliente.documento && (
                  <span className="text-sm text-muted-foreground font-mono">
                    {cliente.tipo_documento}: {cliente.documento}
                  </span>
                )}
                <StatusBadge variant={cliente.tipo_pessoa === 'juridica' ? 'info' : 'neutral'}>
                  {cliente.tipo_pessoa === 'juridica' ? 'Pessoa Jurídica' : 'Pessoa Física'}
                </StatusBadge>
              </div>
            </div>
          </div>
          {!editing && (
            <Button variant="outline" size="sm" onClick={startEditing}>Editar contato</Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Contact info */}
        <div className="bg-card rounded-xl border p-6 space-y-4">
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">Contato</h2>
          {editing ? (
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Telefone</label>
                <Input value={form.telefone} onChange={e => setForm(f => ({ ...f, telefone: e.target.value }))} placeholder="(00) 00000-0000" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">E-mail</label>
                <Input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="email@exemplo.com" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Endereço</label>
                <Input value={form.endereco} onChange={e => setForm(f => ({ ...f, endereco: e.target.value }))} placeholder="Rua, número, cidade" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Observações</label>
                <Textarea value={form.observacoes} onChange={e => setForm(f => ({ ...f, observacoes: e.target.value }))} placeholder="Notas sobre o cliente..." rows={3} />
              </div>
              <div className="flex gap-2 pt-2">
                <Button size="sm" onClick={handleSave} disabled={saving}>
                  <Save className="h-4 w-4 mr-1" /> Salvar
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancelar</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Phone className="h-4 w-4 shrink-0" />
                <span>{cliente.telefone || 'Não informado'}</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Mail className="h-4 w-4 shrink-0" />
                <span>{cliente.email || 'Não informado'}</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <MapPin className="h-4 w-4 shrink-0" />
                <span>{cliente.endereco || 'Não informado'}</span>
              </div>
              {cliente.observacoes && (
                <div className="pt-2 border-t">
                  <p className="text-xs text-muted-foreground/70 mb-1">Observações</p>
                  <p className="text-muted-foreground">{cliente.observacoes}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Linked processes */}
        <div className="lg:col-span-2 bg-card rounded-xl border p-6 space-y-4">
          <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">
            Processos vinculados ({processosVinculados.length})
          </h2>
          {processosVinculados.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum processo vinculado encontrado.</p>
          ) : (
            <div className="space-y-2">
              {processosVinculados.map(proc => (
                <Link key={proc.id} to={`/processos/${proc.id}`} className="block group">
                  <div className="flex items-center justify-between p-3 rounded-lg border hover:border-accent/40 hover:bg-accent/5 transition-all">
                    <div className="flex items-center gap-3">
                      <Scale className="h-4 w-4 text-accent shrink-0" />
                      <div>
                        <p className="font-mono text-sm font-semibold text-foreground">{proc.numero_cnj}</p>
                        <p className="text-xs text-muted-foreground">{proc.classe}{proc.tribunal ? ` • ${proc.tribunal}` : ''}</p>
                      </div>
                    </div>
                    <StatusBadge variant={proc.status === 'ativo' ? 'success' : 'neutral'}>
                      {proc.status || 'ativo'}
                    </StatusBadge>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
