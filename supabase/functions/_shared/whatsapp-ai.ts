// @ts-nocheck - Deno edge function
import type { Intent } from './whatsapp-types.ts'

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')
const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')

const INTENTS: Intent[] = ['PROCESS_STATUS', 'HUMAN_SUPPORT', 'NEW_CLIENT', 'OPT_OUT', 'OTHER']

const CLASSIFY_SYSTEM_PROMPT = `Você é um classificador de intenções de mensagens de WhatsApp para um escritório jurídico.
Classifique a mensagem em uma das seguintes intenções:
- PROCESS_STATUS: quer saber status, andamento, atualização de processo
- HUMAN_SUPPORT: quer falar com advogado, humano, atendente
- NEW_CLIENT: é um potencial novo cliente interessado em serviços
- OPT_OUT: quer parar de receber notificações (parar, cancelar, descadastrar, stop, sair, não quero mais)
- OTHER: qualquer outra coisa (perguntas gerais, dúvidas, agradecimentos)

Retorne SOMENTE JSON no formato {"intent":"..."}.`

// --- Anthropic API ---
async function callAnthropic(systemPrompt: string, userMessage: string, maxTokens = 300): Promise<string | null> {
  if (!ANTHROPIC_API_KEY) return null
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data?.content?.[0]?.text?.trim() ?? null
  } catch {
    return null
  }
}

// --- OpenAI API ---
async function callOpenAI(systemPrompt: string, userMessage: string, temperature = 0, jsonMode = false): Promise<string | null> {
  if (!OPENAI_API_KEY) return null
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature,
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      }),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data?.choices?.[0]?.message?.content?.trim() ?? null
  } catch {
    return null
  }
}

// --- Lovable AI Gateway ---
async function callLovableAI(systemPrompt: string, userMessage: string, temperature = 0): Promise<string | null> {
  if (!LOVABLE_API_KEY) return null
  try {
    const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash-lite',
        temperature,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      }),
    })
    if (!res.ok) return null
    const data = await res.json()
    return data?.choices?.[0]?.message?.content?.trim() ?? null
  } catch {
    return null
  }
}

function classifyByKeywords(message: string): Intent {
  const lowered = message.toLowerCase()
  if (lowered.includes('parar') || lowered.includes('cancelar') || lowered.includes('descadastrar') || lowered.includes('sair') || lowered.includes('stop') || lowered.includes('não quero mais')) return 'OPT_OUT'
  if (lowered.includes('process') || lowered.includes('andamento') || lowered.includes('status') || lowered.includes('moviment')) return 'PROCESS_STATUS'
  if (lowered.includes('advogado') || lowered.includes('humano') || lowered.includes('atendente') || lowered.includes('falar com')) return 'HUMAN_SUPPORT'
  return 'OTHER'
}

function parseIntentFromResponse(raw: string): Intent | null {
  try {
    // Try to extract JSON from response
    const jsonMatch = raw.match(/\{[^}]*"intent"[^}]*\}/)?.[0]
    if (!jsonMatch) return null
    const parsed = JSON.parse(jsonMatch)
    const candidate = String(parsed.intent ?? '').toUpperCase() as Intent
    return INTENTS.includes(candidate) ? candidate : null
  } catch {
    return null
  }
}

export async function classifyIntent(message: string): Promise<Intent> {
  const prompt = `Mensagem: ${message}`

  // Try Anthropic first
  const anthropicResult = await callAnthropic(CLASSIFY_SYSTEM_PROMPT + '\nRetorne SOMENTE JSON.', prompt)
  if (anthropicResult) {
    const intent = parseIntentFromResponse(anthropicResult)
    if (intent) return intent
  }

  // Fallback to OpenAI
  const openaiResult = await callOpenAI(CLASSIFY_SYSTEM_PROMPT, prompt, 0, true)
  if (openaiResult) {
    const intent = parseIntentFromResponse(openaiResult)
    if (intent) return intent
  }

  // Fallback to Lovable AI
  const lovableResult = await callLovableAI(CLASSIFY_SYSTEM_PROMPT + '\nRetorne SOMENTE JSON no formato {"intent":"..."}.', prompt)
  if (lovableResult) {
    const intent = parseIntentFromResponse(lovableResult)
    if (intent) return intent
  }

  // Final fallback: keywords
  return classifyByKeywords(message)
}

// --- Contextual response generation ---

