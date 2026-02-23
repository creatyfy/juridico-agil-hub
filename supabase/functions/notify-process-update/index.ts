import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.25.76";
import { buildIdempotencyKey, type OutboxPayload } from "../_shared/outbox.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const notifySchema = z.object({
  processo_id: z.string().uuid(),
  mensagem_personalizada: z.string().max(1000).optional(),
})

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
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
    const parsed = notifySchema.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: parsed.error.flatten() }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const { processo_id, mensagem_personalizada } = parsed.data;

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

    const messageBody = `📋 *Atualização Processual*\n\n` +
      `Olá! Informamos que houve uma nova movimentação no seu processo:\n\n` +
      `📌 *Processo:* ${processo.numero_cnj}\n` +
      `⚖️ *Classe:* ${processo.classe || 'N/A'}\n` +
      `🏛️ *Vara:* ${processo.vara || 'N/A'}\n` +
      `🏢 *Tribunal:* ${processo.tribunal || 'N/A'}\n\n` +
      `${mensagem_personalizada ? `📝 *Detalhes:* ${mensagem_personalizada}\n\n` : ''}` +
      `Para mais informações, entre em contato com seu advogado.\n\n` +
      `_Mensagem automática - Jarvis Jud_`;

    const enqueued: Array<{ cliente: string; status: string }> = []

    for (const cliente of clientesAtivos) {
      const number = cliente.numero_whatsapp.startsWith('55')
        ? cliente.numero_whatsapp
        : `55${cliente.numero_whatsapp}`;

      const idempotencyKey = await buildIdempotencyKey({
        tenantId: user.id,
        event: 'process_update',
        destination: number,
        reference: `${processo.id}:${mensagem_personalizada ?? ''}`,
      })

      const payload: OutboxPayload = {
        kind: 'process_update',
        processoId: processo.id,
        processoNumero: processo.numero_cnj,
        clienteNome: cliente.nome,
        destinationNumber: number,
        messageText: messageBody,
        instanceName: instance.instance_name,
        instanceId: instance.id,
        userId: user.id,
      }

      const { error: enqueueError } = await svc.from('message_outbox').upsert({
        tenant_id: user.id,
        aggregate_type: 'processo',
        aggregate_id: processo.id,
        idempotency_key: idempotencyKey,
        payload,
        status: 'pending',
      }, { onConflict: 'tenant_id,idempotency_key', ignoreDuplicates: true })

      if (enqueueError) {
        console.error('erro ao enfileirar', enqueueError)
        enqueued.push({ cliente: cliente.nome, status: 'erro' })
        continue
      }

      await svc.from('notificacoes').insert({
        user_id: user.id,
        tipo: 'sistema',
        titulo: `Envio enfileirado para ${cliente.nome}`,
        mensagem: `Atualização processual enfileirada para envio via worker (processo ${processo.numero_cnj}).`,
        link: `/processos/${processo.id}`,
      })

      enqueued.push({ cliente: cliente.nome, status: 'enfileirado' })
    }

    return new Response(JSON.stringify({
      success: true,
      processo: processo.numero_cnj,
      enfileirados: enqueued.filter((r) => r.status === 'enfileirado').length,
      total: enqueued.length,
      detalhes: enqueued,
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
