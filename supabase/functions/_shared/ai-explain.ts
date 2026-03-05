// @ts-nocheck - Deno edge function

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')
const OPENAI_MODEL = Deno.env.get('OPENAI_MODEL') ?? 'gpt-4o-mini'

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
