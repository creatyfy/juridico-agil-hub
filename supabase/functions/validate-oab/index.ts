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

    // Strategy: Use Firecrawl Search to find the lawyer in public legal databases
    // and OAB-related pages that index lawyer data
    const searchQueries = [
      `"OAB ${cleanOab}" "${uf}" advogado nome site:jusbrasil.com.br OR site:escavador.com OR site:oab`,
      `advogado OAB/${uf} ${cleanOab} nome inscrição`,
    ];

    for (const query of searchQueries) {
      console.log(`Searching: ${query}`);
      
      const response = await fetch('https://api.firecrawl.dev/v1/search', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          limit: 5,
        }),
      });

      if (!response.ok) {
        console.error(`Search failed: ${response.status}`);
        continue;
      }

      const data = await response.json();
      const results = data.data || [];
      
      console.log(`Got ${results.length} search results`);

      for (const result of results) {
        const text = `${result.title || ''} ${result.description || ''} ${result.markdown || ''}`;
        console.log(`Result: ${result.url} - ${(result.title || '').substring(0, 100)}`);
        
        const parsed = extractLawyerFromSearchResult(text, cleanOab, uf);
        if (parsed) {
          console.log(`Found: ${parsed.nome} - ${parsed.status}`);
          return new Response(
            JSON.stringify(parsed),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }
    }

    // If search didn't find, try scraping Escavador which indexes OAB data publicly
    console.log('Trying Escavador...');
    const escavadorResult = await tryEscavador(apiKey, cleanOab, uf);
    if (escavadorResult) {
      return new Response(
        JSON.stringify(escavadorResult),
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

async function tryEscavador(apiKey: string, oab: string, uf: string) {
  try {
    // Escavador publicly indexes lawyer profiles
    const url = `https://www.escavador.com/sobre/advogado?oab=${oab}&estado=${uf}`;
    
    const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        formats: ['markdown'],
        onlyMainContent: true,
        waitFor: 2000,
      }),
    });

    const data = await response.json();
    const content = data.data || data;
    const markdown = content?.markdown || '';
    
    console.log(`Escavador response: ${response.status}, len=${markdown.length}`);
    if (markdown.length > 50) {
      console.log(`Escavador preview: ${markdown.substring(0, 500)}`);
    }

    if (markdown.length > 50) {
      return extractLawyerFromSearchResult(markdown, oab, uf);
    }
  } catch (error) {
    console.error('Escavador failed:', error);
  }
  return null;
}

function extractLawyerFromSearchResult(text: string, oab: string, uf: string) {
  if (!text || text.length < 10) return null;

  // Exclude false positive patterns
  const excludeWords = ['RESULTADO', 'CONSULTA', 'CADASTRO', 'PESQUISAR', 'IMPORTANTE',
    'PROVIMENTO', 'CONSELHO', 'NACIONAL', 'SECCIONAL', 'ORDEM', 'ADVOGADOS',
    'BRASIL', 'FEDERAL', 'INSCRITOS', 'NOTÍCIAS', 'SERVIÇOS', 'ARTIGO',
    'TRIBUNAL', 'JUDICIÁRIO', 'CONSTITUIÇÃO', 'JANEIRO', 'FEVEREIRO', 'MARÇO'];

  // Patterns to find lawyer name associated with OAB number
  const oabPattern = new RegExp(`OAB[/\\s]*(?:${uf})?[/\\s]*${oab}|${oab}[/\\s]*(?:OAB)?[/\\s]*${uf}`, 'i');
  
  if (!oabPattern.test(text)) {
    // Also check if just the number is mentioned in context
    if (!text.includes(oab)) return null;
  }

  // Try to find names near the OAB reference
  const namePatterns = [
    // "Dr./Dra. Name" or "Advogado(a) Name"
    /(?:Dr\.?|Dra\.?|Advogad[oa])\s+([A-ZÀ-ÖØ-Ý][a-zà-öø-ý]+(?:\s+(?:de|da|do|dos|das|e)?\s*[A-ZÀ-ÖØ-Ýa-zà-öø-ý]+){1,7})/,
    // ALL CAPS name (2+ words, 8-80 chars)  
    /([A-ZÀ-ÖØ-Ý][A-ZÀ-ÖØ-Ý\s\.]{7,79})/,
    // Title + name format from Escavador/JusBrasil
    /(?:Perfil|Nome|Advogad)[:\s]+([A-ZÀ-ÖØ-Ý][a-zà-öø-ý]+(?:\s+[A-Za-zÀ-ÖØ-Ýà-öø-ý]+){1,7})/i,
    // Name in heading
    /#{1,3}\s+([A-ZÀ-ÖØ-Ý][a-zà-öø-ý]+(?:\s+(?:de|da|do|dos|das|e)?\s*[A-ZÀ-ÖØ-Ýa-zà-öø-ý]+){1,7})/,
    // Bold name
    /\*\*([A-ZÀ-ÖØ-Ý][a-zà-öø-ý]+(?:\s+[A-Za-zÀ-ÖØ-Ýà-öø-ý]+){1,7})\*\*/,
  ];

  for (const pattern of namePatterns) {
    const matches = text.match(new RegExp(pattern.source, pattern.flags + 'g')) || [];
    
    for (const fullMatch of matches) {
      const nameMatch = fullMatch.match(pattern);
      if (!nameMatch || !nameMatch[1]) continue;
      
      let candidate = nameMatch[1].trim().replace(/\s+/g, ' ');
      const words = candidate.split(/\s+/);
      
      if (words.length >= 2 && candidate.length >= 8 && candidate.length <= 80) {
        const isExcluded = excludeWords.some(w => candidate.toUpperCase().includes(w));
        if (isExcluded) continue;

        // Determine status
        let status: 'ativo' | 'inativo' = 'ativo';
        const lower = text.toLowerCase();
        if (lower.includes('cancelad') || lower.includes('suspens') || 
            lower.includes('licenciad') || lower.includes('inativ') || 
            lower.includes('excluíd')) {
          // Check if "inativo" is near the OAB number context
          const oabIdx = lower.indexOf(oab);
          if (oabIdx >= 0) {
            const nearby = lower.substring(Math.max(0, oabIdx - 200), oabIdx + 200);
            if (nearby.includes('cancelad') || nearby.includes('suspens') || 
                nearby.includes('inativ')) {
              status = 'inativo';
            }
          }
        }

        // Clean prefixes from name
        let cleanName = candidate.toUpperCase()
          .replace(/^(ADVOGAD[OA]\s+|DR\.?\s+|DRA\.?\s+)/i, '')
          .trim();

        return {
          nome: cleanName,
          status,
          inscricao: oab,
          uf,
        };
      }
    }
  }

  return null;
}
