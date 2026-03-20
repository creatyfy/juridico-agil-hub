import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { juditRequest } from "../_shared/judit-client.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const AI_GATEWAY = 'https://ai.gateway.lovable.dev/v1/chat/completions';

const validUFs = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT',
  'PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { oab, uf } = await req.json();

    if (!oab || !uf) {
      return new Response(
        JSON.stringify({ error: 'Campos oab e uf são obrigatórios' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!validUFs.includes(uf)) {
      return new Response(
        JSON.stringify({ error: 'UF inválida' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const cleanOab = String(oab).replace(/[^0-9]/g, '').replace(/^0+/, '');
    console.log(`Validating OAB ${cleanOab}/${uf}...`);

    // Strategy 1: Judit API via shared client (same as search-processes)
    const juditResult = await tryJuditOab(cleanOab, uf);
    if (juditResult) {
      console.log(`Found via Judit API: ${juditResult.nome}`);
      return jsonResponse(juditResult);
    }

    // Strategy 2: Firecrawl + AI extraction
    const fallbackResult = await tryFirecrawlWithAI(cleanOab, uf);
    if (fallbackResult) {
      console.log(`Found via Firecrawl+AI: ${fallbackResult.nome}`);
      return jsonResponse(fallbackResult);
    }

    // Strategy 3: CNA
    const cnaResult = await tryDirectCNA(cleanOab, uf);
    if (cnaResult) {
      console.log(`Found via CNA: ${cnaResult.nome}`);
      return jsonResponse(cnaResult);
    }

    console.log(`OAB ${cleanOab}/${uf} not found by any strategy`);
    return jsonResponse({ nome: null, status: 'nao_encontrado' });

  } catch (error: unknown) {
    console.error('Error:', error);
    return jsonResponse({ nome: null, status: 'nao_encontrado', message: 'Erro ao consultar OAB' });
  }
});

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ─── Strategy 1: Judit API (shared client with retries) ──────────────────────

async function tryJuditOab(oab: string, uf: string) {
  const apiKey = Deno.env.get('JUDIT_API_KEY');
  if (!apiKey) {
    console.log('JUDIT_API_KEY not set, skipping');
    return null;
  }

  try {
    const searchKey = `${oab}/${uf}`;
    console.log(`Judit: creating OAB request for ${searchKey}`);

    // Use the shared judit-client with retries & circuit breaker
    const createData = await juditRequest({
      tenantKey: 'validate-oab',
      apiKey,
      path: '/requests',
      method: 'POST',
      body: {
        search: {
          search_type: 'oab',
          search_key: searchKey,
          response_type: 'lawsuits',
        },
      },
      timeoutMs: 10000,
    }) as { request_id?: string };

    const requestId = createData?.request_id;
    if (!requestId) {
      console.error('Judit: no request_id in response', JSON.stringify(createData).slice(0, 200));
      return null;
    }

    console.log(`Judit request created: ${requestId}`);

    // Poll for completion (max ~20s, every 3s)
    for (let i = 0; i < 7; i++) {
      await sleep(3000);

      try {
        const statusData = await juditRequest({
          tenantKey: 'validate-oab',
          apiKey,
          path: `/requests/${requestId}`,
          timeoutMs: 8000,
        }) as { status?: string; request_status?: string };

        const st = statusData?.status || statusData?.request_status;
        console.log(`Judit poll #${i + 1}: status=${st}`);

        if (st === 'done' || st === 'completed') {
          const resultsData = await juditRequest({
            tenantKey: 'validate-oab',
            apiKey,
            path: `/responses?request_id=${requestId}&page=1&page_size=10`,
            timeoutMs: 8000,
          }) as Record<string, unknown>;

          return extractLawyerFromJuditResults(resultsData, oab, uf);
        }

        if (st === 'error' || st === 'failed') {
          console.error(`Judit request failed: ${st}`);
          return null;
        }
      } catch (pollErr) {
        console.error(`Judit poll error: ${(pollErr as Error).message}`);
        continue;
      }
    }

    console.log('Judit: polling timeout');
    return null;
  } catch (error) {
    console.error('Judit error:', (error as Error).message);
    return null;
  }
}

function extractLawyerFromJuditResults(data: Record<string, unknown>, oab: string, uf: string) {
  const pageData = (data.page_data || data.data || []) as Record<string, unknown>[];
  if (!Array.isArray(pageData) || pageData.length === 0) return null;

  const candidates = new Map<string, number>();

  for (const item of pageData.slice(0, 20)) {
    const responseData = (item.response_data || item) as Record<string, unknown>;
    findLawyerInObject(responseData, oab, uf, candidates);
  }

  if (candidates.size === 0) return null;

  const [bestName] = [...candidates.entries()].sort((a, b) => b[1] - a[1])[0];
  console.log(`Judit extracted: ${bestName} (from ${candidates.size} candidates)`);

  return {
    nome: bestName,
    status: 'ativo' as const,
    inscricao: oab,
    uf,
    fonte: 'judit',
  };
}

function findLawyerInObject(obj: Record<string, unknown>, oab: string, uf: string, candidates: Map<string, number>) {
  // Search in lawyers/advogados arrays at any level
  const lawyerArrays = ['lawyers', 'advogados', 'attorneys'];
  const partyArrays = ['parties', 'partes'];

  for (const key of lawyerArrays) {
    const lawyers = obj[key] as Record<string, unknown>[] | undefined;
    if (Array.isArray(lawyers)) {
      for (const lawyer of lawyers) {
        matchLawyer(lawyer, oab, uf, candidates);
      }
    }
  }

  for (const key of partyArrays) {
    const parties = obj[key] as Record<string, unknown>[] | undefined;
    if (Array.isArray(parties)) {
      for (const party of parties) {
        for (const lKey of lawyerArrays) {
          const lawyers = party[lKey] as Record<string, unknown>[] | undefined;
          if (Array.isArray(lawyers)) {
            for (const lawyer of lawyers) {
              matchLawyer(lawyer, oab, uf, candidates);
            }
          }
        }
      }
    }
  }

  // Check nested structures (last_step, steps)
  if (obj.last_step && typeof obj.last_step === 'object') {
    findLawyerInObject(obj.last_step as Record<string, unknown>, oab, uf, candidates);
  }
  const steps = obj.steps as Record<string, unknown>[] | undefined;
  if (Array.isArray(steps)) {
    for (const step of steps.slice(0, 5)) {
      findLawyerInObject(step, oab, uf, candidates);
    }
  }

  // Deep JSON string search as last resort
  if (candidates.size === 0) {
    const jsonStr = JSON.stringify(obj);
    const nameMatch = jsonStr.match(
      new RegExp(`"(?:name|nome)"\\s*:\\s*"([^"]{5,100})"[^}]{0,300}"(?:oab|inscription|inscricao)"\\s*:\\s*"?${oab}`, 'i')
    ) || jsonStr.match(
      new RegExp(`"(?:oab|inscription|inscricao)"\\s*:\\s*"?${oab}"?[^}]{0,300}"(?:name|nome)"\\s*:\\s*"([^"]{5,100})"`, 'i')
    );
    if (nameMatch?.[1]) {
      const normalized = nameMatch[1].toUpperCase().replace(/\s+/g, ' ').trim();
      if (normalized.split(/\s+/).length >= 2) {
        candidates.set(normalized, (candidates.get(normalized) || 0) + 1);
      }
    }
  }
}

function matchLawyer(lawyer: Record<string, unknown>, oab: string, uf: string, candidates: Map<string, number>) {
  const lawyerOab = String(lawyer.oab || lawyer.inscription || lawyer.inscricao || '').replace(/\D/g, '');
  const lawyerName = String(lawyer.name || lawyer.nome || '');

  if (lawyerOab === oab && lawyerName.length >= 5 && lawyerName.split(/\s+/).length >= 2) {
    const normalized = lawyerName.toUpperCase().replace(/\s+/g, ' ').trim();
    candidates.set(normalized, (candidates.get(normalized) || 0) + 1);
  }
}

// ─── Strategy 2: Firecrawl + AI extraction ───────────────────────────────────

async function tryFirecrawlWithAI(oab: string, uf: string) {
  const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
  if (!firecrawlKey) { console.log('FIRECRAWL_API_KEY not set'); return null; }

  try {
    const queries = [
      `advogado OAB ${oab}/${uf}`,
      `"OAB/${uf}" "${oab}" advogado nome`,
      `"${oab}/${uf}" advogado`,
      `site:jusbrasil.com.br OAB ${oab} ${uf}`,
      `site:escavador.com OAB ${oab} ${uf}`,
      `"${oab}" OAB "${uf}" advogado nome completo`,
    ];

    const allTexts: string[] = [];

    for (const query of queries) {
      console.log(`Firecrawl search: "${query}"`);

      const res = await fetchWithTimeout('https://api.firecrawl.dev/v1/search', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${firecrawlKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, limit: 5, lang: 'pt-br', country: 'br' }),
      }, 15000);

      if (!res.ok) {
        console.error(`Firecrawl failed: ${res.status}`);
        await res.text();
        continue;
      }

      const data = await res.json();
      const results = data?.data || data?.results || [];

      for (const r of results) {
        const text = [r.title || '', r.description || '', r.markdown || '', r.content || ''].join('\n');
        if (text.includes(oab)) {
          allTexts.push(text.slice(0, 2000));
        }
      }

      if (allTexts.length >= 3) break;
    }

    // If still no results, try broader search
    if (allTexts.length === 0) {
      console.log('Firecrawl: trying broader search...');
      const broadRes = await fetchWithTimeout('https://api.firecrawl.dev/v1/search', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${firecrawlKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: `"${oab}" "${uf}" advogado`, limit: 10, lang: 'pt-br', country: 'br' }),
      }, 15000);

      if (broadRes.ok) {
        const broadData = await broadRes.json();
        const broadResults = broadData?.data || broadData?.results || [];
        for (const r of broadResults) {
          const text = [r.title || '', r.description || '', r.markdown || '', r.content || ''].join('\n');
          if (text.includes(oab)) {
            allTexts.push(text.slice(0, 2000));
          }
        }
      } else {
        await broadRes.text();
      }
    }

    if (allTexts.length === 0) {
      console.log('Firecrawl: no results mentioning this OAB');
      return null;
    }

    console.log(`Firecrawl: ${allTexts.length} results found, extracting name...`);

    // Try AI extraction first
    const lovableKey = Deno.env.get('LOVABLE_API_KEY');
    if (lovableKey) {
      const aiResult = await extractWithAI(allTexts.join('\n---\n'), oab, uf, lovableKey);
      if (aiResult) return aiResult;
    }

    // Regex fallback
    return extractWithRegex(allTexts, oab, uf);
  } catch (error) {
    console.error('Firecrawl+AI error:', (error as Error).message);
    return null;
  }
}

