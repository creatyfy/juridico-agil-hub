import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const validUFs = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT',
  'PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];

// Seccional consultation URLs and their form selectors
const seccionais: Record<string, { url: string; inscricaoSelector: string; submitSelector: string }> = {
  'SP': {
    url: 'https://www2.oabsp.org.br/asp/consultaInscritos/consulta01.asp',
    inscricaoSelector: 'input[name="NoOABSP"], input[name="txtInscricao"], input[type="text"]',
    submitSelector: 'input[type="submit"], button[type="submit"], input[value="Pesquisar"]',
  },
};

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
    const apiKey = Deno.env.get('FIRECRAWL_API_KEY');

    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'Serviço de consulta não configurado' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Validating OAB ${cleanOab}/${uf}...`);

    // Strategy 1: Firecrawl scrape with actions on seccional website
    const seccionalResult = await trySeccionalScrape(apiKey, cleanOab, uf);
    if (seccionalResult) {
      console.log(`Seccional result: ${seccionalResult.nome} - ${seccionalResult.status}`);
      return new Response(
        JSON.stringify(seccionalResult),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Strategy 2: Firecrawl search on public databases
    const searchResult = await tryFirecrawlSearch(apiKey, cleanOab, uf);
    if (searchResult) {
      console.log(`Search result: ${searchResult.nome} - ${searchResult.status}`);
      return new Response(
        JSON.stringify(searchResult),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`OAB ${cleanOab}/${uf} not found`);
    return new Response(
      JSON.stringify({ nome: null, status: 'nao_encontrado' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ nome: null, status: 'nao_encontrado', message: 'Erro ao consultar OAB' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

/**
 * Try scraping seccional website using Firecrawl actions (fill form + submit)
 */
async function trySeccionalScrape(apiKey: string, oab: string, uf: string) {
  try {
    const config = seccionais[uf];
    if (!config) {
      console.log(`No seccional config for ${uf}, skipping direct scrape`);
      return null;
    }

    console.log(`Trying seccional ${uf} scrape with actions...`);

    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: config.url,
        formats: ['markdown'],
        onlyMainContent: true,
        waitFor: 2000,
        actions: [
          { type: 'wait', milliseconds: 1500 },
          { type: 'write', selector: config.inscricaoSelector, text: oab },
          { type: 'click', selector: config.submitSelector },
          { type: 'wait', milliseconds: 3000 },
          { type: 'scrape' },
        ],
      }),
    });

    const data = await response.json();
    const content = data.data || data;
    const markdown = content?.markdown || '';

    console.log(`Seccional ${uf} response: ${response.status}, len=${markdown.length}`);
    if (markdown.length > 50) {
      console.log(`Seccional preview: ${markdown.substring(0, 500)}`);
    }

    if (markdown.length > 100) {
      return extractFromSeccionalResult(markdown, oab, uf);
    }
  } catch (error) {
    console.error(`Seccional ${uf} scrape failed:`, error);
  }
  return null;
}

/**
 * Extract lawyer data from seccional result page
 */
function extractFromSeccionalResult(text: string, oab: string, uf: string) {
  if (!text || text.length < 50) return null;

  console.log(`Parsing seccional result for OAB ${oab}/${uf}...`);

  // Look for table-like data or name patterns in the result
  // OAB-SP typically shows: Nº Inscrição | Nome | Situação | Tipo

  // Try to find name in structured result patterns
  const patterns = [
    // Table row pattern: number followed by name
    new RegExp(`${oab}[\\s|]+([A-ZÀ-ÖØ-Ý][A-ZÀ-ÖØ-Ýa-zà-öø-ý\\s]{5,80})`, 'i'),
    // "Nome:" pattern
    /(?:Nome|NOME)[:\s]+([A-ZÀ-ÖØ-Ý][A-Za-zÀ-ÖØ-Ýà-öø-ý\s]{5,80})/,
    // Bold name
    /\*\*([A-ZÀ-ÖØ-Ý][A-Za-zÀ-ÖØ-Ýà-öø-ý\s]{5,80})\*\*/,
    // Heading with name
    /#{1,3}\s+([A-ZÀ-ÖØ-Ý][a-zà-öø-ý]+(?:\s+(?:de|da|do|dos|das|e)?\s*[A-ZÀ-ÖØ-Ýa-zà-öø-ý]+){1,7})/,
    // Name on its own line (ALL CAPS, 2+ words)
    /^([A-ZÀ-ÖØ-Ý]{2,}(?:\s+[A-ZÀ-ÖØ-Ý]{2,}){1,7})$/m,
  ];

  const excludeWords = ['RESULTADO', 'CONSULTA', 'CADASTRO', 'PESQUISAR', 'IMPORTANTE',
    'PROVIMENTO', 'CONSELHO', 'NACIONAL', 'SECCIONAL', 'ORDEM', 'ADVOGADOS',
    'BRASIL', 'FEDERAL', 'TRIBUNAL', 'INSCRITOS', 'NOTÍCIAS', 'SERVIÇOS',
    'CONSULTAR', 'SELECIONE', 'ATUALIZAÇÃO', 'SOCIEDADES', 'SUBSEÇÕES'];

  for (const pattern of patterns) {
    const matches = text.match(new RegExp(pattern.source, pattern.flags + (pattern.flags.includes('g') ? '' : 'g'))) || [];
    
    for (const fullMatch of matches) {
      const nameMatch = fullMatch.match(pattern);
      if (!nameMatch || !nameMatch[1]) continue;
      
      let candidate = nameMatch[1].trim().replace(/\s+/g, ' ');
      const words = candidate.split(/\s+/);
      
      if (words.length >= 2 && candidate.length >= 8 && candidate.length <= 80) {
        if (excludeWords.some(w => candidate.toUpperCase().includes(w))) continue;

        let status: 'ativo' | 'inativo' = 'ativo';
        const lower = text.toLowerCase();
        if (lower.includes('cancelad') || lower.includes('suspens') || 
            lower.includes('licenciad') || lower.includes('inativ') || 
            lower.includes('excluíd')) {
          const oabIdx = lower.indexOf(oab);
          if (oabIdx >= 0) {
            const nearby = lower.substring(Math.max(0, oabIdx - 300), oabIdx + 300);
            if (nearby.includes('cancelad') || nearby.includes('suspens') || nearby.includes('inativ')) {
              status = 'inativo';
            }
          }
        }

        return {
          nome: candidate.toUpperCase(),
          status,
          inscricao: oab,
          uf,
        };
      }
    }
  }

  return null;
}

/**
 * Fallback: search public databases via Firecrawl
 */
async function tryFirecrawlSearch(apiKey: string, oab: string, uf: string) {
  const queries = [
    `"OAB ${oab}" "${uf}" advogado nome site:jusbrasil.com.br OR site:escavador.com`,
    `advogado OAB/${uf} ${oab} nome inscrição`,
  ];

  for (const query of queries) {
    try {
      console.log(`Searching: ${query}`);
      const response = await fetch('https://api.firecrawl.dev/v1/search', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, limit: 5 }),
      });

      if (!response.ok) continue;

      const data = await response.json();
      const results = data.data || [];
      console.log(`Got ${results.length} search results`);

      for (const result of results) {
        const text = `${result.title || ''} ${result.description || ''} ${result.markdown || ''}`;
        const parsed = extractFromSearchResult(text, oab, uf);
        if (parsed) return parsed;
      }
    } catch (error) {
      console.error('Search error:', error);
    }
  }

  return null;
}

/**
 * Extract lawyer info from search result text
 */
function extractFromSearchResult(text: string, oab: string, uf: string) {
  if (!text || text.length < 10 || !text.includes(oab)) return null;

  const namePatterns = [
    /(?:Dr\.?|Dra\.?|Advogad[oa])\s+([A-ZÀ-ÖØ-Ý][a-zà-öø-ý]+(?:\s+(?:de|da|do|dos|das|e)?\s*[A-ZÀ-ÖØ-Ýa-zà-öø-ý]+){1,7})/,
    /(?:Nome|Advogad)[:\s]+([A-ZÀ-ÖØ-Ý][a-zà-öø-ý]+(?:\s+[A-Za-zÀ-ÖØ-Ýà-öø-ý]+){1,7})/i,
    /\*\*([A-ZÀ-ÖØ-Ý][a-zà-öø-ý]+(?:\s+[A-Za-zÀ-ÖØ-Ýà-öø-ý]+){1,7})\*\*/,
    /([A-ZÀ-ÖØ-Ý]{2}[A-ZÀ-ÖØ-Ý\s]{5,78})/,
  ];

  const excludeWords = ['RESULTADO', 'CONSULTA', 'CADASTRO', 'PESQUISAR', 'IMPORTANTE',
    'PROVIMENTO', 'CONSELHO', 'NACIONAL', 'SECCIONAL', 'ORDEM', 'ADVOGADOS',
    'BRASIL', 'FEDERAL', 'TRIBUNAL', 'INSCRITOS'];

  for (const pattern of namePatterns) {
    const match = text.match(pattern);
    if (!match || !match[1]) continue;

    const candidate = match[1].trim().replace(/\s+/g, ' ');
    const words = candidate.split(/\s+/);

    if (words.length >= 2 && candidate.length >= 8 && candidate.length <= 80) {
      if (excludeWords.some(w => candidate.toUpperCase().includes(w))) continue;

      let status: 'ativo' | 'inativo' = 'ativo';
      const lower = text.toLowerCase();
      if (lower.includes('cancelad') || lower.includes('suspens') || 
          lower.includes('licenciad') || lower.includes('inativ')) {
        status = 'inativo';
      }

      let cleanName = candidate.toUpperCase()
        .replace(/^(ADVOGAD[OA]\s+|DR\.?\s+|DRA\.?\s+)/i, '')
        .trim();

      return { nome: cleanName, status, inscricao: oab, uf };
    }
  }

  return null;
}
