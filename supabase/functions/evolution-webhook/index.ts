import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const event = body.event
    const instanceName = body.instance

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Find the instance in DB
    const { data: instance } = await supabase
      .from('whatsapp_instancias')
      .select('*')
      .eq('instance_name', instanceName)
      .maybeSingle()

    if (!instance) {
      console.log('Instance not found:', instanceName)
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Handle connection update
    if (event === 'connection.update') {
      const state = body.data?.state
      const newStatus = state === 'open' ? 'connected' : state === 'connecting' ? 'connecting' : 'disconnected'
      
      await supabase
        .from('whatsapp_instancias')
        .update({ 
          status: newStatus,
          phone_number: body.data?.ownerJid?.replace('@s.whatsapp.net', '') || instance.phone_number,
        })
        .eq('id', instance.id)
    }

    // Handle incoming messages
    if (event === 'messages.upsert') {
      const messages = body.data || []
      
      for (const msg of messages) {
        if (!msg.key || !msg.message) continue
        
        const isFromMe = msg.key.fromMe || false
        const remoteJid = msg.key.remoteJid
        if (!remoteJid || remoteJid === 'status@broadcast') continue

        const content = msg.message?.conversation
          || msg.message?.extendedTextMessage?.text
          || msg.message?.imageMessage?.caption
          || '[mídia]'

        const messageType = msg.message?.conversation ? 'text'
          : msg.message?.extendedTextMessage ? 'text'
          : msg.message?.imageMessage ? 'image'
          : msg.message?.audioMessage ? 'audio'
          : msg.message?.videoMessage ? 'video'
          : msg.message?.documentMessage ? 'document'
          : 'other'

        // Upsert message (avoid duplicates)
        await supabase
          .from('whatsapp_mensagens')
          .upsert({
            instancia_id: instance.id,
            remote_jid: remoteJid,
            direcao: isFromMe ? 'out' : 'in',
            conteudo: content,
            tipo: messageType,
            message_id: msg.key.id,
            timestamp: msg.messageTimestamp
              ? new Date(Number(msg.messageTimestamp) * 1000).toISOString()
              : new Date().toISOString(),
          }, { onConflict: 'message_id', ignoreDuplicates: true })

        // Upsert contact
        const pushName = msg.pushName || null
        if (pushName && !remoteJid.includes('@g.us')) {
          await supabase
            .from('whatsapp_contatos')
            .upsert({
              instancia_id: instance.id,
              remote_jid: remoteJid,
              nome: pushName,
              numero: remoteJid.replace('@s.whatsapp.net', ''),
            }, { onConflict: 'instancia_id,remote_jid', ignoreDuplicates: false })
        }

        // Create notification for incoming messages
        if (!isFromMe) {
          await supabase.from('notificacoes').insert({
            user_id: instance.user_id,
            tipo: 'whatsapp',
            titulo: `Nova mensagem de ${pushName || remoteJid.replace('@s.whatsapp.net', '')}`,
            mensagem: content.substring(0, 100),
            link: '/atendimento',
          })
        }
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('Webhook error:', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
