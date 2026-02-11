import { useAuth } from '@/contexts/AuthContext';
import { FileText } from 'lucide-react';

export default function ClienteDashboard() {
  const { user } = useAuth();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Olá, {user?.name?.split(' ')[0] || 'Cliente'}</h1>
        <p className="text-muted-foreground text-sm mt-1">Acompanhe o andamento dos seus processos</p>
      </div>

      <div className="card-elevated flex flex-col items-center justify-center p-16 text-center">
        <FileText className="h-12 w-12 text-muted-foreground/30 mb-4" />
        <h3 className="text-lg font-semibold text-muted-foreground">Nenhum processo encontrado</h3>
        <p className="text-sm text-muted-foreground/70 mt-1 max-w-sm">
          Seus processos aparecerão aqui quando seu advogado vinculá-los à sua conta.
        </p>
      </div>
    </div>
  );
}
