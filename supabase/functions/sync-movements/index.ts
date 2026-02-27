import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { juditRequest } from "../_shared/judit-client.ts";
import { logTenantAction } from "../_shared/audit-log.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

type JuditStep = {
  id?: string | number
  date?: string
  data?: string
  type?: string
  tipo?: string
  content?: string
  description?: string
  descricao?: string
  resumo?: string
}

function summarizeMovement(step: JuditStep): string {
  const raw = step.resumo || step.description || step.descricao || step.content || 'Movimentação processual detectada'
  return raw.slice(0, 400)
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const JUDIT_API_KEY = Deno.env.get('JUDIT_API_KEY');
    if (!JUDIT_API_KEY) throw new Error('JUDIT_API_KEY not configured');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json().catch(() => ({}));
    const { processo_id } = body;

    const authHeader = req.headers.get('Authorization');
    let userId: string | null = null;
    if (authHeader) {
      const supabaseAnon = Deno.env.get('SUPABASE_ANON_KEY')!;
      const supabaseAuth = createClient(supabaseUrl, supabaseAnon, {
        global: { headers: { Authorization: authHeader } }
      });
      const { data: { user } } = await supabaseAuth.auth.getUser();
      userId = user?.id || null;
    }

    let query = supabase
      .from('processo_monitoramentos')
      .select('*, processos(*)')
      .eq('ativo', true);

    if (processo_id) {
      query = query.eq('processo_id', processo_id);
      if (userId) query = query.eq('user_id', userId);
    }

    const { data: monitoramentos, error: monError } = await query;
    if (monError) throw new Error(`Failed to fetch monitoramentos: ${monError.message}`);

    const syncResults: Array<Record<string, unknown>> = [];

    for (const mon of (monitoramentos || [])) {
      const processo = (mon as any).processos;
      if (!processo?.numero_cnj) continue;

      try {
        const createData = await juditRequest({
          tenantKey: mon.user_id,
          apiKey: JUDIT_API_KEY,
          path: '/requests',
          method: 'POST',
          body: {
            search: {
              search_type: 'lawsuit_cnj',
              search_key: processo.numero_cnj,
              response_type: 'lawsuit',
            },
          },
        });

        const requestId = (createData as any).request_id;

        let attempts = 0;
        let completed = false;
        while (attempts < 6 && !completed) {
          await new Promise((r) => setTimeout(r, 5000));
          const statusData = await juditRequest({
            tenantKey: mon.user_id,
            apiKey: JUDIT_API_KEY,
            path: `/requests/${requestId}`,
          }) as any;

          if (statusData.request_status === 'completed' || statusData.request_status === 'done') {
            completed = true;
          }
          attempts++;
        }

        if (!completed) {
          syncResults.push({ cnj: processo.numero_cnj, status: 'pending', requestId });
          continue;
        }

        const resultsData = await juditRequest({
          tenantKey: mon.user_id,
          apiKey: JUDIT_API_KEY,
          path: `/responses?request_id=${requestId}`,
        });

        const lawsuitData = Array.isArray(resultsData) ? resultsData[0] : resultsData;
        const steps: JuditStep[] = lawsuitData?.steps || lawsuitData?.movimentacoes || [];

        let newMovementsCount = 0;
        if (steps.length > 0) {
          const { data: existing } = await supabase
            .from('movimentacoes')
            .select('judit_movement_id')
            .eq('processo_id', processo.id)
            .not('judit_movement_id', 'is', null);

          const existingIds = new Set((existing || []).map((e: { judit_movement_id: string }) => e.judit_movement_id));

          const newMovs = steps
            .filter((s) => s.id && !existingIds.has(String(s.id)))
            .map((s) => ({
              processo_id: processo.id,
              data_movimentacao: s.date || s.data,
              tipo: s.type || s.tipo,
              descricao: s.content || s.description || s.descricao || 'Movimentação',
              conteudo: s.content || s.descricao,
              judit_movement_id: String(s.id),
            }));

          if (newMovs.length > 0) {
            const { error: movError } = await supabase.from('movimentacoes').insert(newMovs);
            if (movError) throw movError;

            const eventRows = newMovs.map((movement) => ({
              tenant_id: mon.user_id,
              event_type: 'PROCESS_MOVEMENT_DETECTED',
              dedupe_key: `${processo.id}:${movement.judit_movement_id}`,
              payload: {
                processo_id: processo.id,
                movimentacao_id: movement.judit_movement_id,
                resumo: summarizeMovement(movement as unknown as JuditStep),
              },
            }));

            const { error: evtError } = await supabase
              .from('domain_events')
              .upsert(eventRows, { onConflict: 'tenant_id,event_type,dedupe_key', ignoreDuplicates: true });

            if (evtError) throw evtError;
            newMovementsCount = newMovs.length;
          }
        }

        syncResults.push({ cnj: processo.numero_cnj, newMovements: newMovementsCount });

        await logTenantAction(supabase, {
          tenantId: mon.user_id,
          userId: userId || mon.user_id,
          action: 'processo_sincronizado',
          entity: 'processo',
          entityId: processo.id,
          metadata: {
            numero_cnj: processo.numero_cnj,
            novas_movimentacoes: newMovementsCount,
            source: 'sync-movements-event-driven',
          },
        });

        await supabase
          .from('processo_monitoramentos')
          .update({ ultima_sync: new Date().toISOString() })
          .eq('id', mon.id);
      } catch {
        syncResults.push({ cnj: processo.numero_cnj, error: 'sync_failed' });
      }
    }

    return new Response(JSON.stringify({ results: syncResults }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
