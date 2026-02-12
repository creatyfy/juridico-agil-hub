import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const EVOLUTION_API_URL = Deno.env.get('EVOLUTION_API_URL')!;
const EVOLUTION_API_KEY = Deno.env.get('EVOLUTION_API_KEY')!;

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authenticate user
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
    );
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Não autorizado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { processo_id, mensagem_personalizada } = await req.json();

    if (!processo_id) {
      return new Response(JSON.stringify({ error: 'processo_id é obrigatório' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify the process belongs to this user
    const { data: processo, error: procErr } = await svc
      .from('processos')
      .select('id, numero_cnj, classe, vara, tribunal')
      .eq('id', processo_id)
      .eq('user_id', user.id)
      .single();

    if (procErr || !processo) {
      return new Response(JSON.stringify({ error: 'Processo não encontrado' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Find linked clients with active WhatsApp
    const { data: vinculos } = await svc
      .from('cliente_processos')
      .select('cliente_id, clientes(id, nome, numero_whatsapp, status_vinculo)')
      .eq('processo_id', processo_id)
      .eq('advogado_user_id', user.id)
      .eq('status', 'ativo');

    const clientesAtivos = (vinculos || [])
      .map((v: any) => v.clientes)
      .filter((c: any) => c && c.status_vinculo === 'ativo' && c.numero_whatsapp);

    if (clientesAtivos.length === 0) {
      return new Response(JSON.stringify({ 
        error: 'Nenhum cliente vinculado com WhatsApp ativo para este processo' 
      }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get user's WhatsApp instance
    const { data: instance } = await supabase
      .from('whatsapp_instancias')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'connected')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (!instance) {
      return new Response(JSON.stringify({ error: 'WhatsApp não conectado' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Build message
    const defaultMsg = `📋 *Atualização Processual*\n\n` +
      `Olá! Informamos que houve uma nova movimentação no seu processo:\n\n` +
      `📌 *Processo:* ${processo.numero_cnj}\n` +
      `⚖️ *Classe:* ${processo.classe || 'N/A'}\n` +
      `🏛️ *Vara:* ${processo.vara || 'N/A'}\n` +
      `🏢 *Tribunal:* ${processo.tribunal || 'N/A'}\n\n` +
      `${mensagem_personalizada ? `📝 *Detalhes:* ${mensagem_personalizada}\n\n` : ''}` +
      `Para mais informações, entre em contato com seu advogado.\n\n` +
      `_Mensagem automática - Jarvis Jud_`;

    const results: any[] = [];

    for (const cliente of clientesAtivos) {
      const number = cliente.numero_whatsapp.startsWith('55') 
        ? cliente.numero_whatsapp 
        : `55${cliente.numero_whatsapp}`;

      try {
        // Send via Evolution API
        const evoRes = await fetch(
          `${EVOLUTION_API_URL}/message/sendText/${instance.instance_name}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_API_KEY },
            body: JSON.stringify({ number, text: defaultMsg }),
          }
        );
        const evoData = await evoRes.json();

        const remoteJid = `${number}@s.whatsapp.net`;

        // Save message to DB
        await svc.from('whatsapp_mensagens').insert({
          instancia_id: instance.id,
          remote_jid: remoteJid,
          direcao: 'out',
          conteudo: defaultMsg,
          tipo: 'text',
          message_id: evoData.key?.id || crypto.randomUUID(),
        });

        // Update chat cache
        await svc.from('whatsapp_chats_cache').upsert({
          instancia_id: instance.id,
          remote_jid: remoteJid,
          ultima_mensagem: defaultMsg.substring(0, 100),
          ultimo_timestamp: new Date().toISOString(),
          direcao: 'out',
        }, { onConflict: 'instancia_id,remote_jid', ignoreDuplicates: false });

        // Create notification for the lawyer
        await svc.from('notificacoes').insert({
          user_id: user.id,
          tipo: 'sistema',
          titulo: `Atualização enviada para ${cliente.nome}`,
          mensagem: `Notificação processual enviada via WhatsApp para ${cliente.nome} (processo ${processo.numero_cnj})`,
          link: `/processos/${processo.id}`,
        });

        results.push({ cliente: cliente.nome, numero: number, status: 'enviado' });
        console.log(`Message sent to ${cliente.nome} (${number})`);
      } catch (e) {
        console.error(`Failed to send to ${cliente.nome}:`, e);
        results.push({ cliente: cliente.nome, numero: number, status: 'erro', error: e.message });
      }
    }

    return new Response(JSON.stringify({ 
      success: true, 
      processo: processo.numero_cnj,
      enviados: results.filter(r => r.status === 'enviado').length,
      total: results.length,
      detalhes: results,
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error('Error:', error);
    return new Response(JSON.stringify({ error: error.message || 'Erro interno' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
