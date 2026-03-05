import { useEffect, useState } from 'react';
import { Plus, X, Loader2, Send, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface CampaignJob {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'paused' | 'cancelled' | 'completed';
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  total: number;
  sent: number;
  failed: number;
}

interface Cliente {
  id: string;
  nome: string;
  numero_whatsapp: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Aguardando',
  running: 'Enviando',
  paused: 'Pausado',
  cancelled: 'Cancelado',
  completed: 'Concluído',
};

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending: 'secondary',
  running: 'default',
  paused: 'outline',
  cancelled: 'destructive',
  completed: 'secondary',
};

export default function CampanhasList() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [campaigns, setCampaigns] = useState<CampaignJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [selectedClientes, setSelectedClientes] = useState<string[]>([]);
  const [messageText, setMessageText] = useState('');
  const [campaignName, setCampaignName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const loadCampaigns = async () => {
    if (!user) return;
    const { data } = await (supabase as any)
      .from('campaign_jobs')
      .select(`
        id, name, status, created_at, started_at, completed_at, cancelled_at,
        campaign_recipients(id, status)
      `)
      .eq('tenant_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);

    const mapped = (data ?? []).map((job: any) => {
      const recipients: any[] = job.campaign_recipients ?? [];
      return {
        id: job.id,
        name: job.name,
        status: job.status,
        created_at: job.created_at,
        started_at: job.started_at,
        completed_at: job.completed_at,
        cancelled_at: job.cancelled_at,
        total: recipients.length,
        sent: recipients.filter((r) => r.status === 'sent').length,
        failed: recipients.filter((r) => r.status === 'failed').length,
      };
    });
    setCampaigns(mapped);
    setLoading(false);
  };

  const loadClientes = async () => {
    if (!user) return;
    const { data } = await supabase
      .from('clientes')
      .select('id, nome, numero_whatsapp')
      .eq('user_id', user.id)
      .not('numero_whatsapp', 'is', null)
      .order('nome');
    setClientes(data ?? []);
  };

  useEffect(() => {
    loadCampaigns();
  }, [user]);

  const handleOpenDialog = async () => {
    await loadClientes();
    setDialogOpen(true);
  };

  const toggleCliente = (id: string) => {
    setSelectedClientes((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  };

  const handleCreate = async () => {
    if (!user) return;
    if (!messageText.trim()) {
      toast({ title: 'Mensagem obrigatória', variant: 'destructive' });
      return;
    }
    if (selectedClientes.length === 0) {
      toast({ title: 'Selecione ao menos um destinatário', variant: 'destructive' });
      return;
    }

    setSubmitting(true);

    // Busca instância conectada
    const { data: instance } = await supabase
      .from('whatsapp_instancias')
      .select('id, instance_name')
      .eq('user_id', user.id)
      .eq('status', 'connected')
      .limit(1)
      .maybeSingle();

    if (!instance) {
      toast({ title: 'WhatsApp não conectado', description: 'Conecte seu WhatsApp antes de criar uma campanha.', variant: 'destructive' });
      setSubmitting(false);
      return;
    }

    // Cria o job
    const name = campaignName.trim() || `Campanha ${new Date().toLocaleDateString('pt-BR')}`;
    const { data: job, error: jobError } = await (supabase as any)
      .from('campaign_jobs')
      .insert({
        tenant_id: user.id,
        instance_id: instance.id,
        name,
        status: 'pending',
        payload_template: { messageText: messageText.trim(), instanceName: instance.instance_name },
      })
      .select('id')
      .single();

    if (jobError || !job) {
      toast({ title: 'Erro ao criar campanha', description: jobError?.message, variant: 'destructive' });
      setSubmitting(false);
      return;
    }

    // Busca dados completos dos clientes selecionados
    const { data: clientesData } = await supabase
      .from('clientes')
      .select('id, nome, numero_whatsapp')
      .in('id', selectedClientes);

    const recipients = (clientesData ?? []).map((c: any) => {
      const phone = String(c.numero_whatsapp).startsWith('55') ? c.numero_whatsapp : `55${c.numero_whatsapp}`;
      return {
        campaign_job_id: job.id,
        tenant_id: user.id,
        destination: phone,
        reference: `${job.id}:${c.id}`,
        status: 'queued',
        payload: {
          messageText: messageText.trim(),
          instanceName: instance.instance_name,
          clienteNome: c.nome,
        },
      };
    });

    const { error: recipientsError } = await (supabase as any).from('campaign_recipients').insert(recipients);

    if (recipientsError) {
      toast({ title: 'Erro ao adicionar destinatários', description: recipientsError.message, variant: 'destructive' });
      setSubmitting(false);
      return;
    }

    toast({ title: 'Campanha criada!', description: `${recipients.length} destinatário(s) adicionado(s). O envio iniciará em breve.` });
    setDialogOpen(false);
    setMessageText('');
    setCampaignName('');
    setSelectedClientes([]);
    setSubmitting(false);
    loadCampaigns();
  };

  const handleCancel = async (jobId: string) => {
    setCancelling(jobId);
    const { error } = await supabase.functions.invoke('process-campaign-jobs', {
      body: { action: 'cancel', campaign_job_id: jobId },
    });
    setCancelling(null);
    if (error) {
      toast({ title: 'Erro ao cancelar', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Campanha cancelada' });
      loadCampaigns();
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Campanhas</h1>
          <p className="text-muted-foreground text-sm mt-1">Envie mensagens em massa para seus clientes via WhatsApp</p>
        </div>
        <Button onClick={handleOpenDialog}>
          <Plus className="h-4 w-4 mr-2" />
          Nova Campanha
        </Button>
      </div>

      <div className="card-elevated">
        {loading ? (
          <div className="flex items-center justify-center p-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : campaigns.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12 text-center">
            <Send className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">Nenhuma campanha criada ainda.</p>
            <p className="text-xs text-muted-foreground mt-1">Crie sua primeira campanha para enviar mensagens em massa.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-left px-6 py-3 font-medium text-muted-foreground">Campanha</th>
                  <th className="text-center px-6 py-3 font-medium text-muted-foreground">Status</th>
                  <th className="text-center px-6 py-3 font-medium text-muted-foreground">Enviados</th>
                  <th className="text-center px-6 py-3 font-medium text-muted-foreground">Falhas</th>
                  <th className="text-left px-6 py-3 font-medium text-muted-foreground">Criada em</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody>
                {campaigns.map((job) => (
                  <tr key={job.id} className="border-b last:border-0 hover:bg-muted/20">
                    <td className="px-6 py-4 font-medium">{job.name}</td>
                    <td className="px-6 py-4 text-center">
                      <Badge variant={STATUS_VARIANT[job.status] ?? 'secondary'}>
                        {STATUS_LABEL[job.status] ?? job.status}
                      </Badge>
                    </td>
                    <td className="px-6 py-4 text-center">
                      {job.sent}/{job.total}
                    </td>
                    <td className="px-6 py-4 text-center">
                      {job.failed > 0 ? (
                        <span className="text-destructive font-medium">{job.failed}</span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-muted-foreground">
                      {new Date(job.created_at).toLocaleDateString('pt-BR')}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {(job.status === 'pending' || job.status === 'running') && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleCancel(job.id)}
                          disabled={cancelling === job.id}
                        >
                          {cancelling === job.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <X className="h-3.5 w-3.5" />
                          )}
                          <span className="ml-1.5">Cancelar</span>
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Dialog: Nova Campanha */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Nova Campanha</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Nome da campanha (opcional)</Label>
              <input
                type="text"
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
                placeholder="Ex: Lembrete agosto 2026"
                className="input-field w-full"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Mensagem</Label>
              <Textarea
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                placeholder="Olá! Gostaríamos de informar..."
                rows={4}
              />
              <p className="text-xs text-muted-foreground">{messageText.length}/1000 caracteres</p>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Destinatários com WhatsApp</Label>
                <button
                  type="button"
                  onClick={() => setSelectedClientes(selectedClientes.length === clientes.length ? [] : clientes.map((c) => c.id))}
                  className="text-xs text-accent hover:underline"
                >
                  {selectedClientes.length === clientes.length ? 'Desmarcar todos' : 'Selecionar todos'}
                </button>
              </div>

              {clientes.length === 0 ? (
                <p className="text-sm text-muted-foreground p-3 bg-muted/30 rounded-md">
                  Nenhum cliente com WhatsApp cadastrado.
                </p>
              ) : (
                <div className="max-h-48 overflow-y-auto border rounded-md divide-y">
                  {clientes.map((c) => (
                    <label key={c.id} className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-muted/20">
                      <input
                        type="checkbox"
                        checked={selectedClientes.includes(c.id)}
                        onChange={() => toggleCliente(c.id)}
                        className="rounded"
                      />
                      <div>
                        <p className="text-sm font-medium">{c.nome}</p>
                        <p className="text-xs text-muted-foreground">{c.numero_whatsapp}</p>
                      </div>
                    </label>
                  ))}
                </div>
              )}
              {selectedClientes.length > 0 && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Users className="h-3.5 w-3.5" />
                  {selectedClientes.length} destinatário(s) selecionado(s)
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>
              Cancelar
            </Button>
            <Button onClick={handleCreate} disabled={submitting || !messageText.trim() || selectedClientes.length === 0}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
              Disparar Campanha
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
