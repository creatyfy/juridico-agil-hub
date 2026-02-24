import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getTenantCapabilities } from "../_shared/tenant-capabilities.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Missing authorization');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabaseAnon = Deno.env.get('SUPABASE_ANON_KEY')!;

    // Auth check with anon key
    const supabaseAuth = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } }
    });
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) throw new Error('Unauthorized');

    // Use service role for inserts (bypass RLS for batch operations, but scoped to user)
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { processos } = await req.json();
    if (!processos || !Array.isArray(processos) || processos.length === 0) {
      throw new Error('No processes provided');
    }

    const capabilities = await getTenantCapabilities(supabase, user.id);
    const results = [];

    for (const proc of processos) {
      // Insert processo
      const { data: processo, error: procError } = await supabase
        .from('processos')
        .upsert({
          user_id: user.id,
          numero_cnj: proc.numero_cnj,
          tribunal: proc.tribunal,
          vara: proc.vara,
          classe: proc.classe,
          assunto: proc.assunto,
          partes: proc.partes || [],
          status: proc.status || 'ativo',
          data_distribuicao: proc.data_distribuicao,
          judit_process_id: proc.judit_process_id,
          fonte: proc.fonte || 'judit',
        }, { onConflict: 'user_id,numero_cnj' })
        .select()
        .single();

      if (procError) {
        console.error('Error inserting processo:', procError);
        results.push({ numero_cnj: proc.numero_cnj, error: procError.message });
        continue;
      }

      // Create monitoring entry
      await supabase
        .from('processo_monitoramentos')
        .upsert({
          processo_id: processo.id,
          user_id: user.id,
          ativo: true,
          ultima_sync: new Date().toISOString(),
        }, { onConflict: 'processo_id' });

      // Insert movimentacoes if provided
      if (proc.movimentacoes && Array.isArray(proc.movimentacoes)) {
        const movs = proc.movimentacoes.map((m: any) => ({
          processo_id: processo.id,
          data_movimentacao: m.data_movimentacao || m.date,
          tipo: m.tipo || m.type,
          descricao: m.descricao || m.description || m.content || 'Movimentação',
          conteudo: m.conteudo || m.content,
          judit_movement_id: m.id || m.judit_movement_id,
        }));

        if (movs.length > 0) {
          const { error: movError } = await supabase
            .from('movimentacoes')
            .insert(movs);
          if (movError) console.error('Error inserting movimentacoes:', movError);
        }
      }

      // Extract and upsert clientes from Active side parties
      if (proc.partes && Array.isArray(proc.partes)) {
        for (const parte of proc.partes) {
          if (parte.side === 'Active' && parte.person_type !== 'Advogado' && parte.name) {
            const doc = parte.main_document || null;
            const tipoDoc = doc && doc.length > 14 ? 'CNPJ' : 'CPF';
            const tipoPessoa = doc && doc.length > 14 ? 'juridica' : 'fisica';
            const { error: clienteError } = await supabase
              .from('clientes')
              .upsert({
                tenant_id: user.id,
                user_id: user.id,
                nome: parte.name,
                documento: doc,
                cpf: tipoDoc === 'CPF' && doc ? doc.replace(/\D/g, '') : null,
                tipo_documento: tipoDoc,
                tipo_pessoa: tipoPessoa,
              }, { onConflict: 'user_id,documento' });

            if (clienteError) {
              const planLimitReached = clienteError.message?.includes('plan_limit_reached') || clienteError.code === 'P0001';
              if (planLimitReached) {
                return new Response(JSON.stringify({ error: 'plan_limit_reached' }), {
                  status: 409,
                  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                });
              }
              console.error('Error upserting cliente:', clienteError);
            }
          }
        }
      }

      results.push({ numero_cnj: proc.numero_cnj, id: processo.id, success: true });
    }

    return new Response(JSON.stringify({ results, capabilities }), {
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
