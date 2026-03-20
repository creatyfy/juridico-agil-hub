import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

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

    const cleanOab = String(oab).replace(/[^0-9]/g, '');
    console.log(`Validating OAB ${cleanOab}/${uf}...`);

    // Strategy 1: Judit API (async request + poll) — authoritative source
    const juditResult = await tryJuditOab(cleanOab, uf);
    if (juditResult) {
      console.log(`Found via Judit API: ${juditResult.nome}`);
      return jsonResponse(juditResult);
    }

    // Strategy 2: Firecrawl strict search (web-based fallback)
    const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');
    if (firecrawlKey) {
      const fallbackResult = await searchOabViaFirecrawl(cleanOab, uf, firecrawlKey);
      if (fallbackResult) {
        console.log(`Found via Firecrawl: ${fallbackResult.nome}`);
        return jsonResponse(fallbackResult);
      }
    }

    // Strategy 3: Official CNA endpoint
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

// ─── Strategy 1: Judit API ───────────────────────────────────────────────────

async function tryJuditOab(oab: string, uf: string) {
  const apiKey = Deno.env.get('JUDIT_API_KEY');
  if (!apiKey) {
    console.log('JUDIT_API_KEY not configured, skipping Judit');
    return null;
  }

  try {
    const searchKey = `${oab}/${uf}`;
    console.log(`Judit async request for OAB: ${searchKey}`);

    // Create request
    const createRes = await fetchWithTimeout('https://requests.prod.judit.io/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
      body: JSON.stringify({
        search: {
          search_type: 'oab',
          search_key: searchKey,
          response_type: 'lawsuits',
        },
      }),
    }, 10000);

    if (!createRes.ok) {
      const errText = await createRes.text();
      console.error(`Judit create failed [${createRes.status}]: ${errText.slice(0, 200)}`);
      return null;
    }

    const createData = await createRes.json();
    const requestId = createData?.request_id;
    if (!requestId) {
      console.error('Judit: no request_id returned');
      return null;
    }

    console.log(`Judit request created: ${requestId}`);

    // Poll for completion (max ~14s, every 2s)
    for (let i = 0; i < 7; i++) {
      await sleep(2000);

      const statusRes = await fetchWithTimeout(
        `https://requests.prod.judit.io/requests/${requestId}`,
        { headers: { 'api-key': apiKey } },
        8000,
      );

      if (!statusRes.ok) { await statusRes.text(); continue; }

      const statusData = await statusRes.json();
      const status = statusData?.status;
      console.log(`Judit poll #${i + 1}: status=${status}`);

      if (status === 'done' || status === 'completed') {
        // Fetch results
        const resultsRes = await fetchWithTimeout(
          `https://requests.prod.judit.io/responses?request_id=${requestId}&page=1&page_size=10`,
          { headers: { 'api-key': apiKey } },
          8000,
        );
        if (!resultsRes.ok) { await resultsRes.text(); return null; }

        const resultsData = await resultsRes.json();
        return extractLawyerFromJuditResults(resultsData, oab, uf);
      }

      if (status === 'error' || status === 'failed') {
        console.error(`Judit request failed with status: ${status}`);
        return null;
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

// ─── Strategy 2: Firecrawl strict search ─────────────────────────────────────

async function searchOabViaFirecrawl(oab: string, uf: string, apiKey: string) {
  try {
    const queries = [
      `"${oab}/${uf}" advogado`,
      `"OAB/${uf}" "${oab}" advogado`,
      `"${oab}" "${uf}" "advogado"`,
    ];

    const candidateScores = new Map<string, number>();

    for (const query of queries) {
      console.log(`Firecrawl search: "${query}"`);

      const response = await fetchWithTimeout('https://api.firecrawl.dev/v1/search', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, limit: 10, lang: 'pt-br', country: 'br' }),
      }, 10000);

      if (!response.ok) {
        console.error(`Firecrawl failed: ${response.status}`);
        await response.text();
        continue;
      }

      const data = await response.json();
      const results = data?.data || data?.results || [];

      for (const result of results) {
        const text = [result.title || '', result.description || '', result.markdown || '', result.content || ''].join('\n');
        if (!containsExactOabUf(text, oab, uf)) continue;

        const name = extractLawyerName(text, oab, uf);
        if (!name) continue;

        const normalized = name.toUpperCase().replace(/\s+/g, ' ').trim();
        candidateScores.set(normalized, (candidateScores.get(normalized) ?? 0) + 1);
      }
    }

    if (candidateScores.size === 0) return null;

    const [bestName] = [...candidateScores.entries()].sort((a, b) => b[1] - a[1])[0];
    return { nome: bestName, status: 'ativo' as const, inscricao: oab, uf, fonte: 'firecrawl' };
  } catch (error) {
    console.error('Firecrawl error:', (error as Error).message);
    return null;
  }
}

function containsExactOabUf(text: string, oab: string, uf: string) {
  const normalized = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  const patterns = [
    new RegExp(`\\b${oab}\\s*/\\s*${uf}\\b`, 'i'),
    new RegExp(`\\bOAB\\s*[/:\\-]?\\s*${uf}\\s*[:\\-]?\\s*n?\\.?o?\\s*${oab}\\b`, 'i'),
    new RegExp(`\\bOAB\\s*[:\\-]?\\s*${oab}\\s*/\\s*${uf}\\b`, 'i'),
  ];
  return patterns.some(p => p.test(normalized));
}

function extractLawyerName(text: string, oab: string, uf: string): string | null {
  if (!text) return null;
  const patterns = [
    new RegExp(`([A-ZÀ-ÖØ-Ý][A-ZÀ-ÖØ-Ýa-zà-öø-ý\\.\\s]{4,90})\\s*\\(\\s*(?:OAB\\s*[:\\-]?\\s*)?${oab}\\s*\\/\\s*${uf}\\s*\\)`, 'i'),
    new RegExp(`ADVOGAD[OA]\\s*[:\\-]?\\s*([A-ZÀ-ÖØ-Ý][A-ZÀ-ÖØ-Ýa-zà-öø-ý\\.\\s]{4,90})\\s*\\(\\s*(?:OAB\\s*[:\\-]?\\s*)?${oab}\\s*\\/\\s*${uf}\\s*\\)`, 'i'),
    new RegExp(`([A-ZÀ-ÖØ-Ý][A-ZÀ-ÖØ-Ýa-zà-öø-ý\\.\\s]{4,90})\\s*[-–]\\s*OAB\\s*[/:]?\\s*${uf}\\s*[:\\-]?\\s*n?\\.?º?\\s*${oab}`, 'i'),
    new RegExp(`([A-ZÀ-ÖØ-Ý][A-ZÀ-ÖØ-Ýa-zà-öø-ý\\.\\s]{4,90})\\(OAB:\\s*${oab}\\s*\\/\\s*${uf}\\)`, 'i'),
    /"Nome"\s*:\s*"([^"]{5,100})"/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const cleaned = match[1].replace(/\s+/g, ' ').replace(/^(DRA?\.?|ADVOGAD[OA]\.?|DR\.?)+\s+/i, '').trim();
    if (cleaned.length >= 5 && cleaned.split(/\s+/).length >= 2) return cleaned;
  }
  return null;
}

// ─── Strategy 3: CNA ────────────────────────────────────────────────────────

async function tryDirectCNA(oab: string, uf: string) {
  try {
    console.log('Trying CNA official flow...');
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
