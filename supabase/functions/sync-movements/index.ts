import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// deno-lint-ignore no-explicit-any
type AnySupabase = SupabaseClient<any, any, any>;

import { juditRequest } from "../_shared/judit-client.ts";
import { logTenantAction } from "../_shared/audit-log.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type JuditStep = {
  id?: string | number;
  date?: string;
  data?: string;
  type?: string;
  tipo?: string;
  content?: string;
  description?: string;
  descricao?: string;
  resumo?: string;
};

type MonitoramentoRow = {
  id: string;
  user_id: string;
  processo_id: string;
  judit_request_id?: string | null;
  judit_request_status?: string | null;
  judit_request_attempts?: number | null;
  processos?: {
    id: string;
    numero_cnj?: string | null;
  } | null;
};

function summarizeMovement(step: JuditStep): string {
  const raw = step.resumo || step.description || step.descricao || step.content || "Movimentação processual detectada";
  return raw.slice(0, 400);
}

async function collectCompletedRequest(params: {
  supabase: AnySupabase;
  mon: MonitoramentoRow;
  processo: { id: string; numero_cnj?: string | null };
  requestId: string;
  userId: string | null;
  syncResults: Array<Record<string, unknown>>;
}) {
  const { supabase, mon, processo, requestId, userId, syncResults } = params;

  const resultsData = await juditRequest({
    tenantKey: mon.user_id,
    apiKey: Deno.env.get("JUDIT_API_KEY")!,
    path: `/responses?request_id=${requestId}`,
  });

  const lawsuitData = Array.isArray(resultsData) ? resultsData[0] : resultsData;
  const steps: JuditStep[] = lawsuitData?.steps || lawsuitData?.movimentacoes || [];

  let newMovementsCount = 0;
  if (steps.length > 0) {
    const { data: existing } = await supabase
      .from("movimentacoes")
      .select("judit_movement_id")
      .eq("processo_id", processo.id)
      .not("judit_movement_id", "is", null);

    const existingIds = new Set((existing || []).map((e: { judit_movement_id: string }) => e.judit_movement_id));

    const newMovs = steps
      .filter((s) => s.id && !existingIds.has(String(s.id)))
      .map((s) => ({
        processo_id: processo.id,
        data_movimentacao: s.date || s.data,
        tipo: s.type || s.tipo,
        descricao: s.content || s.description || s.descricao || "Movimentação",
        conteudo: s.content || s.descricao,
        judit_movement_id: String(s.id),
      }));

    if (newMovs.length > 0) {
      const { data: insertedMovements, error: movError } = await supabase
        .from("movimentacoes")
        .insert(newMovs)
        .select("id, descricao, judit_movement_id");
      if (movError) throw movError;

      // Emit domain event so process-domain-events worker dispatches WhatsApp to linked clients
      for (const mov of insertedMovements ?? []) {
        await supabase.from("domain_events").upsert(
          {
            tenant_id: mon.user_id,
            event_type: "PROCESS_MOVEMENT_DETECTED",
            dedupe_key: `${processo.id}:${mov.judit_movement_id ?? mov.id}`,
            payload: {
              processo_id: processo.id,
              movement_id: mov.id,
              resumo: mov.descricao,
              total_movimentacoes: newMovs.length,
            },
          },
          { onConflict: "tenant_id,event_type,dedupe_key", ignoreDuplicates: true },
        );
      }
      newMovementsCount = newMovs.length;
    }
  }

  syncResults.push({
    cnj: processo.numero_cnj,
    newMovements: newMovementsCount,
    domain_events_emitted: newMovementsCount,
  });

  await logTenantAction(supabase, {
    tenantId: mon.user_id,
    userId: userId || mon.user_id,
    action: "processo_sincronizado",
    entity: "processo",
    entityId: processo.id,
    metadata: {
      numero_cnj: processo.numero_cnj,
      novas_movimentacoes: newMovementsCount,
      domain_events_emitted: newMovementsCount,
      source: "sync-movements-event-driven",
    },
  });

  await supabase
    .from("processo_monitoramentos")
    .update({
      ultima_sync: new Date().toISOString(),
      judit_request_status: "done",
      judit_request_attempts: 0,
    })
    .eq("id", mon.id);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const JUDIT_API_KEY = Deno.env.get("JUDIT_API_KEY");
    if (!JUDIT_API_KEY) throw new Error("JUDIT_API_KEY not configured");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase: AnySupabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json().catch(() => ({}));
    const { processo_id } = body;

    const authHeader = req.headers.get("Authorization");
    let userId: string | null = null;
    if (authHeader) {
      const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY")!;
      const supabaseAuth = createClient(supabaseUrl, supabaseAnon, {
        global: { headers: { Authorization: authHeader } },
      });
      const {
        data: { user },
      } = await supabaseAuth.auth.getUser();
      userId = user?.id || null;
    }

    let query = supabase.from("processo_monitoramentos").select("*, processos(*)").eq("ativo", true);

    if (processo_id) {
      query = query.eq("processo_id", processo_id);
      if (userId) query = query.eq("user_id", userId);
    }

    const { data: monitoramentos, error: monError } = await query;
    if (monError) throw new Error(`Failed to fetch monitoramentos: ${monError.message}`);

    const syncResults: Array<Record<string, unknown>> = [];

    for (const mon of (monitoramentos || []) as MonitoramentoRow[]) {
      const processo = mon.processos;
      if (!processo?.numero_cnj) continue;

      try {
        if (mon.judit_request_id && mon.judit_request_status === "pending") {
          const requestId = mon.judit_request_id;
          const statusData = (await juditRequest({
            tenantKey: mon.user_id,
            apiKey: JUDIT_API_KEY,
            path: `/requests/${requestId}`,
          })) as { status?: string; request_status?: string };

          const resolvedStatus = statusData.status || statusData.request_status;
          if (resolvedStatus == "completed" || resolvedStatus == "done") {
            await collectCompletedRequest({
              supabase,
              mon,
              processo,
              requestId,
              userId,
              syncResults,
            });
            continue;
          }

          const nextAttempts = (mon.judit_request_attempts || 0) + 1;
          if (nextAttempts >= 3) {
            await supabase
              .from("processo_monitoramentos")
              .update({
                judit_request_status: "failed",
                judit_request_attempts: nextAttempts,
              })
              .eq("id", mon.id);
            syncResults.push({ cnj: processo.numero_cnj, status: "failed", requestId, attempts: nextAttempts });
          } else {
            await supabase
              .from("processo_monitoramentos")
              .update({ judit_request_attempts: nextAttempts })
              .eq("id", mon.id);
            syncResults.push({ cnj: processo.numero_cnj, status: "pending", requestId, attempts: nextAttempts });
          }
          continue;
        }

        const createData = (await juditRequest({
          tenantKey: mon.user_id,
          apiKey: JUDIT_API_KEY,
          path: "/requests",
          method: "POST",
          body: {
            search: {
              search_type: "lawsuit_cnj",
              search_key: processo.numero_cnj,
              response_type: "lawsuit",
            },
          },
        })) as { request_id?: string };

        const newRequestId = createData.request_id;
        await supabase
          .from("processo_monitoramentos")
          .update({
            judit_request_id: newRequestId,
            judit_request_status: "pending",
            judit_request_attempts: 0,
            judit_request_created_at: new Date().toISOString(),
          })
          .eq("id", mon.id);

        syncResults.push({ cnj: processo.numero_cnj, status: "requested", requestId: newRequestId });
      } catch {
        syncResults.push({ cnj: processo.numero_cnj, error: "sync_failed" });
      }
    }

    return new Response(JSON.stringify({ results: syncResults }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
