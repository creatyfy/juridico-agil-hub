import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { juditRequest } from "../_shared/judit-client.ts";
import { logTenantAction } from "../_shared/audit-log.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

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

    // Optional: single processo sync (manual trigger by user)
    const body = await req.json().catch(() => ({}));
    const { processo_id } = body;

    // If called with auth header, verify user
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

    // Get monitored processes
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

    const syncResults = [];

    for (const mon of (monitoramentos || [])) {
      const processo = (mon as any).processos;
      if (!processo?.numero_cnj) continue;

      try {
        // Create request on Judit for this CNJ
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

        // Poll for completion (max 30s)
        let attempts = 0;
        let completed = false;
        while (attempts < 6 && !completed) {
          await new Promise(r => setTimeout(r, 5000));
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

        // Get results
        const resultsData = await juditRequest({
          tenantKey: mon.user_id,
          apiKey: JUDIT_API_KEY,
          path: `/responses?request_id=${requestId}`,
        });

        // Extract movements from response
        const lawsuitData = Array.isArray(resultsData) ? resultsData[0] : resultsData;
        const steps = lawsuitData?.steps || lawsuitData?.movimentacoes || [];

        if (steps.length > 0) {
          // Get existing movement IDs to avoid duplicates
          const { data: existing } = await supabase
            .from('movimentacoes')
            .select('judit_movement_id')
            .eq('processo_id', processo.id)
            .not('judit_movement_id', 'is', null);

          const existingIds = new Set((existing || []).map(e => e.judit_movement_id));

          const newMovs = steps
            .filter((s: any) => !existingIds.has(s.id?.toString()))
            .map((s: any) => ({
              processo_id: processo.id,
              data_movimentacao: s.date || s.data,
              tipo: s.type || s.tipo,
              descricao: s.content || s.description || s.descricao || 'Movimentação',
              conteudo: s.content || s.conteudo,
              judit_movement_id: s.id?.toString(),
            }));

          if (newMovs.length > 0) {
            await supabase.from('movimentacoes').insert(newMovs);

            // Create notification for process owner
            await supabase.from('notificacoes').insert({
              user_id: mon.user_id,
              tipo: 'movimentacao',
              titulo: 'Nova movimentação processual',
              mensagem: `${newMovs.length} nova(s) movimentação(ões) no processo ${processo.numero_cnj}`,
              link: `/processos/${processo.id}`,
            });

            // Notify linked clients
            const { data: linkedClients } = await supabase
              .from('cliente_processos')
              .select('clientes(auth_user_id)')
              .eq('processo_id', processo.id)
              .eq('status', 'ativo');

            for (const lc of (linkedClients || [])) {
              const authUserId = (lc as any).clientes?.auth_user_id;
              if (authUserId) {
                await supabase.from('notificacoes').insert({
                  user_id: authUserId,
                  tipo: 'movimentacao',
                  titulo: 'Nova movimentação no seu processo',
                  mensagem: `${newMovs.length} nova(s) movimentação(ões) no processo ${processo.numero_cnj}`,
                  link: `/processos/${processo.id}`,
                });
              }
            }
          }

          syncResults.push({ cnj: processo.numero_cnj, newMovements: newMovs.length });

          await logTenantAction(supabase, {
            tenantId: mon.user_id,
            userId: userId || mon.user_id,
            action: 'processo_sincronizado',
            entity: 'processo',
            entityId: processo.id,
            metadata: {
              numero_cnj: processo.numero_cnj,
              novas_movimentacoes: newMovs.length,
              source: 'sync-movements',
            },
          });
        } else {
          syncResults.push({ cnj: processo.numero_cnj, newMovements: 0 });

          await logTenantAction(supabase, {
            tenantId: mon.user_id,
            userId: userId || mon.user_id,
            action: 'processo_sincronizado',
            entity: 'processo',
            entityId: processo.id,
            metadata: {
              numero_cnj: processo.numero_cnj,
              novas_movimentacoes: 0,
              source: 'sync-movements',
            },
          });
        }

        // Update last sync time
        await supabase
          .from('processo_monitoramentos')
          .update({ ultima_sync: new Date().toISOString() })
          .eq('id', mon.id);

      } catch (err) {
        syncResults.push({ cnj: processo.numero_cnj, error: String(err) });
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
