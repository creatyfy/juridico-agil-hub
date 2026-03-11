import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const validUFs = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT',
  'PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];

const UF_NAMES: Record<string, string> = {
  'AC':'Acre','AL':'Alagoas','AM':'Amazonas','AP':'Amapá','BA':'Bahia','CE':'Ceará',
  'DF':'Distrito Federal','ES':'Espírito Santo','GO':'Goiás','MA':'Maranhão','MG':'Minas Gerais',
  'MS':'Mato Grosso do Sul','MT':'Mato Grosso','PA':'Pará','PB':'Paraíba','PE':'Pernambuco',
  'PI':'Piauí','PR':'Paraná','RJ':'Rio de Janeiro','RN':'Rio Grande do Norte','RO':'Rondônia',
  'RR':'Roraima','RS':'Rio Grande do Sul','SC':'Santa Catarina','SE':'Sergipe','SP':'São Paulo','TO':'Tocantins'
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
    const firecrawlKey = Deno.env.get('FIRECRAWL_API_KEY');

    console.log(`Validating OAB ${cleanOab}/${uf}...`);

    // Strategy 1: Firecrawl search (web search for lawyer info)
    if (firecrawlKey) {
      const searchResult = await searchOabViaFirecrawl(cleanOab, uf, firecrawlKey);
      if (searchResult) {
        console.log(`Found via Firecrawl search: ${searchResult.nome}`);
        return new Response(
          JSON.stringify(searchResult),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Strategy 2: Direct CNA API (may be blocked)
    const directResult = await tryDirectCNA(cleanOab, uf);
    if (directResult) {
      console.log(`Found via direct CNA: ${directResult.nome}`);
      return new Response(
        JSON.stringify(directResult),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Strategy 3: Firecrawl scrape of CNA page
    if (firecrawlKey) {
      const scrapeResult = await scrapeCnaViaFirecrawl(cleanOab, uf, firecrawlKey);
      if (scrapeResult) {
        console.log(`Found via Firecrawl scrape: ${scrapeResult.nome}`);
        return new Response(
          JSON.stringify(scrapeResult),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    console.log(`OAB ${cleanOab}/${uf} not found by any strategy`);
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
 * Strategy 1: Use Firecrawl web search to find lawyer info
 */
async function searchOabViaFirecrawl(oab: string, uf: string, apiKey: string) {
  try {
    const ufName = UF_NAMES[uf] || uf;
    const query = `advogado OAB ${oab} ${uf} "${ufName}" nome cadastro`;
    console.log(`Firecrawl search: "${query}"`);

    const response = await fetch('https://api.firecrawl.dev/v1/search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        limit: 5,
        lang: 'pt-br',
        country: 'br',
      }),
    });

    if (!response.ok) {
      console.error(`Firecrawl search failed: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const results = data?.data || data?.results || [];
    console.log(`Firecrawl search returned ${results.length} results`);

    // Look through search results for lawyer name
    for (const result of results) {
      const text = [
        result.title || '',
        result.description || '',
        result.markdown || '',
        result.content || '',
      ].join(' ');

      const name = extractLawyerName(text, oab, uf);
      if (name) {
        return {
          nome: name.toUpperCase(),
          status: 'ativo' as const,
          inscricao: oab,
          uf,
        };
      }
    }

    return null;
  } catch (error) {
    console.error('Firecrawl search error:', error);
    return null;
  }
}

/**
 * Strategy 2: Direct CNA API call
 */
async function tryDirectCNA(oab: string, uf: string) {
  try {
    const searchUrl = `https://cna.oab.org.br/Home/Search?NomeAdvo=&Insc=${oab}&Uf=${uf}`;
    console.log(`Trying direct CNA: ${searchUrl}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const directResponse = await fetch(searchUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://cna.oab.org.br/',
        'Origin': 'https://cna.oab.org.br',
      },
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (directResponse.ok) {
      const text = await directResponse.text();
      console.log(`CNA response: status=${directResponse.status}, len=${text.length}`);
      return parseCNAJson(text, oab, uf);
    }

    console.log(`CNA response status: ${directResponse.status}`);
  } catch (error) {
    console.error('Direct CNA error:', (error as Error).message);
  }
  return null;
}

/**
 * Strategy 3: Firecrawl scrape of CNA search page
 */
async function scrapeCnaViaFirecrawl(oab: string, uf: string, apiKey: string) {
  try {
    const url = `https://cna.oab.org.br/Home/Search?NomeAdvo=&Insc=${oab}&Uf=${uf}`;
    console.log(`Firecrawl scrape: ${url}`);

    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        formats: ['markdown'],
        onlyMainContent: false,
        waitFor: 5000,
      }),
    });

    const data = await response.json();
    const markdown = data?.data?.markdown || data?.markdown || '';
    console.log(`Firecrawl scrape response: status=${response.status}, len=${markdown.length}`);

    if (!markdown || markdown.length < 10) return null;

    // Try JSON extraction from markdown
    const jsonMatch = markdown.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      const parsed = parseCNAJson(jsonMatch[1].trim(), oab, uf);
      if (parsed) return parsed;
    }

    // Try text extraction
    return extractFromMarkdown(markdown, oab, uf);
  } catch (error) {
    console.error('Firecrawl scrape error:', error);
  }
  return null;
}

/**
 * Extract lawyer name from text using multiple patterns
 */
function extractLawyerName(text: string, oab: string, _uf: string): string | null {
  if (!text) return null;

  // Pattern: Name near OAB number reference
  const patterns = [
    // "Nome: FULL NAME"
    /Nome[:\s]+([A-ZÀ-ÖØ-Ýa-zà-öø-ý\s]{5,100})/i,
    // "FULL NAME - OAB/UF 12345" or "FULL NAME (OAB 12345)"
    new RegExp(`([A-ZÀ-ÖØ-Ý][A-ZÀ-ÖØ-Ý\\s]{4,80})\\s*[-–(]\\s*OAB[/\\s]*\\w{2}[\\s:]*${oab}`, 'i'),
    // "OAB/UF 12345 - FULL NAME"
    new RegExp(`OAB[/\\s]*\\w{2}[\\s:]*${oab}\\s*[-–)]?\\s*([A-ZÀ-ÖØ-Ý][A-ZÀ-ÖØ-Ý\\s]{4,80})`, 'i'),
    // JSON-like: "Nome": "VALUE"
    /"Nome"\s*:\s*"([^"]{5,100})"/i,
    // "Dr./Dra. FULL NAME"
    /(?:Dr\.?a?|Adv\.?)\s+([A-ZÀ-ÖØ-Ý][A-ZÀ-ÖØ-Ýa-zà-öø-ý\s]{4,80})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const candidate = match[1].trim().replace(/\s+/g, ' ');
      // Must have at least 2 words (first + last name)
      if (candidate.length >= 5 && candidate.split(/\s+/).length >= 2) {
        // Clean trailing common words
        const cleaned = candidate.replace(/\s+(OAB|Advogad[oa]|Inscri[çc][ãa]o|Seccional|Conselho).*$/i, '').trim();
        if (cleaned.split(/\s+/).length >= 2) {
          return cleaned;
        }
      }
    }
  }

  return null;
}

function parseCNAJson(text: string, oab: string, uf: string) {
  try {
    const cnaData = JSON.parse(text);
    if (cnaData.Success && cnaData.Data && cnaData.Data.length > 0) {
      const lawyer = cnaData.Data[0];
      console.log(`CNA JSON found: ${lawyer.Nome} (${lawyer.TipoInscOab})`);
      return {
        nome: lawyer.Nome?.toUpperCase() || null,
        status: 'ativo' as const,
        inscricao: lawyer.Inscricao || oab,
        uf: lawyer.UF || uf,
        tipo: lawyer.TipoInscOab || null,
      };
    }
  } catch {
    // Not valid JSON
  }
  return null;
}

function extractFromMarkdown(text: string, oab: string, uf: string) {
  const name = extractLawyerName(text, oab, uf);
  if (name) {
    return {
      nome: name.toUpperCase(),
      status: 'ativo' as const,
      inscricao: oab,
      uf,
    };
  }
  return null;
}
