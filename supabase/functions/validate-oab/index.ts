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
    const apiKey = Deno.env.get('FIRECRAWL_API_KEY');

    console.log(`Validating OAB ${cleanOab}/${uf}...`);

    const result = await queryCNA(cleanOab, uf, apiKey);
    if (result) {
      console.log(`Result: ${result.nome} - ${result.status}`);
      return new Response(
        JSON.stringify(result),
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
 * Query CNA (cna.oab.org.br) - tries direct API call first, then Firecrawl fallback.
 */
async function queryCNA(oab: string, uf: string, firecrawlKey?: string) {
  const searchUrl = `https://cna.oab.org.br/Home/Search?NomeAdvo=&Insc=${oab}&Uf=${uf}`;

  // Attempt 1: Direct fetch to CNA API
  try {
    console.log(`Querying CNA directly: ${searchUrl}`);
    const directResponse = await fetch(searchUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://cna.oab.org.br/',
      },
    });

    if (directResponse.ok) {
      const text = await directResponse.text();
      console.log(`CNA direct response: status=${directResponse.status}, len=${text.length}`);

      const parsed = parseCNAJson(text, oab, uf);
      if (parsed) return parsed;

      console.log('CNA direct response was not valid JSON or had no results');
    } else {
      console.log(`CNA direct response failed: ${directResponse.status}`);
    }
  } catch (error) {
    console.error('Direct CNA fetch error:', error);
  }

  // Attempt 2: Firecrawl scrape fallback
  if (!firecrawlKey) {
    console.log('No Firecrawl API key, skipping fallback');
    return null;
  }

  try {
    console.log('Using Firecrawl fallback...');
    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${firecrawlKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: searchUrl,
        formats: ['markdown'],
        onlyMainContent: false,
        waitFor: 5000,
      }),
    });

    const data = await response.json();
    const markdown = data?.data?.markdown || data?.markdown || '';
    console.log(`Firecrawl response: status=${response.status}, len=${markdown.length}`);

    if (!markdown || markdown.length < 10) return null;

    // Try extracting JSON from markdown code block
    const jsonMatch = markdown.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonStr = jsonMatch ? jsonMatch[1].trim() : markdown;

    const parsed = parseCNAJson(jsonStr, oab, uf);
    if (parsed) return parsed;

    // Last resort: regex extraction
    return extractFromText(markdown, oab, uf);
  } catch (error) {
    console.error('Firecrawl fallback error:', error);
  }

  return null;
}

function parseCNAJson(text: string, oab: string, uf: string) {
  try {
    const cnaData = JSON.parse(text);
    if (cnaData.Success && cnaData.Data && cnaData.Data.length > 0) {
      const lawyer = cnaData.Data[0];
      console.log(`CNA found: ${lawyer.Nome} (${lawyer.TipoInscOab})`);
      return {
        nome: lawyer.Nome?.toUpperCase() || null,
        status: 'ativo' as const,
        inscricao: lawyer.Inscricao || oab,
        uf: lawyer.UF || uf,
        tipo: lawyer.TipoInscOab || null,
      };
    }
    if (cnaData.Success) {
      console.log('CNA returned Success but empty Data');
    }
  } catch {
    // Not valid JSON
  }
  return null;
}

function extractFromText(text: string, oab: string, uf: string) {
  const namePatterns = [
    /Nome:\s*([A-ZÀ-ÖØ-Ýa-zà-öø-ý\s]{5,100})/i,
    /"Nome"\s*:\s*"([^"]{5,100})"/i,
  ];

  for (const pattern of namePatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const candidate = match[1].trim().replace(/\s+/g, ' ');
      if (candidate.length >= 5 && candidate.split(/\s+/).length >= 2) {
        return {
          nome: candidate.toUpperCase(),
          status: 'ativo' as const,
          inscricao: oab,
          uf,
        };
      }
    }
  }
  return null;
}
