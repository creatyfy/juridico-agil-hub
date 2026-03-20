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

    // Strategy 1: Official CNA endpoint (form POST)
    const directResult = await tryDirectCNA(cleanOab, uf);
    if (directResult) {
      console.log(`Found via CNA official endpoint: ${directResult.nome}`);
      return new Response(
        JSON.stringify(directResult),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Strategy 2: Strict Firecrawl search (must match exact OAB/UF pair)
    if (firecrawlKey) {
      const searchResult = await searchOabViaFirecrawl(cleanOab, uf, firecrawlKey);
      if (searchResult) {
        console.log(`Found via strict Firecrawl search: ${searchResult.nome}`);
        return new Response(
          JSON.stringify(searchResult),
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
 * Strategy 2: Firecrawl search with strict OAB/UF matching to avoid false positives
 */
async function searchOabViaFirecrawl(oab: string, uf: string, apiKey: string) {
  try {
    const queries = [
      `"${oab}/${uf}" advogado`,
      `"OAB/${uf}" "${oab}" advogado`,
      `"${oab}" "${uf}" "OAB" advogado`,
    ];

    for (const query of queries) {
      console.log(`Firecrawl strict search: "${query}"`);

      const response = await fetch('https://api.firecrawl.dev/v1/search', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          limit: 10,
          lang: 'pt-br',
          country: 'br',
        }),
      });

      if (!response.ok) {
        console.error(`Firecrawl search failed: ${response.status}`);
        continue;
      }

      const data = await response.json();
      const results = data?.data || data?.results || [];
      console.log(`Firecrawl strict search returned ${results.length} results`);

      for (const result of results) {
        const text = [
          result.title || '',
          result.description || '',
          result.markdown || '',
          result.content || '',
        ].join('\n');

        if (!containsExactOabUf(text, oab, uf)) {
          continue;
        }

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
    }

    return null;
  } catch (error) {
    console.error('Firecrawl strict search error:', error);
    return null;
  }
}

/**
 * Strategy 1: Official CNA endpoint flow (GET form + POST search)
 */
async function tryDirectCNA(oab: string, uf: string) {
  try {
    const baseUrl = 'https://cna.oab.org.br/';
    const searchUrl = 'https://cna.oab.org.br/Home/Search';
    console.log(`Trying CNA official flow: ${searchUrl}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    const pageResponse = await fetch(baseUrl, {
      method: 'GET',
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      signal: controller.signal,
    });

    const pageHtml = await pageResponse.text();
    const tokenMatch = pageHtml.match(/name="__RequestVerificationToken"[^>]*value="([^"]+)"/i);
    const verificationToken = tokenMatch?.[1] ?? '';

    if (!verificationToken) {
      clearTimeout(timeout);
      console.log('CNA token not found, skipping direct flow');
      return null;
    }

    const formData = new URLSearchParams({
      __RequestVerificationToken: verificationToken,
      NomeAdvo: '',
      Insc: oab,
      Uf: uf,
      TipoInsc: '',
    });

    const searchResponse = await fetch(searchUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      body: formData.toString(),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const text = await searchResponse.text();
    if (searchResponse.ok) {
      const parsed = parseCNAJson(text, oab, uf);
      if (parsed) return parsed;

      try {
        const cnaResponse = JSON.parse(text);
        if (cnaResponse?.Message) {
          console.log(`CNA message: ${cnaResponse.Message}`);
        }
      } catch {
        // ignore
      }
    }

    console.log(`CNA response status: ${searchResponse.status}`);
  } catch (error) {
    console.error('Direct CNA error:', (error as Error).message);
  }
  return null;
}

function normalizeTextForMatch(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function containsExactOabUf(text: string, oab: string, uf: string) {
  const normalizedText = normalizeTextForMatch(text);
  const cleanOab = oab.replace(/\D/g, '');
  const cleanUf = uf.toUpperCase();

  const patterns = [
    new RegExp(`\\b${cleanOab}\\s*/\\s*${cleanUf}\\b`, 'i'),
    new RegExp(`\\bOAB\\s*/?\\s*${cleanUf}\\s*[:\\-]?\\s*${cleanOab}\\b`, 'i'),
    new RegExp(`\\bINSCRICAO\\s*[:\\-]?\\s*${cleanOab}[\\s\\S]{0,60}\\bUF\\s*[:\\-]?\\s*${cleanUf}\\b`, 'i'),
  ];

  return patterns.some((pattern) => pattern.test(normalizedText));
}

/**
 * Extract lawyer name from text using patterns tied to the exact UF/OAB pair
 */
function extractLawyerName(text: string, oab: string, uf: string): string | null {
  if (!text) return null;

  const cleanUf = uf.toUpperCase();
  const cleanOab = oab.replace(/\D/g, '');

  const patterns = [
    /Nome[:\s]+([A-ZÀ-ÖØ-Ýa-zà-öø-ý\s]{5,100})/i,
    new RegExp(`([A-ZÀ-ÖØ-Ý][A-ZÀ-ÖØ-Ýa-zà-öø-ý\\s]{4,80})\\s*[-–(]\\s*OAB\\s*[/\\s]*${cleanUf}\\s*[:\\-]?\\s*${cleanOab}`, 'i'),
    new RegExp(`OAB\\s*[/\\s]*${cleanUf}\\s*[:\\-]?\\s*${cleanOab}\\s*[-–)]?\\s*([A-ZÀ-ÖØ-Ý][A-ZÀ-ÖØ-Ýa-zà-öø-ý\\s]{4,80})`, 'i'),
    new RegExp(`([A-ZÀ-ÖØ-Ý][A-ZÀ-ÖØ-Ýa-zà-öø-ý\\s]{4,80})[^\\n]{0,80}\\(${cleanOab}\\s*/\\s*${cleanUf}\\)`, 'i'),
    /"Nome"\s*:\s*"([^"]{5,100})"/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;

    const candidate = match[1].trim().replace(/\s+/g, ' ');
    if (candidate.length < 5 || candidate.split(/\s+/).length < 2) continue;

    const cleaned = candidate
      .replace(/\s+(OAB|Advogad[oa]|Inscri[çc][ãa]o|Seccional|Conselho).*$/i, '')
      .trim();

    if (cleaned.split(/\s+/).length >= 2) {
      return cleaned;
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
