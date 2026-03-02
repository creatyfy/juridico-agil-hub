import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { enqueueMessage } from '../_shared/message-outbox-enqueue.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const EVOLUTION_API_URL = Deno.env.get('EVOLUTION_API_URL')!
const EVOLUTION_API_KEY = Deno.env.get('EVOLUTION_API_KEY')!

function evoHeaders() {
  return { 'Content-Type': 'application/json', 'apikey': EVOLUTION_API_KEY }
}

async function parseEvolutionError(res: Response): Promise<string> {
  const raw = await res.text()
  if (!raw) return `Evolution returned ${res.status}`

  try {
    const parsed = JSON.parse(raw)
    return parsed?.response?.message
      || parsed?.error
      || parsed?.message
      || parsed?.reason
      || raw
  } catch {
    return raw
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
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
}

// Format BR phone number for display
function formatPhone(raw: string): string {
  if (raw.length >= 12 && raw.startsWith('55')) {
    return `+${raw.substring(0, 2)} (${raw.substring(2, 4)}) ${raw.substring(4, raw.length - 4)}-${raw.substring(raw.length - 4)}`
  }
  return raw
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

    // ─── FULL SYNC ───
    // Called once per session after connection. Syncs contacts, chats, photos.
    if (action === 'full-sync') {
      const instance = await getUserInstance()
      if (!instance) {
        return new Response(JSON.stringify({ ok: false, error: 'No instance' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const svc = getServiceSupabase()
      const instanceName = instance.instance_name
      const instanceId = instance.id

      // ── Step 1: Fetch contacts from Evolution API ──
      let apiContacts: any[] = []
      try {
        const res = await fetch(`${EVOLUTION_API_URL}/chat/findContacts/${instanceName}`, {
          method: 'POST', headers: evoHeaders(), body: JSON.stringify({}),
        })
        const data = await res.json()
        apiContacts = Array.isArray(data) ? data : Array.isArray(data?.contacts) ? data.contacts : []
        console.log('findContacts:', apiContacts.length)
      } catch (e) { console.error('findContacts error:', e) }

      // ── Step 2: Fetch chats from Evolution API ──
      let apiChats: any[] = []
      try {
        const res = await fetch(`${EVOLUTION_API_URL}/chat/findChats/${instanceName}`, {
          method: 'POST', headers: evoHeaders(), body: JSON.stringify({}),
        })
        const data = await res.json()
        apiChats = Array.isArray(data) ? data : []
        console.log('findChats:', apiChats.length)
      } catch (e) { console.error('findChats error:', e) }

      // ── Step 3: Build contacts map ──
      // Priority: DB client name > verifiedName > pushName > number
      const contactsMap = new Map<string, { name: string | null; pushName: string | null; verifiedName: string | null; foto: string | null }>()

      // From API contacts
      for (const c of apiContacts) {
        const jid = c.remoteJid || c.id
        if (!jid || jid === 'status@broadcast') continue
        contactsMap.set(jid, {
          name: c.name || c.formattedName || null,
          pushName: c.pushName || null,
          verifiedName: c.verifiedName || c.verifiedBizName || null,
          foto: c.profilePictureUrl || null,
        })
      }

      // Enrich from chat objects
      for (const c of apiChats) {
        const jid = c.remoteJid || c.id
        if (!jid || jid === 'status@broadcast') continue
        const existing = contactsMap.get(jid)
        const pushName = c.pushName || c.notify || c.notifyName || c.lastMessage?.pushName
        const subject = c.subject || c.groupMetadata?.subject
        const chatName = c.name || c.formattedName
        if (!existing) {
          contactsMap.set(jid, {
            name: chatName || subject || null,
            pushName: pushName || null,
            verifiedName: null,
            foto: c.profilePicUrl || c.profilePictureUrl || null,
          })
        } else {
          if (!existing.pushName && pushName) existing.pushName = pushName
          if (!existing.name && (chatName || subject)) existing.name = chatName || subject || null
          if (!existing.foto && (c.profilePicUrl || c.profilePictureUrl)) existing.foto = c.profilePicUrl || c.profilePictureUrl
        }
      }

      // ── Step 4: Fetch profile pictures for contacts without photos (batch, max 40) ──
      const jidsNeedPic = Array.from(contactsMap.entries())
        .filter(([jid, c]) => !c.foto && jid !== 'status@broadcast')
        .map(([jid]) => jid)
        .slice(0, 40)

      console.log('Fetching profile pics for:', jidsNeedPic.length)
      for (let i = 0; i < jidsNeedPic.length; i += 10) {
        const batch = jidsNeedPic.slice(i, i + 10)
        await Promise.all(batch.map(async (jid) => {
          try {
            const res = await fetch(`${EVOLUTION_API_URL}/chat/fetchProfilePictureUrl/${instanceName}`, {
              method: 'POST', headers: evoHeaders(),
              body: JSON.stringify({ number: jid }),
            })
            const data = await res.json()
            const picUrl = data?.profilePictureUrl || data?.picture || data?.imgUrl
            if (picUrl) {
              const c = contactsMap.get(jid)
              if (c) c.foto = picUrl
            }
          } catch (_) {}
        }))
      }

      // ── Step 5: Persist contacts to DB ──
      const contactsToSave = Array.from(contactsMap.entries())
        .filter(([jid]) => !jid.includes('@g.us') && jid !== 'status@broadcast')
        .map(([jid, c]) => ({
          instancia_id: instanceId,
          remote_jid: jid,
          nome: c.name || c.verifiedName || c.pushName || null,
          push_name: c.pushName || null,
          verified_name: c.verifiedName || null,
          numero: jid.replace('@s.whatsapp.net', '').replace('@lid', ''),
          foto_url: c.foto || null,
        }))

      if (contactsToSave.length > 0) {
        const { error } = await svc.from('whatsapp_contatos')
          .upsert(contactsToSave, { onConflict: 'instancia_id,remote_jid', ignoreDuplicates: false })
        if (error) console.error('Contacts upsert error:', error)
        else console.log('Contacts saved:', contactsToSave.length)
      }

      // ── Step 6: Build and persist chats cache ──
      // Load DB clients for name resolution
      const { data: dbClientes } = await svc
        .from('clientes')
        .select('nome, telefone')
        .eq('user_id', user.id)
      const clienteMap = new Map<string, string>()
      for (const cl of dbClientes || []) {
        if (cl.telefone) {
          const cleanPhone = cl.telefone.replace(/\D/g, '')
          clienteMap.set(cleanPhone, cl.nome)
        }
      }

      const chatsToSave = apiChats
        .filter((c: any) => {
          const jid = c.remoteJid || c.id
          return jid && jid !== 'status@broadcast'
        })
        .map((c: any) => {
          const jid = c.remoteJid || c.id
          const isGroup = jid.includes('@g.us')
          const contact = contactsMap.get(jid)
          const rawNumber = jid.replace('@s.whatsapp.net', '').replace('@lid', '').replace('@g.us', '')

          // Name resolution priority
          const clienteName = clienteMap.get(rawNumber) || null
          const resolvedName = clienteName
            || contact?.verifiedName
            || contact?.name
            || contact?.pushName
            || (isGroup ? (c.subject || c.groupMetadata?.subject || c.name) : null)
            || (isGroup ? jid : formatPhone(rawNumber))

          // Last message
          const lastMsgObj = c.lastMessage?.message || {}
          const lastMsg = lastMsgObj.conversation
            || lastMsgObj.extendedTextMessage?.text
            || lastMsgObj.imageMessage?.caption
            || lastMsgObj.videoMessage?.caption
            || lastMsgObj.documentMessage?.fileName
            || null
          const mediaLabel = lastMsgObj.stickerMessage ? '🏷️ Figurinha'
            : lastMsgObj.imageMessage && !lastMsg ? '📷 Imagem'
            : lastMsgObj.audioMessage ? '🎤 Áudio'
            : lastMsgObj.videoMessage && !lastMsg ? '🎥 Vídeo'
            : lastMsgObj.documentMessage && !lastMsg ? '📎 Documento'
            : null
          const displayMsg = lastMsg || mediaLabel || ''

          const ts = c.updatedAt
            || (c.lastMessage?.messageTimestamp
              ? new Date(Number(c.lastMessage.messageTimestamp) * 1000).toISOString()
              : new Date().toISOString())

          return {
            instancia_id: instanceId,
            remote_jid: jid,
            nome: resolvedName,
            foto_url: contact?.foto || c.profilePicUrl || c.profilePictureUrl || null,
            ultima_mensagem: displayMsg,
            ultimo_timestamp: ts,
            direcao: c.lastMessage?.key?.fromMe ? 'out' : 'in',
            nao_lidas: c.unreadMessages || c.unreadCount || 0,
            is_group: isGroup,
          }
        })

      if (chatsToSave.length > 0) {
        const { error } = await svc.from('whatsapp_chats_cache')
          .upsert(chatsToSave, { onConflict: 'instancia_id,remote_jid', ignoreDuplicates: false })
        if (error) console.error('Chats cache upsert error:', error)
        else console.log('Chats cached:', chatsToSave.length)
      }

      return new Response(JSON.stringify({
        ok: true,
        contacts_synced: contactsToSave.length,
        chats_synced: chatsToSave.length,
        pics_fetched: jidsNeedPic.length,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ─── SET WEBHOOK ───
    if (action === 'set-webhook') {
      const instance = await getUserInstance()
      if (!instance) {
        return new Response(JSON.stringify({ error: 'No instance' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const webhookUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/webhook-whatsapp`
      const evoRes = await fetch(`${EVOLUTION_API_URL}/webhook/set/${instance.instance_name}`, {
        method: 'POST', headers: evoHeaders(),
        body: JSON.stringify({
          webhook: {
            enabled: true, url: webhookUrl, webhookByEvents: false, webhookBase64: false,
            events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'],
          }
        }),
      })
      const evoData = await evoRes.json()
      console.log('Set webhook response received')
      return new Response(JSON.stringify({ success: true, data: evoData }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ─── FETCH MESSAGES ───
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

      const svc = getServiceSupabase()

      // Load DB messages
      const { data: dbMessages } = await svc
        .from('whatsapp_mensagens')
        .select('*')
        .eq('instancia_id', instance.id)
        .eq('remote_jid', remoteJid)
        .order('timestamp', { ascending: true })
        .limit(200)

      const existingIds = new Set((dbMessages || []).map((m: any) => m.message_id))

      // Fetch from Evolution API for backfill
      let apiMessages: any[] = []
      try {
        const evoRes = await fetch(`${EVOLUTION_API_URL}/chat/findMessages/${instance.instance_name}`, {
          method: 'POST', headers: evoHeaders(),
          body: JSON.stringify({ where: { key: { remoteJid } }, limit: 200 }),
        })
        const raw = await evoRes.text()
        let data: any
        try { data = JSON.parse(raw) } catch { data = null }

        if (data) {
          if (Array.isArray(data)) apiMessages = data
          else if (Array.isArray(data?.messages?.records)) apiMessages = data.messages.records
          else if (Array.isArray(data?.messages)) apiMessages = data.messages
          else if (Array.isArray(data?.records)) apiMessages = data.records
          else if (data?.key) apiMessages = [data]
          else {
            // Try to find any array with message-like objects
            for (const key of Object.keys(data)) {
              if (Array.isArray(data[key]) && data[key].length > 0 && (data[key][0]?.key || data[key][0]?.message)) {
                apiMessages = data[key]
                break
              }
            }
          }
        }
        console.log('API messages fetched:', apiMessages.length)
      } catch (e) { console.error('findMessages error:', e) }

      // Parse and find new messages
      const newMessages: any[] = []
      for (const msg of apiMessages) {
        const msgId = msg.key?.id || msg.id
        if (!msgId || existingIds.has(msgId)) continue

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

        newMessages.push({
          instancia_id: instance.id,
          remote_jid: remoteJid,
          direcao: msg.key?.fromMe ? 'out' : 'in',
          conteudo: displayContent,
          tipo: messageType,
          timestamp: msg.messageTimestamp
            ? new Date(Number(msg.messageTimestamp) * 1000).toISOString()
            : msg.createdAt || new Date().toISOString(),
          message_id: msgId,
        })
      }

      // Persist new messages
      if (newMessages.length > 0) {
        svc.from('whatsapp_mensagens')
          .upsert(newMessages, { onConflict: 'message_id', ignoreDuplicates: true })
          .then(({ error }: any) => { if (error) console.error('Persist messages error:', error) })
      }

      // Combine and sort
      const allMessages = [
        ...(dbMessages || []).map((m: any) => ({
          id: m.id, remote_jid: m.remote_jid, direcao: m.direcao,
          conteudo: m.conteudo, tipo: m.tipo, timestamp: m.timestamp, message_id: m.message_id,
        })),
        ...newMessages.map((m: any) => ({
          id: m.message_id, remote_jid: m.remote_jid, direcao: m.direcao,
          conteudo: m.conteudo, tipo: m.tipo, timestamp: m.timestamp, message_id: m.message_id,
        })),
      ]
      allMessages.sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

      // Reset unread count for this chat
      svc.from('whatsapp_chats_cache')
        .update({ nao_lidas: 0 })
        .eq('instancia_id', instance.id)
        .eq('remote_jid', remoteJid)
        .then(() => {})

      return new Response(JSON.stringify({ messages: allMessages }), {
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
        if (checkRes.ok) instanceExists = true
      } catch (_e) {}

      let qrBase64: string | null = null
      let qrCode: string | null = null
      let pairingCode: string | null = null
      let instanceId: string | null = null

      if (!instanceExists) {
        const evoRes = await fetch(`${EVOLUTION_API_URL}/instance/create`, {
          method: 'POST', headers: evoHeaders(),
          body: JSON.stringify({
            instanceName, qrcode: true, integration: 'WHATSAPP-BAILEYS',
            webhook: {
              url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/webhook-whatsapp`,
              byEvents: false, base64: false,
              headers: { 'apikey': EVOLUTION_API_KEY },
              events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'],
            },
          }),
        })

        if (!evoRes.ok) {
          const message = await parseEvolutionError(evoRes)
          return new Response(JSON.stringify({
            error: 'instance_create_failed',
            provider_message: message,
          }), {
            status: evoRes.status,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }

        const evoData = await evoRes.json()
        instanceId = evoData.instance?.instanceId || null
        qrBase64 = evoData.qrcode?.base64 || null
        qrCode = evoData.code || evoData.qrcode?.code || null
        pairingCode = evoData.pairingCode || null
      }

      if (!qrCode && !qrBase64) {
        let lastQrError: string | null = null
        for (let attempt = 0; attempt < 5; attempt++) {
          await new Promise(r => setTimeout(r, 2000))
          try {
            const qrRes = await fetch(
              `${EVOLUTION_API_URL}/instance/connect/${instanceName}`,
              { headers: evoHeaders() }
            )
            if (!qrRes.ok) {
              lastQrError = await parseEvolutionError(qrRes)
              continue
            }
            const qrData = await qrRes.json()
            qrBase64 = qrData.base64 || null
            qrCode = qrData.code || null
            pairingCode = qrData.pairingCode || null
            if (qrCode || qrBase64) break
          } catch (e) { console.error('QR fetch error:', e) }
        }

        if (!qrCode && !qrBase64 && lastQrError) {
          return new Response(JSON.stringify({
            error: 'qrcode_unavailable',
            provider_message: lastQrError,
          }), {
            status: 503,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }
      }

      const { data: existing } = await supabase
        .from('whatsapp_instancias')
        .select('id')
        .eq('user_id', user.id)
        .eq('instance_name', instanceName)
        .maybeSingle()

      if (existing) {
        await supabase.from('whatsapp_instancias')
          .update({ status: 'connecting', instance_id: instanceId })
          .eq('id', existing.id)
      } else {
        await supabase.from('whatsapp_instancias')
          .insert({ user_id: user.id, instance_name: instanceName, instance_id: instanceId, status: 'connecting' })
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
      await supabase.from('whatsapp_instancias')
        .update({ status: newStatus })
        .eq('id', instance.id)

      return new Response(JSON.stringify({
        status: newStatus, instance: instance.instance_name, phone: instance.phone_number,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ─── QRCODE ───
    if (action === 'qrcode') {
      const instance = await getUserInstance()
      if (!instance) {
        return new Response(JSON.stringify({ error: 'No instance' }), {
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
          status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const body = await req.json()
      const { number, text } = body
      if (!number || !text) {
        return new Response(JSON.stringify({ error: 'number e text são obrigatórios' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const enqueue = await enqueueMessage({
        supabase: getServiceSupabase(),
        tenantId: user.id,
        destination: number,
        event: 'manual_chat',
        reference: `${instance.id}:${number}:${text}`,
        aggregateType: 'chat',
        aggregateId: instance.id,
        payload: {
          kind: 'manual_chat',
          destinationNumber: number,
          messageText: text,
          instanceName: instance.instance_name,
          instanceId: instance.id,
          userId: user.id,
        },
      })

      if (enqueue.status === 'instance_disconnected') {
        return new Response(JSON.stringify({ success: false, error: 'WhatsApp não conectado' }), {
          status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      if (enqueue.status === 'rate_limited') {
        return new Response(JSON.stringify({ success: false, error: 'Rate limit de envio atingido', status: 'rate_limited' }), {
          status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      if (enqueue.status === 'tenant_degraded') {
        return new Response(JSON.stringify({ success: false, error: 'tenant_degraded' }), {
          status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      if (!enqueue.ok) {
        return new Response(JSON.stringify({ success: false, error: enqueue.reason || 'Falha ao enfileirar mensagem' }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      return new Response(JSON.stringify({
        success: true,
        status: 'queued',
        queue_status: enqueue.status,
        idempotency_key: enqueue.idempotencyKey,
        outbox_id: enqueue.outboxId,
      }), {
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

      await supabase.from('whatsapp_instancias')
        .update({ status: 'disconnected' })
        .eq('id', instance.id)

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err: any) {
    const status = Number(err?.status) || 401
    return new Response(JSON.stringify({ error: err?.message ?? 'Unknown error' }), {
      status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
