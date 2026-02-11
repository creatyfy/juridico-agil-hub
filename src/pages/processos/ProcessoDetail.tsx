import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function ProcessoDetail() {
  const { id } = useParams();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/processos">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
          </Button>
        </Link>
      </div>

      <div className="card-elevated flex flex-col items-center justify-center p-16 text-center">
        <FileText className="h-12 w-12 text-muted-foreground/30 mb-4" />
        <h3 className="text-lg font-semibold text-muted-foreground">Processo não encontrado</h3>
        <p className="text-sm text-muted-foreground/70 mt-1 max-w-sm">
          O processo #{id} não foi encontrado ou ainda não foi cadastrado.
        </p>
      </div>
    </div>
  );
}
