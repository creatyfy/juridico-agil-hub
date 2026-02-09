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

    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: 'Serviço de consulta não configurado' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Validating OAB ${cleanOab}/${uf}...`);

    const result = await queryCNA(apiKey, cleanOab, uf);
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
 * Query CNA (cna.oab.org.br) via Firecrawl scrape.
 * The CNA Search endpoint returns JSON when accessed via GET:
 * {"Success":true,"Data":[{"Nome":"...","TipoInscOab":"ADVOGADO","Inscricao":"...","UF":"..."}]}
 */
async function queryCNA(apiKey: string, oab: string, uf: string) {
  try {
    const searchUrl = `https://cna.oab.org.br/Home/Search?NomeAdvo=&Insc=${oab}&Uf=${uf}`;
    console.log(`Querying CNA: ${searchUrl}`);

    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: searchUrl,
        formats: ['markdown'],
        onlyMainContent: false,
        waitFor: 3000,
      }),
    });

    const data = await response.json();
    const content = data.data || data;
    const markdown = content?.markdown || '';

    console.log(`CNA response: ${response.status}, len=${markdown.length}`);

    if (!markdown || markdown.length < 10) {
      if (data.error) console.error('Firecrawl error:', JSON.stringify(data.error));
      return null;
    }

    // The CNA endpoint returns JSON wrapped in markdown code block
    // Extract the JSON from the markdown
    let jsonStr = markdown;
    
    // Remove markdown code block wrapper if present
    const jsonMatch = markdown.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    try {
      const cnaData = JSON.parse(jsonStr);
      
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
      
      console.log('CNA returned no results');
      return null;
    } catch {
      // Not JSON - try regex extraction
      console.log('CNA response not JSON, trying regex...');
      return extractFromText(markdown, oab, uf);
    }
  } catch (error) {
    console.error('CNA query failed:', error);
  }
  return null;
}

/**
 * Fallback: extract from text/HTML if JSON parsing fails
 */
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
