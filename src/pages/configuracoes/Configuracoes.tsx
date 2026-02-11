import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Save, Wifi, WifiOff, CheckCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useWhatsApp } from '@/hooks/useWhatsApp';

export default function Configuracoes() {
  const { user } = useAuth();
  const wpp = useWhatsApp();

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
            <input type="text" defaultValue={user?.name} className="input-field w-full" readOnly />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">E-mail</label>
            <input type="email" defaultValue={user?.email} className="input-field w-full" readOnly />
          </div>
          {user?.oab && (
            <div>
              <label className="text-sm font-medium mb-1.5 block">OAB</label>
              <input type="text" defaultValue={`${user.oab}/${user.uf || ''}`} className="input-field w-full" readOnly />
            </div>
          )}
          {user?.cpf && (
            <div>
              <label className="text-sm font-medium mb-1.5 block">CPF</label>
              <input type="text" defaultValue={user.cpf} className="input-field w-full" readOnly />
            </div>
          )}
          {user?.whatsapp && (
            <div>
              <label className="text-sm font-medium mb-1.5 block">WhatsApp</label>
              <input type="text" defaultValue={user.whatsapp} className="input-field w-full" readOnly />
            </div>
          )}
        </div>
      </div>

      {/* WhatsApp Integration */}
      {user?.role === 'advogado' && (
        <div className="card-elevated p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">WhatsApp / Evolution API</h3>
            {wpp.status === 'connected' ? (
              <Badge variant="default" className="bg-green-600"><Wifi className="h-3 w-3 mr-1" />Conectado</Badge>
            ) : (
              <Badge variant="outline"><WifiOff className="h-3 w-3 mr-1" />Desconectado</Badge>
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
