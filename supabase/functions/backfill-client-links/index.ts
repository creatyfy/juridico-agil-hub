import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Missing authorization');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseAnon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const supabaseAuth = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } }
    });
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser();
    if (authError || !user) throw new Error('Unauthorized');

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get all processes for this user that have no client link
    const { data: processos, error: procError } = await supabase
      .from('processos')
      .select('id, partes, numero_cnj')
      .eq('user_id', user.id);

    if (procError) throw procError;

    // Get existing links
    const { data: existingLinks } = await supabase
      .from('cliente_processos')
      .select('processo_id')
      .eq('advogado_user_id', user.id);

    const linkedSet = new Set((existingLinks || []).map((l: any) => l.processo_id));
    const unlinked = (processos || []).filter((p: any) => !linkedSet.has(p.id));

    let created = 0;
    let linked = 0;
    let skipped = 0;

    for (const proc of unlinked) {
      const partes = Array.isArray(proc.partes) ? proc.partes : [];

      for (const parte of partes) {
        // Accept Active side, non-Advogado parties
        const isActive = parte.side === 'Active';
        const isAdvogado = (parte.person_type || '').toLowerCase().includes('advogado');
        if (!isActive || isAdvogado) continue;
        if (!parte.name) continue;

        // Get document from main_document or documents array
        let doc = parte.main_document || null;
        if (!doc && Array.isArray(parte.documents)) {
          const cpfDoc = parte.documents.find((d: any) =>
            d.document_type?.toUpperCase() === 'CPF' || d.document_type?.toUpperCase() === 'CNPJ'
          );
          if (cpfDoc) doc = cpfDoc.document;
        }
        if (!doc) continue;

        const cleanDoc = doc.replace(/\D/g, '');
        const tipoDoc = cleanDoc.length > 11 ? 'CNPJ' : 'CPF';
        const tipoPessoa = cleanDoc.length > 11 ? 'juridica' : 'fisica';

        // Upsert client
        const { data: cliente, error: clienteError } = await supabase
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
          console.error('Error upserting cliente:', clienteError);
          skipped++;
          continue;
        }

        if (cliente?.id) {
          created++;
          const { error: linkError } = await supabase
            .from('cliente_processos')
            .upsert({
              cliente_id: cliente.id,
              processo_id: proc.id,
              advogado_user_id: user.id,
              status: 'ativo',
              data_aceite: new Date().toISOString(),
            }, { onConflict: 'cliente_id,processo_id' });

          if (linkError) {
            console.error('Error linking:', linkError);
          } else {
            linked++;
          }
        }
      }
    }

    return new Response(JSON.stringify({
      total_unlinked: unlinked.length,
      clients_created: created,
      links_created: linked,
      skipped,
    }), {
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
