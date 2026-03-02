// @ts-nocheck - Deno edge function
import type { Intent } from './types.ts'

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')
const OPENAI_MODEL = Deno.env.get('OPENAI_MODEL') ?? 'gpt-4o-mini'

const INTENTS: Intent[] = ['PROCESS_STATUS', 'HUMAN_SUPPORT', 'NEW_CLIENT', 'OTHER']

export async function classifyIntent(message: string): Promise<Intent> {
  if (!OPENAI_API_KEY) {
    const lowered = message.toLowerCase()
    if (lowered.includes('process') || lowered.includes('andamento') || lowered.includes('status')) return 'PROCESS_STATUS'
    if (lowered.includes('advogado') || lowered.includes('humano') || lowered.includes('atendente')) return 'HUMAN_SUPPORT'
    return 'OTHER'
  }

  const prompt = `Classifique a intenção da mensagem de WhatsApp para escritório jurídico.
Retorne SOMENTE JSON no formato {"intent":"..."}.
Intenções permitidas: PROCESS_STATUS, HUMAN_SUPPORT, NEW_CLIENT, OTHER.
Mensagem: ${message}`

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!res.ok) return 'OTHER'

  const data = await res.json()
  const raw = data?.choices?.[0]?.message?.content
  if (!raw) return 'OTHER'

  try {
    const parsed = JSON.parse(raw)
    const candidate = String(parsed.intent ?? '').toUpperCase() as Intent
    return INTENTS.includes(candidate) ? candidate : 'OTHER'
  } catch {
    return 'OTHER'
  }
}

export async function explainMovement(movimentacaoTexto: string): Promise<string> {
  if (!OPENAI_API_KEY) {
    return 'Seu processo teve atualização recente e seguimos acompanhando os próximos passos com atenção.'
  }

  const prompt = `Explique a movimentação processual abaixo em linguagem simples para um cliente leigo.
Não use juridiquês.
Não prometa resultados.
Não exiba dados sensíveis.

Movimentação: ${movimentacaoTexto}`

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature: 0.2,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!res.ok) {
    return 'Seu processo recebeu uma atualização. O time jurídico seguirá com os próximos passos e te manterá informado.'
  }

  const data = await res.json()
  return data?.choices?.[0]?.message?.content?.trim()
    || 'Seu processo recebeu uma atualização. O time jurídico seguirá com os próximos passos e te manterá informado.'
}
