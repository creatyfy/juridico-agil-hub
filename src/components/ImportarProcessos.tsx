import { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Search, Download, Loader2, CheckCircle2, FileText, RefreshCw, Users, Calendar, MapPin, Scale, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  searchJuditProcesses,
  checkJuditRequestStatus,
  getJuditResults,
  importProcesses,
  backfillClientLinks,
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
  [key: string]: any;
}

function ProcessCardDetails({ proc, getCnj, getCourt, getClass, getArea }: {
  proc: JuditProcesso;
  getCnj: (p: JuditProcesso) => string;
  getCourt: (p: JuditProcesso) => string;
  getClass: (p: JuditProcesso) => string;
  getArea: (p: JuditProcesso) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const parties = proc.parties || proc.partes || [];
  const activeParties = parties.filter((p: any) => p.side === 'Active' && p.person_type !== 'Advogado');
  const passiveParties = parties.filter((p: any) => p.side === 'Passive' && p.person_type !== 'Advogado');
  const vara = proc.courts?.[0]?.name || proc.vara || proc.court_division || '';
  const date = proc.distribution_date || proc.data_distribuicao;
  const formattedDate = date ? (() => {
    try { return format(new Date(date), "dd/MM/yyyy", { locale: ptBR }); } catch { return date; }
  })() : null;
  const lastStep = proc.last_step || (proc.steps && proc.steps.length > 0 ? proc.steps[proc.steps.length - 1] : null);

  return (
    <div className="flex-1 min-w-0 space-y-1.5">
      {/* CNJ */}
      <div className="flex items-center gap-2">
        <Scale className="h-3.5 w-3.5 text-accent shrink-0" />
        <p className="font-mono text-sm font-bold tracking-wide">{getCnj(proc)}</p>
      </div>

      {/* Classe + Tribunal */}
      <p className="text-sm font-medium text-muted-foreground">
        {getClass(proc)}{getCourt(proc) ? ` • ${getCourt(proc)}` : ''}
      </p>

      {/* Assunto + Vara + Data inline */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground/80">
        {getArea(proc) && (
          <span className="inline-flex items-center gap-1 bg-accent/8 text-accent px-2 py-0.5 rounded-md font-medium">
            {getArea(proc)}
          </span>
        )}
        {vara && (
          <span className="inline-flex items-center gap-1">
            <MapPin className="h-3 w-3" />
            {vara}
          </span>
        )}
        {formattedDate && (
          <span className="inline-flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {formattedDate}
          </span>
        )}
      </div>

      {/* Partes (autor/réu) - always visible */}
      {(activeParties.length > 0 || passiveParties.length > 0) && (
        <div className="flex items-start gap-2 text-xs text-muted-foreground/80 pt-1">
          <Users className="h-3.5 w-3.5 mt-0.5 shrink-0 text-accent/60" />
          <div className="space-y-0.5">
            {activeParties.slice(0, 2).map((p: any, i: number) => (
              <p key={`a-${i}`}><span className="font-medium text-foreground/70">Autor:</span> {p.name}</p>
            ))}
            {activeParties.length > 2 && !expanded && (
              <p className="text-muted-foreground/50">+{activeParties.length - 2} autor(es)</p>
            )}
            {passiveParties.slice(0, 2).map((p: any, i: number) => (
              <p key={`p-${i}`}><span className="font-medium text-foreground/70">Réu:</span> {p.name}</p>
            ))}
            {passiveParties.length > 2 && !expanded && (
              <p className="text-muted-foreground/50">+{passiveParties.length - 2} réu(s)</p>
            )}
          </div>
        </div>
      )}

      {/* Expandable details */}
      {(lastStep || (expanded && (activeParties.length > 2 || passiveParties.length > 2))) && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          className="text-xs text-accent hover:underline flex items-center gap-1 pt-1"
        >
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {expanded ? 'Menos detalhes' : 'Mais detalhes'}
        </button>
      )}

      {expanded && (
        <div className="space-y-2 pt-1">
          {/* All parties when expanded */}
          {activeParties.length > 2 && (
            <div className="text-xs text-muted-foreground/70 pl-5 space-y-0.5">
              {activeParties.slice(2).map((p: any, i: number) => (
                <p key={`ae-${i}`}><span className="font-medium">Autor:</span> {p.name}</p>
              ))}
            </div>
          )}
          {passiveParties.length > 2 && (
            <div className="text-xs text-muted-foreground/70 pl-5 space-y-0.5">
              {passiveParties.slice(2).map((p: any, i: number) => (
                <p key={`pe-${i}`}><span className="font-medium">Réu:</span> {p.name}</p>
              ))}
            </div>
          )}
          {/* Last movement */}
          {lastStep && (
            <div className="bg-muted/30 rounded-lg p-3 text-xs space-y-1">
              <p className="font-medium text-foreground/80">Última movimentação:</p>
              <p className="text-muted-foreground">
                {lastStep.date && (() => {
                  try { return format(new Date(lastStep.date), "dd/MM/yyyy", { locale: ptBR }) + ' — '; } catch { return ''; }
                })()}
                {lastStep.content || lastStep.description || lastStep.descricao || JSON.stringify(lastStep).slice(0, 200)}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ImportarProcessos({ onImported }: { onImported?: () => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<'idle' | 'searching' | 'results' | 'importing' | 'done'>('idle');
  const [results, setResults] = useState<JuditProcesso[]>([]);
  const [alreadyImported, setAlreadyImported] = useState<JuditProcesso[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [manualCnj, setManualCnj] = useState('');
  const [importMode, setImportMode] = useState<'oab' | 'manual'>('oab');
  const [showImported, setShowImported] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout>>();

  const filterAndSetResults = useCallback(async (processList: JuditProcesso[]) => {
    const cnjs = processList.map((p: any) =>
      p.code || p.lawsuit_cnj || p.lawsuit_number || p.cnj || p.numero || ''
    ).filter(Boolean);

    if (cnjs.length === 0) {
      setResults([]);
      setAlreadyImported([]);
      return;
    }

    const { supabase } = await import('@/integrations/supabase/client');
    
    // Fetch in batches of 100 to handle large lists
    const allExisting: string[] = [];
    for (let i = 0; i < cnjs.length; i += 100) {
      const batch = cnjs.slice(i, i + 100);
      const { data: existing } = await supabase
        .from('processos')
        .select('numero_cnj')
        .eq('user_id', user!.id)
        .in('numero_cnj', batch);
      if (existing) allExisting.push(...existing.map((p: any) => p.numero_cnj));
    }

    const existingCnjs = new Set(allExisting);

    const novos = processList.filter((p: any) => {
      const cnj = p.code || p.lawsuit_cnj || p.lawsuit_number || p.cnj || p.numero || '';
      return cnj && !existingCnjs.has(cnj);
    });

    const jaImportados = processList.filter((p: any) => {
      const cnj = p.code || p.lawsuit_cnj || p.lawsuit_number || p.cnj || p.numero || '';
      return cnj && existingCnjs.has(cnj);
    });

    setResults(novos);
    setAlreadyImported(jaImportados);
    setSelected(new Set(novos.map((_: any, i: number) => i)));
  }, [user]);

  const handleSearchByOab = useCallback(async () => {
    if (!user?.oab || !user?.uf) {
      toast.error('OAB ou UF não encontrada no seu perfil');
      return;
    }

    setStep('searching');
    setResults([]);
    setAlreadyImported([]);
    try {
      const data = await searchJuditProcesses(user.oab, user.uf);
      const requestId = data.request_id;

      if (!requestId) {
        toast.error('Erro ao iniciar busca na Judit');
        setStep('idle');
        return;
      }

      let attempts = 0;
      const poll = async () => {
        attempts++;
        if (attempts > 60) { // max ~5 min for large results
          toast.error('Timeout na busca. Tente novamente.');
          setStep('idle');
          return;
        }

        const status = await checkJuditRequestStatus(requestId);
        const requestStatus = status.request_status || status.status;

        if (requestStatus === 'completed' || requestStatus === 'done') {
          const resultsData = await getJuditResults(requestId);
          const pageData = resultsData?.page_data || resultsData?.data || [];
          const processList = pageData.map((item: any) => item.response_data || item).filter(Boolean);

          await filterAndSetResults(processList);
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
  }, [user, filterAndSetResults]);

  const handleSearchManual = useCallback(async () => {
    if (!manualCnj.trim()) {
      toast.error('Informe o número CNJ');
      return;
    }

    setStep('searching');
    setResults([]);
    setAlreadyImported([]);
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

          await filterAndSetResults(processList);
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
  }, [manualCnj, user, filterAndSetResults]);

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
          movimentacoes: (() => {
            // Gather all available movements, preferring full steps array
            const allSteps = p.steps || p.movimentacoes || [];
            if (allSteps.length > 0) return allSteps;
            if (p.last_step) {
              console.log('[ImportarProcessos] last_step keys:', Object.keys(p.last_step));
              console.log('[ImportarProcessos] last_step:', JSON.stringify(p.last_step).slice(0, 300));
              return [p.last_step];
            }
            return [];
          })(),
        };
      });

      const result = await importProcesses(toImport);

      // Auto-backfill any unlinked processes with clients from parties
      try {
        const backfillResult = await backfillClientLinks();
        if (backfillResult?.links_created > 0) {
          console.log(`[ImportarProcessos] Backfill: ${backfillResult.links_created} vínculos criados`);
        }
      } catch (e) {
        console.warn('[ImportarProcessos] Backfill warning:', e);
      }

      toast.success(`${toImport.length} novo(s) processo(s) importado(s) com sucesso!`);
      const importedId = result?.results?.find((r: any) => r.success)?.id;
      setStep('done');
      if (importedId) {
        navigate(`/processos/importacao-sucesso/${importedId}`);
      } else {
        onImported?.();
      }
    } catch (err: any) {
      toast.error(err.message || 'Erro ao importar');
      setStep('results');
    }
  }, [selected, results, importMode, onImported, navigate]);

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
          onClick={() => { setImportMode('oab'); setStep('idle'); setResults([]); setAlreadyImported([]); }}
        >
          Buscar por OAB
        </Button>
        <Button
          variant={importMode === 'manual' ? 'default' : 'outline'}
          size="sm"
          onClick={() => { setImportMode('manual'); setStep('idle'); setResults([]); setAlreadyImported([]); }}
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
            Consulta automática via API Judit usando sua OAB: <strong>{user?.uf}{user?.oab}</strong>
          </p>
          <Button onClick={handleSearchByOab}>
            <Search className="h-4 w-4 mr-2" />
            Buscar Todos os Processos
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
            Buscando todos os processos ativos. Isso pode levar alguns minutos.
          </p>
        </div>
      )}

      {/* Results */}
      {step === 'results' && (
        <div className="space-y-4">
          {/* Summary bar */}
          <div className="bg-muted/30 rounded-lg p-4 flex flex-wrap items-center gap-4 text-sm">
            <span className="font-medium">
              <span className="text-accent font-bold">{results.length}</span> novo(s)
            </span>
            <span className="text-muted-foreground">
              <span className="font-bold">{alreadyImported.length}</span> já importado(s)
            </span>
            <span className="text-muted-foreground">
              <span className="font-bold">{results.length + alreadyImported.length}</span> total encontrado(s)
            </span>
          </div>

          {results.length > 0 && (
            <>
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Processos disponíveis para importar</h3>
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
                    className={`card-elevated p-4 flex items-start gap-3 cursor-pointer transition-colors ${selected.has(idx) ? 'ring-2 ring-primary/50 bg-primary/5' : ''}`}
                    onClick={() => toggleSelect(idx)}
                  >
                    <Checkbox
                      checked={selected.has(idx)}
                      onCheckedChange={() => toggleSelect(idx)}
                      className="mt-1"
                    />
                    <ProcessCardDetails
                      proc={proc}
                      getCnj={getCnj}
                      getCourt={getCourt}
                      getClass={getClass}
                      getArea={getArea}
                    />
                  </div>
                ))}
              </div>
            </>
          )}

          {results.length === 0 && alreadyImported.length > 0 && (
            <div className="card-elevated p-12 text-center">
              <CheckCircle2 className="h-10 w-10 mx-auto mb-3 text-green-500" />
              <h3 className="text-lg font-semibold">✅ Todos os seus processos já estão cadastrados no sistema.</h3>
              <p className="text-sm text-muted-foreground mt-2">
                {alreadyImported.length} processo(s) encontrado(s), todos já importados.
              </p>
            </div>
          )}

          {alreadyImported.length > 0 && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setShowImported(!showImported)}
                className="flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors"
              >
                {showImported ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                {alreadyImported.length} processo(s) já importado(s)
              </button>
              {showImported && alreadyImported.map((proc, idx) => (
                <div
                  key={`imported-${idx}`}
                  className="card-elevated p-4 flex items-start gap-3 bg-muted/20 opacity-60"
                >
                  <div className="flex-1 min-w-0">
                    <ProcessCardDetails
                      proc={proc}
                      getCnj={getCnj}
                      getCourt={getCourt}
                      getClass={getClass}
                      getArea={getArea}
                    />
                  </div>
                  <Badge variant="secondary" className="shrink-0">Já importado</Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {step === 'results' && results.length === 0 && alreadyImported.length === 0 && (
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
            <Button variant="outline" onClick={() => { setStep('idle'); setResults([]); setAlreadyImported([]); setSelected(new Set()); }}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Buscar mais
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
