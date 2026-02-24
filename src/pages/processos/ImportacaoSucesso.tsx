import { Link, useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, Link2, Radar, ArrowLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { activateProcessMonitoring } from '@/hooks/useProcessos';
import { toast } from 'sonner';

interface ProcessoSummary {
  id: string;
  numero_cnj: string;
  tribunal: string | null;
}

interface MovimentacaoSummary {
  descricao: string;
  data_movimentacao: string | null;
}

export default function ImportacaoSucesso() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [processo, setProcesso] = useState<ProcessoSummary | null>(null);
  const [ultimaMovimentacao, setUltimaMovimentacao] = useState<MovimentacaoSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState(false);

  useEffect(() => {
    async function fetchData() {
      if (!id) return;

      const { data: processoData } = await supabase
        .from('processos')
        .select('id, numero_cnj, tribunal')
        .eq('id', id)
        .single();

      const { data: movData } = await supabase
        .from('movimentacoes')
        .select('descricao, data_movimentacao')
        .eq('processo_id', id)
        .order('data_movimentacao', { ascending: false })
        .limit(1)
        .maybeSingle();

      setProcesso(processoData as ProcessoSummary | null);
      setUltimaMovimentacao((movData as MovimentacaoSummary | null) || null);
      setLoading(false);
    }

    fetchData();
  }, [id]);

  const handleActivateMonitoring = async () => {
    if (!id) return;
    setActivating(true);
    try {
      await activateProcessMonitoring(id);
      toast.success('Monitoramento ativado com sucesso');
    } catch (err: any) {
      toast.error(err.message || 'Erro ao ativar monitoramento');
    }
    setActivating(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="h-6 w-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (!processo) {
    return (
      <div className="card-elevated p-8 text-center space-y-4">
        <p className="text-sm text-muted-foreground">Não foi possível carregar os dados da importação.</p>
        <Button onClick={() => navigate('/processos')}>Voltar para processos</Button>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <Link to="/processos">
        <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1" /> Voltar</Button>
      </Link>

      <div className="card-elevated p-8 text-center">
        <CheckCircle2 className="h-12 w-12 mx-auto text-green-500 mb-3" />
        <h1 className="text-2xl font-bold">Processo importado com sucesso</h1>
        <p className="text-sm text-muted-foreground mt-1">Seu processo já está disponível para acompanhamento.</p>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="card-elevated p-4">
          <p className="text-xs text-muted-foreground mb-1">Número do processo</p>
          <p className="font-mono text-sm font-semibold">{processo.numero_cnj}</p>
        </div>
        <div className="card-elevated p-4">
          <p className="text-xs text-muted-foreground mb-1">Tribunal</p>
          <p className="text-sm font-medium">{processo.tribunal || 'Não informado'}</p>
        </div>
      </div>

      <div className="card-elevated p-4">
        <p className="text-xs text-muted-foreground mb-1">Última movimentação</p>
        {ultimaMovimentacao ? (
          <>
            <p className="text-sm font-medium">{ultimaMovimentacao.descricao}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {ultimaMovimentacao.data_movimentacao
                ? new Date(ultimaMovimentacao.data_movimentacao).toLocaleDateString('pt-BR')
                : 'Sem data'}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Sem movimentações registradas.</p>
        )}
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <Link to={`/processos/${processo.id}`}>
          <Button className="w-full"><Link2 className="h-4 w-4 mr-2" /> Vincular cliente</Button>
        </Link>
        <Button variant="outline" className="w-full" onClick={handleActivateMonitoring} disabled={activating}>
          <Radar className="h-4 w-4 mr-2" /> Ativar monitoramento
        </Button>
      </div>
    </div>
  );
}