async function extractWithAI(searchText: string, oab: string, uf: string, apiKey: string) {
  try {
    const prompt = `Extraia o nome completo do advogado com OAB número ${oab} do estado ${uf} a partir dos textos abaixo.

REGRAS ESTRITAS:
- Retorne APENAS o nome completo do advogado em letras MAIÚSCULAS
- O nome deve ter pelo menos nome e sobrenome
- Se não encontrar com certeza, retorne exatamente: NAO_ENCONTRADO
- Não invente nomes. Use apenas o que está nos textos.
- Retorne somente o advogado com OAB ${oab}/${uf}, não outro.

TEXTOS:
${searchText.slice(0, 6000)}

RESPOSTA (apenas o nome ou NAO_ENCONTRADO):`;

    const aiRes = await fetchWithTimeout(AI_GATEWAY, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 100,
        temperature: 0,
      }),
    }, 15000);

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error(`AI failed [${aiRes.status}]: ${errText.slice(0, 200)}`);
      return null;
    }

    const aiData = await aiRes.json();
    const rawName = aiData?.choices?.[0]?.message?.content?.trim();
    console.log(`AI response: "${rawName}"`);

    if (!rawName || rawName === 'NAO_ENCONTRADO' || rawName.length < 5) return null;

    const cleanName = rawName.toUpperCase().replace(/[^A-ZÀ-ÖØ-Ý\s]/g, '').replace(/\s+/g, ' ').trim();
    if (cleanName.split(/\s+/).length < 2) return null;

    return { nome: cleanName, status: 'ativo' as const, inscricao: oab, uf, fonte: 'firecrawl_ai' };
  } catch (error) {
    console.error('AI extraction error:', (error as Error).message);
    return null;
  }
}

