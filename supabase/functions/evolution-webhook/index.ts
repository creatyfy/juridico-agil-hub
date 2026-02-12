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

    console.log('Webhook event:', event, 'instance:', instanceName)

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
    if (event === 'connection.update' || event === 'CONNECTION_UPDATE') {
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

    // Handle incoming messages - Evolution API v2 format
    if (event === 'messages.upsert' || event === 'MESSAGES_UPSERT') {
      // v2 sends data as array or single object, normalize
      let messages: any[] = []
      const data = body.data
      
      if (Array.isArray(data)) {
        messages = data
      } else if (data && typeof data === 'object') {
        // v2 may wrap in { messages: [...] } or send a single message
        if (Array.isArray(data.messages)) {
          messages = data.messages
        } else if (data.key) {
          // Single message object
          messages = [data]
        }
      }

      console.log('Processing', messages.length, 'messages')
      
      for (const msg of messages) {
        if (!msg.key) continue
        
        const isFromMe = msg.key.fromMe || false
        const remoteJid = msg.key.remoteJid
        if (!remoteJid || remoteJid === 'status@broadcast') continue

        const msgContent = msg.message || {}
        const content = msgContent.conversation
          || msgContent.extendedTextMessage?.text
          || msgContent.imageMessage?.caption
          || msgContent.videoMessage?.caption
          || msgContent.documentMessage?.fileName
          || null

        const messageType = msgContent.conversation ? 'text'
          : msgContent.extendedTextMessage ? 'text'
          : msgContent.imageMessage ? 'image'
          : msgContent.stickerMessage ? 'sticker'
          : msgContent.audioMessage ? 'audio'
          : msgContent.videoMessage ? 'video'
          : msgContent.documentMessage ? 'document'
          : msgContent.contactMessage ? 'contact'
          : msgContent.locationMessage ? 'location'
          : 'other'

        // Display text for non-text types
        const displayContent = content || (messageType === 'image' ? '📷 Imagem'
          : messageType === 'sticker' ? '🏷️ Figurinha'
          : messageType === 'audio' ? '🎤 Áudio'
          : messageType === 'video' ? '🎥 Vídeo'
          : messageType === 'document' ? '📎 Documento'
          : messageType === 'contact' ? '👤 Contato'
          : messageType === 'location' ? '📍 Localização'
          : '[mídia]')

        // Upsert message (avoid duplicates)
        const { error: msgError } = await supabase
          .from('whatsapp_mensagens')
          .upsert({
            instancia_id: instance.id,
            remote_jid: remoteJid,
            direcao: isFromMe ? 'out' : 'in',
            conteudo: displayContent,
            tipo: messageType,
            message_id: msg.key.id,
            timestamp: msg.messageTimestamp
              ? new Date(Number(msg.messageTimestamp) * 1000).toISOString()
              : new Date().toISOString(),
          }, { onConflict: 'message_id', ignoreDuplicates: true })

        if (msgError) console.error('Message upsert error:', msgError)

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

        // Create notification for incoming messages (limit to avoid spam)
        if (!isFromMe && messageType !== 'other') {
          await supabase.from('notificacoes').insert({
            user_id: instance.user_id,
            tipo: 'whatsapp',
            titulo: `Nova mensagem de ${pushName || remoteJid.replace('@s.whatsapp.net', '')}`,
            mensagem: displayContent.substring(0, 100),
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
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
