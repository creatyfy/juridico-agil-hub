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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const url = new URL(req.url)
    const action = url.searchParams.get('action')
    const { user, supabase } = await getUser(req)

    // Helper: get user's instance
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

    // Set webhook on existing instance
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

    // Fetch chats from Evolution API directly
    if (action === 'fetch-chats') {
      const instance = await getUserInstance()
      if (!instance) {
        return new Response(JSON.stringify({ conversations: [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      
      // Get chats from Evolution API - try multiple endpoints
      let chats: any[] = []
      
      // Try POST /chat/findChats first (v2 format)
      try {
        const evoRes = await fetch(`${EVOLUTION_API_URL}/chat/findChats/${instance.instance_name}`, {
          method: 'POST',
          headers: evoHeaders(),
          body: JSON.stringify({}),
        })
        const data = await evoRes.json()
        console.log('findChats response:', JSON.stringify(data).substring(0, 500))
        if (Array.isArray(data)) chats = data
      } catch (e) {
        console.error('findChats error:', e)
      }

      // If empty, try GET /chat/findContacts
      if (chats.length === 0) {
        try {
          const evoRes2 = await fetch(`${EVOLUTION_API_URL}/chat/findContacts/${instance.instance_name}`, {
            method: 'POST',
            headers: evoHeaders(),
            body: JSON.stringify({}),
          })
          const data2 = await evoRes2.json()
          console.log('findContacts response:', JSON.stringify(data2).substring(0, 500))
          if (Array.isArray(data2)) chats = data2
        } catch (e) {
          console.error('findContacts error:', e)
        }
      }

      if (!Array.isArray(chats) || chats.length === 0) {
        return new Response(JSON.stringify({ conversations: [], debug: 'no chats found from Evolution API' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      // Map chats to conversations format
      const conversations = chats
        .filter((c: any) => {
          const jid = c.remoteJid || c.id
          return jid && jid !== 'status@broadcast'
        })
        .map((c: any) => {
          const jid = c.remoteJid || c.id
          const isGroup = jid?.includes('@g.us')
          const lastMsg = c.lastMessage?.message?.conversation 
            || c.lastMessage?.message?.extendedTextMessage?.text
            || c.lastMsgContent || ''
          return {
            remote_jid: jid,
            nome: c.pushName || c.name || (isGroup ? jid : jid?.replace('@s.whatsapp.net', '')) || '',
            numero: isGroup ? '' : jid?.replace('@s.whatsapp.net', '') || '',
            foto_url: c.profilePicUrl || c.profilePictureUrl || null,
            last_message: lastMsg,
            last_timestamp: c.updatedAt || new Date().toISOString(),
            direcao: 'in',
            is_group: isGroup,
          }
        })

      return new Response(JSON.stringify({ conversations }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action === 'connect') {
      const instanceName = `jarvis_${user.id.substring(0, 8)}`
      
      // Step 1: Check if instance already exists on Evolution API
      let instanceExists = false
      try {
        const checkRes = await fetch(
          `${EVOLUTION_API_URL}/instance/connectionState/${instanceName}`,
          { headers: evoHeaders() }
        )
        if (checkRes.ok) {
          instanceExists = true
          console.log('Instance already exists, will try to connect directly')
        }
      } catch (_e) {
        // Instance doesn't exist
      }

      // Step 2: If instance exists, try to logout first then connect for fresh QR
      if (instanceExists) {
        try {
          await fetch(`${EVOLUTION_API_URL}/instance/logout/${instanceName}`, {
            method: 'DELETE',
            headers: evoHeaders(),
          })
          console.log('Logged out existing instance')
          await new Promise(r => setTimeout(r, 2000))
        } catch (_e) {
          console.log('Logout failed (may already be disconnected)')
        }
      }

      let qrBase64: string | null = null
      let qrCode: string | null = null
      let pairingCode: string | null = null
      let instanceId: string | null = null

      if (!instanceExists) {
        // Step 3a: Create new instance
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
        console.log('Create instance response:', JSON.stringify(evoData))
        instanceId = evoData.instance?.instanceId || null
        qrBase64 = evoData.qrcode?.base64 || null
        qrCode = evoData.code || evoData.qrcode?.code || null
        pairingCode = evoData.pairingCode || null
      }

      // Step 4: If no QR yet, call connect endpoint to get QR
      if (!qrCode && !qrBase64) {
        for (let attempt = 0; attempt < 5; attempt++) {
          await new Promise(r => setTimeout(r, 2000))
          try {
            const qrRes = await fetch(
              `${EVOLUTION_API_URL}/instance/connect/${instanceName}`,
              { headers: evoHeaders() }
            )
            const qrData = await qrRes.json()
            console.log(`Connect/QR attempt ${attempt + 1}:`, JSON.stringify(qrData))
            qrBase64 = qrData.base64 || null
            qrCode = qrData.code || null
            pairingCode = qrData.pairingCode || null
            if (qrCode || qrBase64) break
          } catch (e) {
            console.error('QR fetch error:', e)
          }
        }
      }

      // Step 5: Save instance in DB
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

      // Update local status
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
          body: JSON.stringify({
            number,
            text,
          }),
        }
      )
      const evoData = await evoRes.json()

      // Save outgoing message
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

    if (action === 'conversations') {
      const instance = await getUserInstance()
      if (!instance) {
        return new Response(JSON.stringify({ conversations: [] }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      // Get contacts
      const { data: contacts } = await supabase
        .from('whatsapp_contatos')
        .select('*')
        .eq('instancia_id', instance.id)

      // Get last message per contact
      const { data: messages } = await supabase
        .from('whatsapp_mensagens')
        .select('*')
        .eq('instancia_id', instance.id)
        .order('timestamp', { ascending: false })

      // Group by remote_jid and get last message
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
