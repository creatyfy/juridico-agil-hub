import { useParams, Link } from 'react-router-dom';
import { useState } from 'react';
import { ArrowLeft, User, FileText, Phone, Mail, MapPin, Save, Scale, Send, Copy, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useCliente, updateCliente } from '@/hooks/useClientes';
import { useProcessos } from '@/hooks/useProcessos';
import { useClienteProcessos, convidarProcesso } from '@/hooks/useClienteProcessos';
import StatusBadge from '@/components/StatusBadge';
import { toast } from 'sonner';

export default function ClienteDetail() {
  const { id } = useParams<{ id: string }>();
  const { cliente, loading, refetch } = useCliente(id);
  const { processos } = useProcessos();
  const { vinculos, refetch: refetchVinculos } = useClienteProcessos(id);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ telefone: '', email: '', endereco: '', observacoes: '' });

  // Invite dialog state
  const [inviteOpen, setInviteOpen] = useState(false);
  const [selectedProcesso, setSelectedProcesso] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const processosVinculados = processos.filter(p => {
    const partes = Array.isArray(p.partes) ? p.partes : [];
    return partes.some((pt: any) =>
      pt.main_document && cliente?.documento && pt.main_document === cliente.documento
    );
  });

  const getInviteStatus = (processoId: string) => {
    const vinculo = vinculos.find(v => v.processo_id === processoId);
    return vinculo?.status || null;
  };

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

  const handleInvite = async () => {
    if (!id || !selectedProcesso) return;
    setInviting(true);
    try {
      const result = await convidarProcesso(id, selectedProcesso);
      if (result.token) {
        const publishedUrl = import.meta.env.VITE_SITE_URL || 'https://juridico-agil-hub.lovable.app';
        const link = `${publishedUrl}/convite/${result.token}`;
        setInviteLink(link);
        toast.success(result.emailSent ? 'Convite enviado por e-mail!' : 'Convite criado com sucesso!');
        refetchVinculos();
      }
    } catch (e: any) {
      const msg = e.message || 'Erro ao enviar convite';
      toast.error(msg.includes('409') || msg.includes('já existe') ? 'Convite já existe para este processo' : msg);
    }
    setInviting(false);
  };

  const copyLink = () => {
    if (inviteLink) {
      navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      toast.success('Link copiado!');
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const closeInviteDialog = () => {
    setInviteOpen(false);
    setSelectedProcesso(null);
    setInviteLink(null);
    setCopied(false);
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
          <div className="flex items-center gap-2">
            {!editing && (
              <Button variant="outline" size="sm" onClick={startEditing}>Editar contato</Button>
            )}
          </div>
        </div>
      </div>

      {/* Invite button - always visible */}
      <Button onClick={() => setInviteOpen(true)} className="w-full sm:w-auto">
        <Send className="h-4 w-4 mr-2" />
        Convidar para acompanhar processo
      </Button>

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
              {processosVinculados.map(proc => {
                const inviteStatus = getInviteStatus(proc.id);
                return (
                  <Link key={proc.id} to={`/processos/${proc.id}`} className="block group">
                    <div className="flex items-center justify-between p-3 rounded-lg border hover:border-accent/40 hover:bg-accent/5 transition-all">
                      <div className="flex items-center gap-3">
                        <Scale className="h-4 w-4 text-accent shrink-0" />
                        <div>
                          <p className="font-mono text-sm font-semibold text-foreground">{proc.numero_cnj}</p>
                          <p className="text-xs text-muted-foreground">{proc.classe}{proc.tribunal ? ` • ${proc.tribunal}` : ''}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {inviteStatus && (
                          <StatusBadge variant={inviteStatus === 'ativo' ? 'success' : inviteStatus === 'aceito' ? 'info' : 'warning'}>
                            {inviteStatus === 'ativo' ? 'Convite ativo' : inviteStatus === 'aceito' ? 'Aceito' : 'Convite pendente'}
                          </StatusBadge>
                        )}
                        <StatusBadge variant={proc.status === 'ativo' ? 'success' : 'neutral'}>
                          {proc.status || 'ativo'}
                        </StatusBadge>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Invite Dialog */}
      <Dialog open={inviteOpen} onOpenChange={closeInviteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Convidar para acompanhar processo</DialogTitle>
            <DialogDescription>
              Selecione o processo que deseja compartilhar com {cliente.nome}.
            </DialogDescription>
          </DialogHeader>

          {inviteLink ? (
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-4 text-center space-y-3">
                <Check className="h-8 w-8 text-accent mx-auto" />
                <p className="text-sm font-medium">Convite criado com sucesso!</p>
                <p className="text-xs text-muted-foreground">Compartilhe o link abaixo com o cliente:</p>
              </div>
              <div className="flex gap-2">
                <Input value={inviteLink} readOnly className="text-xs font-mono" />
                <Button size="icon" variant="outline" onClick={copyLink}>
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={closeInviteDialog}>Fechar</Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              {processosVinculados.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">Nenhum processo vinculado a este cliente.</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {processosVinculados.map(proc => {
                    const inviteStatus = getInviteStatus(proc.id);
                    const disabled = !!inviteStatus;
                    return (
                      <button
                        key={proc.id}
                        onClick={() => !disabled && setSelectedProcesso(proc.id)}
                        disabled={disabled}
                        className={`w-full text-left p-3 rounded-lg border transition-all ${
                          selectedProcesso === proc.id
                            ? 'border-accent bg-accent/10'
                            : disabled
                              ? 'opacity-50 cursor-not-allowed'
                              : 'hover:border-accent/40 hover:bg-accent/5 cursor-pointer'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-mono text-sm font-semibold">{proc.numero_cnj}</p>
                            <p className="text-xs text-muted-foreground">{proc.classe}</p>
                          </div>
                          {disabled && (
                            <StatusBadge variant="warning">Já convidado</StatusBadge>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={closeInviteDialog}>Cancelar</Button>
                <Button onClick={handleInvite} disabled={!selectedProcesso || inviting}>
                  {inviting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                  Enviar Convite
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
