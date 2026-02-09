import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import StatusBadge from '@/components/StatusBadge';
import { Save } from 'lucide-react';

export default function Configuracoes() {
  const { user } = useAuth();

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">Configurações</h1>
        <p className="text-muted-foreground text-sm mt-1">Gerencie suas preferências e dados</p>
      </div>

      {/* Profile */}
      <div className="card-elevated p-6">
        <h3 className="text-lg font-semibold mb-4">Dados Pessoais</h3>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block">Nome completo</label>
            <input type="text" defaultValue={user?.name} className="input-field w-full" />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">E-mail</label>
            <input type="email" defaultValue={user?.email} className="input-field w-full" />
          </div>
          {user?.role === 'advogado' && (
            <div>
              <label className="text-sm font-medium mb-1.5 block">OAB</label>
              <input type="text" defaultValue={user?.oab} className="input-field w-full" readOnly />
            </div>
          )}
        </div>
        <Button className="btn-accent mt-4">
          <Save className="h-4 w-4 mr-2" /> Salvar alterações
        </Button>
      </div>

      {/* Plan */}
      {user?.role === 'advogado' && (
        <div className="card-elevated p-6">
          <h3 className="text-lg font-semibold mb-4">Plano e Assinatura</h3>
          <div className="flex items-center gap-3 mb-4">
            <StatusBadge variant="info">Plano Premium</StatusBadge>
            <span className="text-sm text-muted-foreground">Ativo até 15/03/2026</span>
          </div>
          <div className="p-4 rounded-lg bg-secondary/50">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-2xl font-bold">47</p>
                <p className="text-xs text-muted-foreground">Processos</p>
              </div>
              <div>
                <p className="text-2xl font-bold">5</p>
                <p className="text-xs text-muted-foreground">Clientes</p>
              </div>
              <div>
                <p className="text-2xl font-bold">∞</p>
                <p className="text-xs text-muted-foreground">Consultas</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Integrations */}
      {user?.role === 'advogado' && (
        <div className="card-elevated p-6">
          <h3 className="text-lg font-semibold mb-4">Integrações</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50">
              <div>
                <p className="text-sm font-medium">WhatsApp Business</p>
                <p className="text-xs text-muted-foreground">Atendimento automático aos clientes</p>
              </div>
              <StatusBadge variant="success">Conectado</StatusBadge>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50">
              <div>
                <p className="text-sm font-medium">Consulta Processual</p>
                <p className="text-xs text-muted-foreground">Monitoramento de tribunais</p>
              </div>
              <StatusBadge variant="success">Ativo</StatusBadge>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/50">
              <div>
                <p className="text-sm font-medium">Inteligência Artificial</p>
                <p className="text-xs text-muted-foreground">Análise e resumo de movimentações</p>
              </div>
              <StatusBadge variant="warning">Em breve</StatusBadge>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
