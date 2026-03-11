import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getTenantCapabilities } from "../_shared/tenant-capabilities.ts";
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

      await logTenantAction(supabase, {
        tenantId: user.id,
        userId: user.id,
        action: 'processo_importado',
        entity: 'processo',
        entityId: processo.id,
        metadata: {
          numero_cnj: proc.numero_cnj,
          tribunal: proc.tribunal || null,
          source: 'import-processes',
        },
      });

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

      // Extract and upsert clientes from Active side parties + link via cliente_processos
      if (proc.partes && Array.isArray(proc.partes)) {
        for (const parte of proc.partes) {
          if (parte.side === 'Active' && parte.person_type !== 'Advogado' && parte.name) {
            const doc = parte.main_document || null;
            if (!doc) continue; // Skip parties without document
            const cleanDoc = doc.replace(/\D/g, '');
            const tipoDoc = cleanDoc.length > 11 ? 'CNPJ' : 'CPF';
            const tipoPessoa = cleanDoc.length > 11 ? 'juridica' : 'fisica';

            // Upsert client with minimal data (name + document)
            const { data: clienteUpserted, error: clienteError } = await supabase
              .from('clientes')
              .upsert({
                user_id: user.id,
                nome: parte.name,
                documento: doc,
                tipo_documento: tipoDoc,
                tipo_pessoa: tipoPessoa,
                status: 'cadastro_incompleto',
              }, { onConflict: 'user_id,documento', ignoreDuplicates: false })
              .select('id')
              .single();

            if (clienteError) {
              const planLimitReached = clienteError.message?.includes('plan_limit_reached') || clienteError.code === 'P0001';
              if (planLimitReached) {
                return new Response(JSON.stringify({ error: 'plan_limit_reached' }), {
                  status: 409,
                  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                });
              }
              console.error('Error upserting cliente:', clienteError);
              continue;
            }

            if (clienteUpserted?.id) {
              // Auto-link client to process via cliente_processos
              const { error: linkError } = await supabase
                .from('cliente_processos')
                .upsert({
                  cliente_id: clienteUpserted.id,
                  processo_id: processo.id,
                  advogado_user_id: user.id,
                  status: 'ativo',
                  data_aceite: new Date().toISOString(),
                }, { onConflict: 'cliente_id,processo_id' });

              if (linkError) {
                console.error('Error linking cliente to processo:', linkError);
              }

              await logTenantAction(supabase, {
                tenantId: user.id,
                userId: user.id,
                action: 'cadastro_created',
                entity: 'cliente',
                entityId: clienteUpserted.id,
                metadata: {
                  source: 'import_processes',
                  processo_numero_cnj: proc.numero_cnj,
                  nome: parte.name,
                  tipo_documento: tipoDoc,
                  auto_linked: true,
                },
              });
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