export type ProcessoInfo = {
  numero_cnj: string
  tribunal: string | null
  vara: string | null
  classe: string | null
  assunto: string | null
  status: string | null
  data_distribuicao: string | null
  movimentacoes: Array<{ descricao: string; data_movimentacao: string | null }>
}

export type ClienteInfo = {
  nome: string
  processos: ProcessoInfo[]
}

function buildContextSystemPrompt(clienteInfo: ClienteInfo): string {
  let prompt = `Você é um assistente jurídico virtual de um escritório de advocacia, respondendo via WhatsApp.

DADOS DO CLIENTE:
Nome: ${clienteInfo.nome}

`

  if (clienteInfo.processos.length === 0) {
    prompt += 'O cliente não tem processos ativos vinculados no momento.\n'
  } else {
    clienteInfo.processos.forEach((p, i) => {
      prompt += `PROCESSO ${i + 1}:
- Número CNJ: ${p.numero_cnj}
- Tribunal: ${p.tribunal ?? 'N/I'}
- Vara: ${p.vara ?? 'N/I'}
- Classe: ${p.classe ?? 'N/I'}
- Assunto: ${p.assunto ?? 'N/I'}
- Status: ${p.status ?? 'N/I'}
- Data distribuição: ${p.data_distribuicao ? new Date(p.data_distribuicao).toLocaleDateString('pt-BR') : 'N/I'}
`
      if (p.movimentacoes.length > 0) {
        prompt += 'Movimentações recentes:\n'
        p.movimentacoes.forEach((m) => {
          const dt = m.data_movimentacao ? new Date(m.data_movimentacao).toLocaleDateString('pt-BR') : 'sem data'
          prompt += `  • ${dt}: ${m.descricao}\n`
        })
      } else {
        prompt += 'Sem movimentações recentes registradas.\n'
      }
      prompt += '\n'
    })
  }

  prompt += `REGRAS OBRIGATÓRIAS:
- Responda SOMENTE com base nos dados fornecidos acima, NUNCA invente informações
- Use linguagem simples e acessível, sem juridiquês
- Máximo 3-4 frases curtas (é WhatsApp, não e-mail)
- Nunca prometa resultados ou prazos
- Tom cordial, humano e acolhedor
- Se tiver mais de 1 processo, identifique claramente qual está mencionando
- Se o cliente perguntar algo que não está nos dados, diga que vai verificar com o advogado responsável`

  return prompt
}

function buildStaticResponse(clienteInfo: ClienteInfo): string {
  if (clienteInfo.processos.length === 0) {
    return `Olá, ${clienteInfo.nome}! No momento não encontrei processos ativos no seu cadastro. Vou encaminhar sua consulta para o advogado responsável.`
  }

  const p = clienteInfo.processos[0]
  const lastMov = p.movimentacoes[0]
  if (lastMov) {
    const dt = lastMov.data_movimentacao ? new Date(lastMov.data_movimentacao).toLocaleDateString('pt-BR') : ''
    return `Olá, ${clienteInfo.nome}! Seu processo ${p.numero_cnj} teve uma atualização${dt ? ` em ${dt}` : ''}: ${lastMov.descricao}. O escritório segue acompanhando os próximos passos.`
  }

  return `Olá, ${clienteInfo.nome}! Seu processo ${p.numero_cnj} está ${p.status ?? 'em andamento'}. Sem movimentações recentes registradas até o momento. O escritório segue acompanhando.`
}

export async function generateContextualResponse(
  clienteInfo: ClienteInfo,
  mensagemCliente: string,
  historico: string,
  _intent: Intent,
): Promise<string> {
  const systemPrompt = buildContextSystemPrompt(clienteInfo)
  const userMessage = historico ? `${historico}\nCliente: ${mensagemCliente}` : mensagemCliente

  // Try Anthropic
  const anthropicResult = await callAnthropic(systemPrompt, userMessage, 500)
  if (anthropicResult && anthropicResult.length > 10) return anthropicResult

  // Fallback OpenAI
  const openaiResult = await callOpenAI(systemPrompt, userMessage, 0.3)
  if (openaiResult && openaiResult.length > 10) return openaiResult

  // Fallback Lovable AI
  const lovableResult = await callLovableAI(systemPrompt, userMessage, 0.3)
  if (lovableResult && lovableResult.length > 10) return lovableResult

  // Static fallback
  return buildStaticResponse(clienteInfo)
}