function extractWithRegex(texts: string[], oab: string, uf: string) {
  const candidates = new Map<string, number>();
  const patterns = [
    new RegExp(`([A-ZÀ-ÖØ-Ýa-zà-öø-ý][A-ZÀ-ÖØ-Ýa-zà-öø-ý.\\s]{4,80})\\s*\\(?\\s*(?:OAB\\s*[:\\-]?\\s*)?${oab}\\s*/\\s*${uf}\\s*\\)?`, 'gi'),
    new RegExp(`(?:OAB|Advogad[oa])\\s*[:\\-]?\\s*([A-ZÀ-ÖØ-Ýa-zà-öø-ý][A-ZÀ-ÖØ-Ýa-zà-öø-ý.\\s]{4,80})\\s*[-–]?\\s*${oab}\\s*/\\s*${uf}`, 'gi'),
  ];

  for (const text of texts) {
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const cleaned = match[1].replace(/\s+/g, ' ').replace(/^(DRA?\.?|ADVOGAD[OA]\.?|DR\.?)+\s+/i, '').trim();
        if (cleaned.length >= 5 && cleaned.split(/\s+/).length >= 2) {
          const n = cleaned.toUpperCase();
          candidates.set(n, (candidates.get(n) || 0) + 1);
        }
      }
    }
  }

  if (candidates.size === 0) return null;
  const [bestName] = [...candidates.entries()].sort((a, b) => b[1] - a[1])[0];
  return { nome: bestName, status: 'ativo' as const, inscricao: oab, uf, fonte: 'firecrawl' };
}

