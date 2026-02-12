import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const EVOLUTION_API_URL = Deno.env.get('EVOLUTION_API_URL')!
const EVOLUTION_API_KEY = Deno.env.get('EVOLUTION_API_KEY')!

function evoHeaders() {
  return {
    'Content-Type': 'application/json',
    'apikey': EVOLUTION_API_KEY,
  }
}

async function getUser(req: Request) {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: req.headers.get('Authorization')! } } }
  )
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error || !user) throw new Error('Unauthorized')
  return { user, supabase }
}

function getServiceSupabase() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const url = new URL(req.url)
    const action = url.searchParams.get('action')
    const { user, supabase } = await getUser(req)

    async function getUserInstance() {
      const { data } = await supabase
        .from('whatsapp_instancias')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
      return data
    }

    // ─── SET WEBHOOK ───
    if (action === 'set-webhook') {
      const instance = await getUserInstance()
      if (!instance) {
        return new Response(JSON.stringify({ error: 'No instance' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const webhookUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/evolution-webhook`
      const evoRes = await fetch(`${EVOLUTION_API_URL}/webhook/set/${instance.instance_name}`, {
        method: 'POST',
        headers: evoHeaders(),
        body: JSON.stringify({
          webhook: {
            enabled: true,
            url: webhookUrl,
            webhookByEvents: false,
            webhookBase64: false,
            events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'],
          }
        }),
      })
      const evoData = await evoRes.json()
      console.log('Set webhook response:', JSON.stringify(evoData))
      return new Response(JSON.stringify({ success: true, data: evoData }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ─── FETCH CHATS ───
    if (action === 'fetch-chats') {
      const instance = await getUserInstance()
      if (!instance) {
        return new Response(JSON.stringify({ conversations: [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      // Step 1: Get chats from findChats
      let chats: any[] = []
      try {
        const evoRes = await fetch(`${EVOLUTION_API_URL}/chat/findChats/${instance.instance_name}`, {
          method: 'POST',
          headers: evoHeaders(),
          body: JSON.stringify({}),
        })
        const data = await evoRes.json()
        console.log('findChats count:', Array.isArray(data) ? data.length : 'not array')
        // Log first 3 chat objects to understand structure
        if (Array.isArray(data) && data.length > 0) {
          console.log('Sample chat[0]:', JSON.stringify(data[0]).substring(0, 500))
          if (data.length > 1) console.log('Sample chat[1]:', JSON.stringify(data[1]).substring(0, 500))
        }
        if (Array.isArray(data)) chats = data
      } catch (e) {
        console.error('findChats error:', e)
      }

      // Step 2: Build contacts map from multiple sources
      const contactsMap = new Map<string, any>()
      
      // Source 1: DB contacts first (our persisted data)
      const svc = getServiceSupabase()
      const { data: dbContacts } = await svc
        .from('whatsapp_contatos')
        .select('*')
        .eq('instancia_id', instance.id)
      if (dbContacts) {
        for (const c of dbContacts) {
          if (c.nome) {
            contactsMap.set(c.remote_jid, { name: c.nome, profilePictureUrl: c.foto_url })
          }
        }
        console.log('DB contacts loaded:', dbContacts.length)
      }

      // Source 2: Extract names from ALL chat objects
      for (const c of chats) {
        const jid = c.remoteJid || c.id
        if (!jid || jid === 'status@broadcast') continue
        
        // Collect all possible name fields from the chat object
        const notify = c.notify || c.notifyName  // WhatsApp "notify" name
        const pushName = c.pushName
        const subject = c.subject || c.groupMetadata?.subject
        const chatName = c.name || c.formattedName
        const lastMsgPushName = c.lastMessage?.pushName
        
        const bestName = chatName || notify || pushName || subject || lastMsgPushName
        
        if (bestName && !contactsMap.has(jid)) {
          contactsMap.set(jid, { name: bestName, pushName: pushName || notify })
        }
      }

      // Source 3: Try Evolution API findContacts (may return names from phone's contact list)
      try {
        const res = await fetch(`${EVOLUTION_API_URL}/chat/findContacts/${instance.instance_name}`, {
          method: 'POST',
          headers: evoHeaders(),
          body: JSON.stringify({}),
        })
        const data = await res.json()
        const contacts = Array.isArray(data) ? data : Array.isArray(data?.contacts) ? data.contacts : []
        console.log('findContacts count:', contacts.length)
        for (const c of contacts) {
          const jid = c.remoteJid || c.id
          if (!jid) continue
          const apiName = c.name || c.pushName || c.formattedName || c.notify
          if (apiName) {
            // API contact names override chat-extracted names (they may be phone contact names)
            contactsMap.set(jid, { ...contactsMap.get(jid), name: apiName })
          }
        }
      } catch (e) {
        console.error('findContacts error:', e)
      }

      console.log('Total contacts resolved:', contactsMap.size)

      if (chats.length === 0) {
        return new Response(JSON.stringify({ conversations: [], debug: 'no chats found' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      // Step 3: Fetch profile pictures (including groups, up to 50)
      const jidsToFetchPic = chats
        .map((c: any) => c.remoteJid || c.id)
        .filter((jid: string) => jid && jid !== 'status@broadcast')
        .slice(0, 50)

      const profilePics = new Map<string, string>()
      const picBatches = []
      for (let i = 0; i < jidsToFetchPic.length; i += 10) {
        picBatches.push(jidsToFetchPic.slice(i, i + 10))
      }
      
      for (const batch of picBatches) {
        await Promise.all(batch.map(async (jid: string) => {
          try {
            const number = jid.replace('@s.whatsapp.net', '').replace('@g.us', '').replace('@lid', '')
            const picRes = await fetch(`${EVOLUTION_API_URL}/chat/fetchProfilePictureUrl/${instance.instance_name}`, {
              method: 'POST',
              headers: evoHeaders(),
              body: JSON.stringify({ number: jid }),
            })
            const picData = await picRes.json()
            const picUrl = picData?.profilePictureUrl || picData?.picture || picData?.imgUrl
            if (picUrl) {
              profilePics.set(jid, picUrl)
            }
          } catch (_) {}
        }))
      }
      console.log('Profile pics fetched:', profilePics.size)

      // Step 4: Map to conversations
      const conversations = chats
        .filter((c: any) => {
          const jid = c.remoteJid || c.id
          return jid && jid !== 'status@broadcast'
        })
        .map((c: any) => {
          const jid = c.remoteJid || c.id
          const isGroup = jid?.includes('@g.us')
          const contact = contactsMap.get(jid)

          // Last message extraction
          const lastMsgObj = c.lastMessage?.message || {}
          const lastMsg = lastMsgObj.conversation
            || lastMsgObj.extendedTextMessage?.text
            || lastMsgObj.imageMessage?.caption
            || lastMsgObj.videoMessage?.caption
            || lastMsgObj.documentMessage?.fileName
            || c.lastMsgContent || ''
          const stickerMsg = lastMsgObj.stickerMessage ? '🏷️ Figurinha' : null
          const imageMsg = lastMsgObj.imageMessage && !lastMsg ? '📷 Imagem' : null
          const audioMsg = lastMsgObj.audioMessage ? '🎤 Áudio' : null
          const videoMsg = lastMsgObj.videoMessage && !lastMsg ? '🎥 Vídeo' : null
          const docMsg = lastMsgObj.documentMessage && !lastMsg ? '📎 Documento' : null
          const displayMsg = lastMsg || stickerMsg || imageMsg || audioMsg || videoMsg || docMsg || ''

          // Name resolution: use the best available name from our contacts map
          const resolvedName = contact?.name || contact?.pushName
          const chatName = c.name || c.notify || c.notifyName || c.pushName || c.subject || c.groupMetadata?.subject
          const lastMsgPushName = !isGroup ? c.lastMessage?.pushName : null
          
          // Format phone number for display when no name is available
          const rawNumber = jid?.replace('@s.whatsapp.net', '').replace('@lid', '') || ''
          const formattedNumber = rawNumber.length >= 12 && rawNumber.startsWith('55')
            ? `+${rawNumber.substring(0, 2)} (${rawNumber.substring(2, 4)}) ${rawNumber.substring(4, rawNumber.length - 4)}-${rawNumber.substring(rawNumber.length - 4)}`
            : rawNumber
          
          const displayName = resolvedName || chatName || lastMsgPushName || (isGroup ? jid : formattedNumber) || ''

          return {
            remote_jid: jid,
            nome: displayName,
            numero: isGroup ? '' : jid?.replace('@s.whatsapp.net', '').replace('@lid', '') || '',
            foto_url: profilePics.get(jid) || c.profilePicUrl || c.profilePictureUrl || contact?.profilePictureUrl || null,
            last_message: displayMsg,
            last_timestamp: c.updatedAt || c.lastMessage?.messageTimestamp 
              ? new Date((c.lastMessage?.messageTimestamp || 0) * 1000).toISOString()
              : new Date().toISOString(),
            direcao: c.lastMessage?.key?.fromMe ? 'out' : 'in',
            is_group: isGroup,
          }
        })

      conversations.sort((a: any, b: any) => new Date(b.last_timestamp).getTime() - new Date(a.last_timestamp).getTime())

      // Save resolved contact names to DB for future use (fire and forget)
      const contactsToSave = conversations
        .filter((c: any) => !c.is_group && c.nome && c.nome !== c.numero && c.numero)
        .map((c: any) => ({
          instancia_id: instance.id,
          remote_jid: c.remote_jid,
          nome: c.nome,
          numero: c.numero,
          foto_url: c.foto_url,
        }))
      if (contactsToSave.length > 0) {
        svc.from('whatsapp_contatos')
          .upsert(contactsToSave, { onConflict: 'instancia_id,remote_jid' })
          .then(({ error }: any) => { if (error) console.error('Save contacts error:', error) })
      }

      return new Response(JSON.stringify({ conversations }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ─── FETCH MESSAGES FROM EVOLUTION API ───
    if (action === 'fetch-messages') {
      const instance = await getUserInstance()
      if (!instance) {
        return new Response(JSON.stringify({ messages: [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const remoteJid = url.searchParams.get('remoteJid')
      if (!remoteJid) {
        return new Response(JSON.stringify({ messages: [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      // Try to get messages from Evolution API
      let apiMessages: any[] = []
      try {
        const evoRes = await fetch(`${EVOLUTION_API_URL}/chat/findMessages/${instance.instance_name}`, {
          method: 'POST',
          headers: evoHeaders(),
          body: JSON.stringify({
            where: { key: { remoteJid } },
            limit: 100,
          }),
        })
        const data = await evoRes.json()
        console.log('findMessages response type:', typeof data, Array.isArray(data) ? data.length : '')
        if (Array.isArray(data?.messages)) {
          apiMessages = data.messages
        } else if (Array.isArray(data)) {
          apiMessages = data
        }
      } catch (e) {
        console.error('findMessages error:', e)
      }

      if (apiMessages.length > 0) {
        const messages = apiMessages.map((msg: any) => {
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
            : 'other'

          const displayContent = content || (messageType === 'image' ? '📷 Imagem'
            : messageType === 'sticker' ? '🏷️ Figurinha'
            : messageType === 'audio' ? '🎤 Áudio'
            : messageType === 'video' ? '🎥 Vídeo'
            : messageType === 'document' ? '📎 Documento'
            : '[mídia]')

          return {
            id: msg.key?.id || msg.id || crypto.randomUUID(),
            remote_jid: remoteJid,
            direcao: msg.key?.fromMe ? 'out' : 'in',
            conteudo: displayContent,
            tipo: messageType,
            timestamp: msg.messageTimestamp
              ? new Date(Number(msg.messageTimestamp) * 1000).toISOString()
              : msg.createdAt || new Date().toISOString(),
            message_id: msg.key?.id || crypto.randomUUID(),
          }
        })

        // Sort oldest first
        messages.sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

        // Persist messages to DB (fire and forget) so realtime and history work
        const svcMsg = getServiceSupabase()
        const toSave = messages.map((m: any) => ({
          instancia_id: instance.id,
          remote_jid: m.remote_jid,
          direcao: m.direcao,
          conteudo: m.conteudo,
          tipo: m.tipo,
          timestamp: m.timestamp,
          message_id: m.message_id,
        }))
        svcMsg.from('whatsapp_mensagens')
          .upsert(toSave, { onConflict: 'message_id', ignoreDuplicates: true })
          .then(({ error }: any) => { if (error) console.error('Persist messages error:', error) })

        return new Response(JSON.stringify({ messages }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      // Fallback: get from DB
      const { data: dbMessages } = await supabase
        .from('whatsapp_mensagens')
        .select('*')
        .eq('instancia_id', instance.id)
        .eq('remote_jid', remoteJid)
        .order('timestamp', { ascending: true })
        .limit(200)

      return new Response(JSON.stringify({ messages: dbMessages || [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ─── CONNECT ───
    if (action === 'connect') {
      const instanceName = `jarvis_${user.id.substring(0, 8)}`
      
      let instanceExists = false
      try {
        const checkRes = await fetch(
          `${EVOLUTION_API_URL}/instance/connectionState/${instanceName}`,
          { headers: evoHeaders() }
        )
        if (checkRes.ok) {
          instanceExists = true
        }
      } catch (_e) {}

      if (instanceExists) {
        try {
          await fetch(`${EVOLUTION_API_URL}/instance/logout/${instanceName}`, {
            method: 'DELETE',
            headers: evoHeaders(),
          })
          await new Promise(r => setTimeout(r, 2000))
        } catch (_e) {}
      }

      let qrBase64: string | null = null
      let qrCode: string | null = null
      let pairingCode: string | null = null
      let instanceId: string | null = null

      if (!instanceExists) {
        const evoRes = await fetch(`${EVOLUTION_API_URL}/instance/create`, {
          method: 'POST',
          headers: evoHeaders(),
          body: JSON.stringify({
            instanceName,
            qrcode: true,
            integration: 'WHATSAPP-BAILEYS',
            webhook: {
              url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/evolution-webhook`,
              byEvents: false,
              base64: false,
              headers: { 'apikey': EVOLUTION_API_KEY },
              events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'],
            },
          }),
        })
        const evoData = await evoRes.json()
        instanceId = evoData.instance?.instanceId || null
        qrBase64 = evoData.qrcode?.base64 || null
        qrCode = evoData.code || evoData.qrcode?.code || null
        pairingCode = evoData.pairingCode || null
      }

      if (!qrCode && !qrBase64) {
        for (let attempt = 0; attempt < 5; attempt++) {
          await new Promise(r => setTimeout(r, 2000))
          try {
            const qrRes = await fetch(
              `${EVOLUTION_API_URL}/instance/connect/${instanceName}`,
              { headers: evoHeaders() }
            )
            const qrData = await qrRes.json()
            qrBase64 = qrData.base64 || null
            qrCode = qrData.code || null
            pairingCode = qrData.pairingCode || null
            if (qrCode || qrBase64) break
          } catch (e) {
            console.error('QR fetch error:', e)
          }
        }
      }

      const { data: existing } = await supabase
        .from('whatsapp_instancias')
        .select('id')
        .eq('user_id', user.id)
        .eq('instance_name', instanceName)
        .maybeSingle()

      if (existing) {
        await supabase
          .from('whatsapp_instancias')
          .update({ status: 'connecting', instance_id: instanceId })
          .eq('id', existing.id)
      } else {
        await supabase
          .from('whatsapp_instancias')
          .insert({
            user_id: user.id,
            instance_name: instanceName,
            instance_id: instanceId,
            status: 'connecting',
          })
      }

      return new Response(JSON.stringify({
        qrcode: { base64: qrBase64, code: qrCode, pairingCode },
        instance: instanceName,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ─── STATUS ───
    if (action === 'status') {
      const instance = await getUserInstance()
      if (!instance) {
        return new Response(JSON.stringify({ status: 'not_found' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const evoRes = await fetch(
        `${EVOLUTION_API_URL}/instance/connectionState/${instance.instance_name}`,
        { headers: evoHeaders() }
      )
      const evoData = await evoRes.json()
      const state = evoData.instance?.state || 'close'

      const newStatus = state === 'open' ? 'connected' : state === 'connecting' ? 'connecting' : 'disconnected'
      await supabase
        .from('whatsapp_instancias')
        .update({ status: newStatus })
        .eq('id', instance.id)

      return new Response(JSON.stringify({
        status: newStatus,
        instance: instance.instance_name,
        phone: instance.phone_number,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ─── QRCODE ───
    if (action === 'qrcode') {
      const instance = await getUserInstance()
      if (!instance) {
        return new Response(JSON.stringify({ error: 'No instance' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const evoRes = await fetch(
        `${EVOLUTION_API_URL}/instance/connect/${instance.instance_name}`,
        { headers: evoHeaders() }
      )
      const evoData = await evoRes.json()

      return new Response(JSON.stringify({
        qrcode: evoData.base64 || evoData.qrcode?.base64 || null,
        code: evoData.code || evoData.qrcode?.code || null,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ─── SEND ───
    if (action === 'send') {
      const instance = await getUserInstance()
      if (!instance) {
        return new Response(JSON.stringify({ error: 'No instance' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const body = await req.json()
      const { number, text } = body

      const evoRes = await fetch(
        `${EVOLUTION_API_URL}/message/sendText/${instance.instance_name}`,
        {
          method: 'POST',
          headers: evoHeaders(),
          body: JSON.stringify({ number, text }),
        }
      )
      const evoData = await evoRes.json()

      await supabase.from('whatsapp_mensagens').insert({
        instancia_id: instance.id,
        remote_jid: number.includes('@') ? number : `${number}@s.whatsapp.net`,
        direcao: 'out',
        conteudo: text,
        tipo: 'text',
        message_id: evoData.key?.id || null,
      })

      return new Response(JSON.stringify({ success: true, data: evoData }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ─── MESSAGES (DB) ───
    if (action === 'messages') {
      const instance = await getUserInstance()
      if (!instance) {
        return new Response(JSON.stringify({ messages: [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const remoteJid = url.searchParams.get('remoteJid')

      let query = supabase
        .from('whatsapp_mensagens')
        .select('*')
        .eq('instancia_id', instance.id)
        .order('timestamp', { ascending: true })

      if (remoteJid) {
        query = query.eq('remote_jid', remoteJid)
      }

      const { data: messages } = await query.limit(200)

      return new Response(JSON.stringify({ messages: messages || [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ─── CONVERSATIONS (DB fallback) ───
    if (action === 'conversations') {
      const instance = await getUserInstance()
      if (!instance) {
        return new Response(JSON.stringify({ conversations: [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data: contacts } = await supabase
        .from('whatsapp_contatos')
        .select('*')
        .eq('instancia_id', instance.id)

      const { data: messages } = await supabase
        .from('whatsapp_mensagens')
        .select('*')
        .eq('instancia_id', instance.id)
        .order('timestamp', { ascending: false })

      const lastMessages = new Map<string, any>()
      for (const msg of messages || []) {
        if (!lastMessages.has(msg.remote_jid)) {
          lastMessages.set(msg.remote_jid, msg)
        }
      }

      const contactMap = new Map<string, any>()
      for (const c of contacts || []) {
        contactMap.set(c.remote_jid, c)
      }

      const conversations = Array.from(lastMessages.entries()).map(([jid, msg]) => ({
        remote_jid: jid,
        nome: contactMap.get(jid)?.nome || jid.replace('@s.whatsapp.net', ''),
        numero: contactMap.get(jid)?.numero || jid.replace('@s.whatsapp.net', ''),
        foto_url: contactMap.get(jid)?.foto_url || null,
        last_message: msg.conteudo,
        last_timestamp: msg.timestamp,
        direcao: msg.direcao,
      }))

      conversations.sort((a, b) => new Date(b.last_timestamp).getTime() - new Date(a.last_timestamp).getTime())

      return new Response(JSON.stringify({ conversations }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ─── DISCONNECT ───
    if (action === 'disconnect') {
      const instance = await getUserInstance()
      if (!instance) {
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      await fetch(
        `${EVOLUTION_API_URL}/instance/logout/${instance.instance_name}`,
        { method: 'DELETE', headers: evoHeaders() }
      )

      await supabase
        .from('whatsapp_instancias')
        .update({ status: 'disconnected' })
        .eq('id', instance.id)

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
