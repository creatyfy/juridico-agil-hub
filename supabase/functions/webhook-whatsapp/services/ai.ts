import type { ClassificationResult } from './types.ts'

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')
const OPENAI_MODEL = Deno.env.get('OPENAI_MODEL') ?? 'gpt-4o-mini'

const fallbackClassification: ClassificationResult = {
  intencao: 'DUVIDA_GERAL',
  confianca: 0,
  precisaEscalar: true,
}

export async function classifyMessage(message: string, historySummary: string): Promise<ClassificationResult> {
  if (!OPENAI_API_KEY) {
    return fallbackClassification
  }

  const prompt = `Classifique a mensagem do cliente para atendimento jurídico.
Retorne SOMENTE JSON com as chaves: intencao, confianca, precisaEscalar.
Intenções válidas: CONSULTAR_STATUS, MARCAR_CONSULTORIA, ENVIAR_DOCUMENTO, RECLAMACAO, FALAR_COM_ADVOGADO, DUVIDA_GERAL.
Histórico resumido: ${historySummary}
Mensagem atual: ${message}`

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

  if (!res.ok) {
    return fallbackClassification
  }

  const data = await res.json()
  const raw = data?.choices?.[0]?.message?.content
  if (!raw) return fallbackClassification

  try {
    const parsed = JSON.parse(raw)
    const intencao = parsed.intencao
    const confianca = Number(parsed.confianca)
    const precisaEscalar = Boolean(parsed.precisaEscalar)

    return {
      intencao: intencao ?? 'DUVIDA_GERAL',
      confianca: Number.isFinite(confianca) ? confianca : 0,
      precisaEscalar,
    }
  } catch {
    return fallbackClassification
  }
}

export async function explainMovement(movimentacaoTexto: string): Promise<string> {
  if (!OPENAI_API_KEY) {
    return 'Houve atualização no processo, mas não foi possível gerar a explicação automática agora. Um atendente humano vai apoiar você na sequência.'
  }

  const prompt = `Explique a movimentação processual abaixo em linguagem simples para um cliente leigo.
Não use juridiquês.
Não prometa resultados.
Não estime prazos.
Se for irrelevante, informe que não há mudança significativa.

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
    return 'Recebemos sua solicitação e um advogado irá te atualizar com segurança.'
  }

  const data = await res.json()
  return data?.choices?.[0]?.message?.content?.trim()
    || 'Recebemos sua solicitação e um advogado irá te atualizar com segurança.'
}
