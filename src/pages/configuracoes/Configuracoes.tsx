import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Pencil, Save, X, Wifi, WifiOff, CheckCircle, Bell } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useWhatsApp } from '@/hooks/useWhatsApp';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export default function Configuracoes() {
  const { user } = useAuth();
  const wpp = useWhatsApp();
  const { toast } = useToast();

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [nome, setNome] = useState(user?.name ?? '');
  const [whatsapp, setWhatsapp] = useState(user?.whatsapp ?? '');
  const [reminderDays, setReminderDays] = useState(7);
  const [savingReminder, setSavingReminder] = useState(false);

  useEffect(() => {
    (supabase as any).rpc('get_reminder_days').then(({ data }: any) => {
      if (data != null) setReminderDays(data as number);
    });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    const { error } = await supabase.auth.updateUser({
      data: { full_name: nome.trim(), whatsapp: whatsapp.trim() },
    });
    setSaving(false);

    if (error) {
      toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' });
      return;
    }

    toast({ title: 'Dados atualizados', description: 'Suas informações foram salvas.' });
    setEditing(false);
  };

  const handleCancel = () => {
    setNome(user?.name ?? '');
    setWhatsapp(user?.whatsapp ?? '');
    setEditing(false);
  };

  const handleSaveReminder = async () => {
    setSavingReminder(true);
    const { error } = await (supabase as any).rpc('set_reminder_days', { p_days: reminderDays });
    setSavingReminder(false);
    if (error) {
      toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Preferência salva', description: `Lembretes serão enviados após ${reminderDays} dias sem novidades.` });
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">Configurações</h1>
        <p className="text-muted-foreground text-sm mt-1">Gerencie suas preferências e dados</p>
      </div>

      {/* Dados Pessoais */}
      <div className="card-elevated p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Dados Pessoais</h3>
          {!editing ? (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="h-3.5 w-3.5 mr-1.5" />
              Editar
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleCancel} disabled={saving}>
                <X className="h-3.5 w-3.5 mr-1.5" />
                Cancelar
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saving}>
                <Save className="h-3.5 w-3.5 mr-1.5" />
                {saving ? 'Salvando...' : 'Salvar'}
              </Button>
            </div>
          )}
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block">Nome completo</label>
            <input
              type="text"
              value={editing ? nome : (user?.name ?? '')}
              onChange={(e) => setNome(e.target.value)}
              className="input-field w-full"
              readOnly={!editing}
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">E-mail</label>
            <input
              type="email"
              defaultValue={user?.email}
              className="input-field w-full"
              readOnly
            />
            <p className="text-xs text-muted-foreground mt-1">Não editável — entre em contato com o suporte.</p>
          </div>
          {user?.oab && (
            <div>
              <label className="text-sm font-medium mb-1.5 block">OAB</label>
              <input
                type="text"
                defaultValue={`${user.oab}/${user.uf || ''}`}
                className="input-field w-full"
                readOnly
              />
              <p className="text-xs text-muted-foreground mt-1">Validado no cadastro, não editável.</p>
            </div>
          )}
          {user?.cpf && (
            <div>
              <label className="text-sm font-medium mb-1.5 block">CPF</label>
              <input
                type="text"
                defaultValue={user.cpf}
                className="input-field w-full"
                readOnly
              />
            </div>
          )}
          <div>
            <label className="text-sm font-medium mb-1.5 block">WhatsApp pessoal</label>
            <input
              type="text"
              value={editing ? whatsapp : (user?.whatsapp ?? '')}
              onChange={(e) => setWhatsapp(e.target.value)}
              placeholder="5511999999999"
              className="input-field w-full"
              readOnly={!editing}
            />
            {editing && (
              <p className="text-xs text-muted-foreground mt-1">
                Formato: código do país + DDD + número (ex: 5511999999999)
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Reminder settings */}
      {user?.role === 'advogado' && (
        <div className="card-elevated p-6">
          <div className="flex items-center gap-2 mb-4">
            <Bell className="h-5 w-5 text-accent" />
            <h3 className="text-lg font-semibold">Lembrete proativo</h3>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Quando um processo ficar sem movimentação por esse número de dias, seus clientes receberão uma mensagem informativa automaticamente.
          </p>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min={1}
              max={90}
              value={reminderDays}
              onChange={(e) => setReminderDays(Math.max(1, Math.min(90, Number(e.target.value))))}
              className="input-field w-24 text-center"
            />
            <span className="text-sm text-muted-foreground">dias sem movimentação</span>
            <Button size="sm" onClick={handleSaveReminder} disabled={savingReminder}>
              <Save className="h-3.5 w-3.5 mr-1.5" />
              {savingReminder ? 'Salvando...' : 'Salvar'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">Mínimo 1 dia, máximo 90 dias. Padrão: 7 dias.</p>
        </div>
      )}

      {/* WhatsApp Integration */}
      {user?.role === 'advogado' && (
        <div className="card-elevated p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">WhatsApp / Evolution API</h3>
            {wpp.status === 'connected' ? (
              <Badge variant="default" className="bg-green-600">
                <Wifi className="h-3 w-3 mr-1" />Conectado
              </Badge>
            ) : (
              <Badge variant="outline">
                <WifiOff className="h-3 w-3 mr-1" />Desconectado
              </Badge>
            )}
          </div>
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span>Credenciais configuradas no backend</span>
            </div>
            <p className="text-sm text-muted-foreground">
              {wpp.status === 'connected'
                ? 'Seu WhatsApp está conectado. Acesse a página de Atendimento para gerenciar conversas.'
                : 'Acesse a página de Atendimento para conectar seu WhatsApp via QR Code.'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
