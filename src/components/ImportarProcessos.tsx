import { useState, useRef, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Search, Download, Loader2, CheckCircle2, FileText, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import {
  searchJuditProcesses,
  checkJuditRequestStatus,
  getJuditResults,
  importProcesses,
} from '@/hooks/useProcessos';

interface JuditProcesso {
  id?: string;
  lawsuit_cnj?: string;
  lawsuit_number?: string;
  court?: string;
  court_name?: string;
  class_name?: string;
  subject?: string;
  parties?: any[];
  distribution_date?: string;
  status?: string;
  steps?: any[];
  movimentacoes?: any[];
  // Flexible keys from Judit response
  [key: string]: any;
}

export default function ImportarProcessos({ onImported }: { onImported?: () => void }) {
  const { user } = useAuth();
  const [step, setStep] = useState<'idle' | 'searching' | 'results' | 'importing' | 'done'>('idle');
  const [results, setResults] = useState<JuditProcesso[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [manualCnj, setManualCnj] = useState('');
  const [importMode, setImportMode] = useState<'oab' | 'manual'>('oab');
  const pollRef = useRef<ReturnType<typeof setTimeout>>();

  const handleSearchByOab = useCallback(async () => {
    if (!user?.oab || !user?.uf) {
      toast.error('OAB ou UF não encontrada no seu perfil');
      return;
    }

    setStep('searching');
    setResults([]);
    try {
      const data = await searchJuditProcesses(user.oab, user.uf);
      const requestId = data.request_id;

      if (!requestId) {
        toast.error('Erro ao iniciar busca na Judit');
        setStep('idle');
        return;
      }

      // Poll for results
      let attempts = 0;
      const poll = async () => {
        attempts++;
        if (attempts > 24) { // max ~2 min
          toast.error('Timeout na busca. Tente novamente.');
          setStep('idle');
          return;
        }

        const status = await checkJuditRequestStatus(requestId);
        const requestStatus = status.request_status || status.status;

        if (requestStatus === 'completed' || requestStatus === 'done') {
          const resultsData = await getJuditResults(requestId);
          // Judit returns { page_data: [{ response_data: {...} }] }
          const pageData = resultsData?.page_data || resultsData?.data || [];
          const processList = pageData.map((item: any) => item.response_data || item).filter(Boolean);
          setResults(processList);
          setStep('results');
          toast.success(`${processList.length} processo(s) encontrado(s)`);
        } else if (requestStatus === 'failed' || requestStatus === 'error') {
          toast.error('Busca falhou na Judit. Tente novamente.');
          setStep('idle');
        } else {
          pollRef.current = setTimeout(poll, 5000);
        }
      };

      pollRef.current = setTimeout(poll, 3000);
    } catch (err: any) {
      toast.error(err.message || 'Erro ao buscar processos');
      setStep('idle');
    }
  }, [user]);

  const handleSearchManual = useCallback(async () => {
    if (!manualCnj.trim()) {
      toast.error('Informe o número CNJ');
      return;
    }

    setStep('searching');
    setResults([]);
    try {
      const { data, error } = await import('@/integrations/supabase/client').then(m =>
        m.supabase.functions.invoke('search-processes', {
          body: { action: 'create', search_type: 'lawsuit_cnj', search_key: manualCnj.trim() },
        })
      );
      if (error) throw error;

      const requestId = data.request_id;
      if (!requestId) {
        toast.error('Erro ao iniciar busca');
        setStep('idle');
        return;
      }

      let attempts = 0;
      const poll = async () => {
        attempts++;
        if (attempts > 24) {
          toast.error('Timeout na busca');
          setStep('idle');
          return;
        }

        const status = await checkJuditRequestStatus(requestId);
        const requestStatus = status.request_status || status.status;

        if (requestStatus === 'completed' || requestStatus === 'done') {
          const resultsData = await getJuditResults(requestId);
          const pageData = resultsData?.page_data || resultsData?.data || [];
          const processList = pageData.map((item: any) => item.response_data || item).filter(Boolean);
          setResults(processList);
          setStep('results');
          toast.success(`Processo encontrado`);
        } else if (requestStatus === 'failed' || requestStatus === 'error') {
          toast.error('Processo não encontrado');
          setStep('idle');
        } else {
          pollRef.current = setTimeout(poll, 5000);
        }
      };

      pollRef.current = setTimeout(poll, 3000);
    } catch (err: any) {
      toast.error(err.message || 'Erro na busca');
      setStep('idle');
    }
  }, [manualCnj]);

  const handleImport = useCallback(async () => {
    if (selected.size === 0) {
      toast.error('Selecione ao menos um processo');
      return;
    }

    setStep('importing');
    try {
      const toImport = Array.from(selected).map(idx => {
        const p = results[idx];
        return {
          numero_cnj: p.code || p.lawsuit_cnj || p.lawsuit_number || p.cnj || p.numero || '',
          tribunal: p.justice_description || p.court_name || p.court || p.tribunal || '',
          vara: p.courts?.[0]?.name || p.vara || p.court_division || '',
          classe: p.classifications?.[0]?.name || p.class_name || p.classe || '',
          assunto: p.area || p.subject || p.assunto || '',
          partes: p.parties || p.partes || [],
          status: 'ativo',
          data_distribuicao: p.distribution_date || p.data_distribuicao || null,
          judit_process_id: p.response_id?.toString() || p.id?.toString() || null,
          fonte: importMode === 'manual' ? 'manual' : 'judit',
          movimentacoes: p.last_step ? [p.last_step] : (p.steps || p.movimentacoes || []),
        };
      });

      const result = await importProcesses(toImport);
      toast.success(`${toImport.length} processo(s) importado(s) com sucesso!`);
      setStep('done');
      onImported?.();
    } catch (err: any) {
      toast.error(err.message || 'Erro ao importar');
      setStep('results');
    }
  }, [selected, results, importMode, onImported]);

  const toggleSelect = (idx: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === results.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(results.map((_, i) => i)));
    }
  };

  const getCnj = (p: JuditProcesso) => p.code || p.lawsuit_cnj || p.lawsuit_number || p.cnj || p.numero || 'N/A';
  const getCourt = (p: JuditProcesso) => p.courts?.[0]?.name || p.justice_description || p.court_name || p.court || p.tribunal || '';
  const getClass = (p: JuditProcesso) => p.classifications?.[0]?.name || p.class_name || p.classe || '';
  const getArea = (p: JuditProcesso) => p.area || p.subject || p.assunto || '';

  return (
    <div className="space-y-6">
      {/* Mode selector */}
      <div className="flex gap-2">
        <Button
          variant={importMode === 'oab' ? 'default' : 'outline'}
          size="sm"
          onClick={() => { setImportMode('oab'); setStep('idle'); setResults([]); }}
        >
          Buscar por OAB
        </Button>
        <Button
          variant={importMode === 'manual' ? 'default' : 'outline'}
          size="sm"
          onClick={() => { setImportMode('manual'); setStep('idle'); setResults([]); }}
        >
          Importar por CNJ
        </Button>
      </div>

      {/* Search area */}
      {step === 'idle' && importMode === 'oab' && (
        <div className="card-elevated p-6 text-center">
          <Search className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
          <h3 className="text-lg font-semibold">Buscar processos pela OAB</h3>
          <p className="text-sm text-muted-foreground mt-1 mb-4">
            Consulta automática via API Judit usando sua OAB: <strong>{user?.oab}/{user?.uf}</strong>
          </p>
          <Button onClick={handleSearchByOab}>
            <Search className="h-4 w-4 mr-2" />
            Buscar Processos
          </Button>
        </div>
      )}

      {step === 'idle' && importMode === 'manual' && (
        <div className="card-elevated p-6">
          <h3 className="text-lg font-semibold mb-3">Importar processo por número CNJ</h3>
          <div className="flex gap-3">
            <input
              type="text"
              placeholder="0000000-00.0000.0.00.0000"
              value={manualCnj}
              onChange={(e) => setManualCnj(e.target.value)}
              className="input-field flex-1"
            />
            <Button onClick={handleSearchManual}>
              <Search className="h-4 w-4 mr-2" />
              Buscar
            </Button>
          </div>
        </div>
      )}

      {/* Loading */}
      {step === 'searching' && (
        <div className="card-elevated p-12 text-center">
          <Loader2 className="h-10 w-10 mx-auto mb-3 animate-spin text-primary" />
          <h3 className="text-lg font-semibold">Consultando API Judit...</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Isso pode levar até 2 minutos. Não feche esta página.
          </p>
        </div>
      )}

      {/* Results */}
      {step === 'results' && results.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">{results.length} processo(s) encontrado(s)</h3>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={toggleAll}>
                {selected.size === results.length ? 'Desmarcar todos' : 'Selecionar todos'}
              </Button>
              <Button size="sm" onClick={handleImport} disabled={selected.size === 0}>
                <Download className="h-4 w-4 mr-2" />
                Importar {selected.size > 0 ? `(${selected.size})` : ''}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            {results.map((proc, idx) => (
              <div
                key={idx}
                className={`card-elevated p-4 flex items-start gap-3 cursor-pointer transition-colors ${selected.has(idx) ? 'ring-2 ring-primary/50 bg-primary/5' : ''
                  }`}
                onClick={() => toggleSelect(idx)}
              >
                <Checkbox
                  checked={selected.has(idx)}
                  onCheckedChange={() => toggleSelect(idx)}
                  className="mt-1"
                />
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-sm font-semibold">{getCnj(proc)}</p>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {getClass(proc)}{getCourt(proc) ? ` • ${getCourt(proc)}` : ''}
                  </p>
                  {(getArea(proc)) && (
                    <p className="text-xs text-muted-foreground/70 mt-0.5">
                      {getArea(proc)}
                    </p>
                  )}
                </div>
                <FileText className="h-5 w-5 text-muted-foreground/30 shrink-0" />
              </div>
            ))}
          </div>
        </div>
      )}

      {step === 'results' && results.length === 0 && (
        <div className="card-elevated p-12 text-center">
          <FileText className="h-10 w-10 mx-auto mb-3 text-muted-foreground/30" />
          <h3 className="text-lg font-semibold text-muted-foreground">Nenhum processo encontrado</h3>
        </div>
      )}

      {/* Importing */}
      {step === 'importing' && (
        <div className="card-elevated p-12 text-center">
          <Loader2 className="h-10 w-10 mx-auto mb-3 animate-spin text-primary" />
          <h3 className="text-lg font-semibold">Importando processos...</h3>
        </div>
      )}

      {/* Done */}
      {step === 'done' && (
        <div className="card-elevated p-12 text-center">
          <CheckCircle2 className="h-10 w-10 mx-auto mb-3 text-green-500" />
          <h3 className="text-lg font-semibold">Processos importados com sucesso!</h3>
          <p className="text-sm text-muted-foreground mt-1 mb-4">
            As movimentações serão monitoradas automaticamente.
          </p>
          <div className="flex gap-2 justify-center">
            <Button variant="outline" onClick={() => { setStep('idle'); setResults([]); setSelected(new Set()); }}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Buscar mais
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