// ─── Strategy 3: CNA ────────────────────────────────────────────────────────

async function tryDirectCNA(oab: string, uf: string) {
  try {
    console.log('Trying CNA...');
    const pageRes = await fetchWithTimeout('https://cna.oab.org.br/', {
      headers: { 'Accept': 'text/html', 'User-Agent': 'Mozilla/5.0' },
    }, 8000);

    const html = await pageRes.text();
    const tokenMatch = html.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/i);
    if (!tokenMatch?.[1]) return null;

    const searchRes = await fetchWithTimeout('https://cna.oab.org.br/Home/Search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        'User-Agent': 'Mozilla/5.0',
      },
      body: new URLSearchParams({
        __RequestVerificationToken: tokenMatch[1],
        NomeAdvo: '', Insc: oab, Uf: uf, TipoInsc: '',
      }).toString(),
    }, 8000);

    const text = await searchRes.text();
    if (!searchRes.ok) return null;

    try {
      const cna = JSON.parse(text);
      if (cna.Success && cna.Data?.length > 0) {
        const lawyer = cna.Data[0];
        return {
          nome: lawyer.Nome?.toUpperCase() || null,
          status: 'ativo' as const,
          inscricao: lawyer.Inscricao || oab,
          uf: lawyer.UF || uf,
          tipo: lawyer.TipoInscOab || null,
          fonte: 'cna',
        };
      }
    } catch { /* not JSON */ }

    return null;
  } catch (error) {
    console.error('CNA error:', (error as Error).message);
    return null;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
