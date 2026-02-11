import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
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

      {/* Integrations placeholder */}
      {user?.role === 'advogado' && (
        <div className="card-elevated p-6">
          <h3 className="text-lg font-semibold mb-4">Integrações</h3>
          <p className="text-sm text-muted-foreground">
            Nenhuma integração configurada. Em breve você poderá conectar WhatsApp, tribunais e mais.
          </p>
        </div>
      )}
    </div>
  );
}
