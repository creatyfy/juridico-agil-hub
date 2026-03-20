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

    // Strategy 1: Judit API — synchronous Hot Storage lookup by OAB
    const juditResult = await tryJuditOab(cleanOab, uf);
    if (juditResult) {
      console.log(`Found via Judit API: ${juditResult.nome}`);
      return new Response(
        JSON.stringify(juditResult),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Strategy 2: Official CNA endpoint (fallback)
    const cnaResult = await tryDirectCNA(cleanOab, uf);
    if (cnaResult) {
      console.log(`Found via CNA official endpoint: ${cnaResult.nome}`);
      return new Response(
        JSON.stringify(cnaResult),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
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
 * Strategy 1: Judit Hot Storage — synchronous OAB lookup
 * Returns lawsuit data with party info, from which we extract the lawyer name.
 */
async function tryJuditOab(oab: string, uf: string) {
  const apiKey = Deno.env.get('JUDIT_API_KEY');
  if (!apiKey) {
    console.log('JUDIT_API_KEY not configured, skipping Judit strategy');
    return null;
  }

  try {
    // Format: "15039/AM" — Judit expects OAB with UF suffix
    const searchKey = `${oab}/${uf}`;
    console.log(`Judit Hot Storage lookup: ${searchKey}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch('https://lawsuits.production.judit.io/lawsuits', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify({
        search: {
          search_type: 'oab',
          search_key: searchKey,
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const text = await response.text();

    if (!response.ok) {
      console.error(`Judit Hot Storage error [${response.status}]: ${text.slice(0, 300)}`);
      // If Hot Storage fails, try the async requests endpoint as fallback
      return await tryJuditAsyncOab(oab, uf, apiKey);
    }

    const data = JSON.parse(text);
    console.log(`Judit Hot Storage response keys: ${JSON.stringify(Object.keys(data))}`);

    // Extract lawyer name from the response
    const lawyerName = extractLawyerFromJudit(data, oab, uf);
    if (lawyerName) {
      return {
        nome: lawyerName.toUpperCase(),
        status: 'ativo' as const,
        inscricao: oab,
        uf,
        fonte: 'judit',
      };
    }

    console.log('Judit returned data but could not extract lawyer name');
    return null;
  } catch (error) {
    console.error('Judit Hot Storage error:', (error as Error).message);
    // Fallback to async endpoint
    try {
      return await tryJuditAsyncOab(oab, uf, Deno.env.get('JUDIT_API_KEY')!);
    } catch {
      return null;
    }
  }
}

/**
 * Judit async requests endpoint — creates a request and polls for result
 */
async function tryJuditAsyncOab(oab: string, uf: string, apiKey: string) {
  try {
    const searchKey = `${oab}/${uf}`;
    console.log(`Judit async request: ${searchKey}`);

    // Create request
    const createResponse = await fetch('https://requests.prod.judit.io/requests', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify({
        search: {
          search_type: 'oab',
          search_key: searchKey,
          response_type: 'lawsuits',
        },
      }),
    });

    if (!createResponse.ok) {
      const errText = await createResponse.text();
      console.error(`Judit create request failed [${createResponse.status}]: ${errText.slice(0, 300)}`);
      return null;
    }

    const createData = await createResponse.json();
    const requestId = createData?.request_id;
    if (!requestId) {
      console.error('Judit returned no request_id');
      return null;
    }

    console.log(`Judit request created: ${requestId}, polling...`);

    // Poll for completion (max 12 seconds, every 2 seconds)
    for (let attempt = 0; attempt < 6; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 2000));

      const statusResponse = await fetch(`https://requests.prod.judit.io/requests/${requestId}`, {
        headers: { 'api-key': apiKey },
      });

      if (!statusResponse.ok) {
        await statusResponse.text();
        continue;
      }

      const statusData = await statusResponse.json();
      console.log(`Judit request ${requestId} status: ${statusData?.status}`);

      if (statusData?.status === 'done' || statusData?.status === 'completed') {
        // Fetch results
        const resultsResponse = await fetch(
          `https://requests.prod.judit.io/responses?request_id=${requestId}&page=1&page_size=5`,
          { headers: { 'api-key': apiKey } }
        );

        if (!resultsResponse.ok) {
          await resultsResponse.text();
          return null;
        }

        const resultsData = await resultsResponse.json();
        const lawyerName = extractLawyerFromJuditResults(resultsData, oab, uf);
        if (lawyerName) {
          return {
            nome: lawyerName.toUpperCase(),
            status: 'ativo' as const,
            inscricao: oab,
            uf,
            fonte: 'judit',
          };
        }
        return null;
      }

      if (statusData?.status === 'error' || statusData?.status === 'failed') {
        console.error(`Judit request failed: ${statusData?.status}`);
        return null;
      }
    }

    console.log('Judit polling timeout');
    return null;
  } catch (error) {
    console.error('Judit async error:', (error as Error).message);
    return null;
  }
}

/**
 * Extract lawyer name from Judit Hot Storage response.
 * The response contains lawsuit data with parties — find the lawyer matching the OAB.
 */
function extractLawyerFromJudit(data: Record<string, unknown>, oab: string, uf: string): string | null {
  try {
    // Hot Storage can return different structures
    // Check for direct lawyer info
    if (data.name && typeof data.name === 'string') {
      return data.name;
    }

    // Check lawsuits array
    const lawsuits = (data.lawsuits || data.data || data.page_data || []) as Record<string, unknown>[];
    if (!Array.isArray(lawsuits) || lawsuits.length === 0) {
      // Maybe data itself is a lawsuit
      const name = extractNameFromLawsuit(data, oab, uf);
      if (name) return name;
      return null;
    }

    // Search across lawsuits for the lawyer name
    const candidateNames = new Map<string, number>();

    for (const lawsuit of lawsuits.slice(0, 20)) {
      const responseData = (lawsuit as Record<string, unknown>).response_data as Record<string, unknown> || lawsuit;
      const name = extractNameFromLawsuit(responseData, oab, uf);
      if (name) {
        const normalized = name.toUpperCase().replace(/\s+/g, ' ').trim();
        candidateNames.set(normalized, (candidateNames.get(normalized) || 0) + 1);
      }
    }

    if (candidateNames.size > 0) {
      // Return most frequent name
      const sorted = [...candidateNames.entries()].sort((a, b) => b[1] - a[1]);
      console.log(`Judit candidates: ${JSON.stringify(sorted.slice(0, 3))}`);
      return sorted[0][0];
    }

    return null;
  } catch (error) {
    console.error('Error extracting lawyer from Judit:', (error as Error).message);
    return null;
  }
}

/**
 * Extract lawyer name from a single Judit lawsuit object
 */
function extractNameFromLawsuit(lawsuit: Record<string, unknown>, oab: string, uf: string): string | null {
  // Check parties/lawyers arrays
  const parties = (lawsuit.parties || lawsuit.partes || []) as Record<string, unknown>[];
  const lawyers = (lawsuit.lawyers || lawsuit.advogados || []) as Record<string, unknown>[];

  // Search in lawyers array first
  for (const lawyer of lawyers) {
    const lawyerOab = String(lawyer.oab || lawyer.inscription || lawyer.inscricao || '').replace(/\D/g, '');
    const lawyerUf = String(lawyer.uf || lawyer.state || '').toUpperCase();
    const lawyerName = String(lawyer.name || lawyer.nome || '');

    if (lawyerOab === oab && (lawyerUf === uf || !lawyerUf) && lawyerName.length >= 5) {
      return lawyerName;
    }
  }

  // Search in parties for lawyer sub-entries
  for (const party of parties) {
    const partyLawyers = (party.lawyers || party.advogados || party.attorneys || []) as Record<string, unknown>[];
    for (const lawyer of partyLawyers) {
      const lawyerOab = String(lawyer.oab || lawyer.inscription || lawyer.inscricao || '').replace(/\D/g, '');
      const lawyerUf = String(lawyer.uf || lawyer.state || '').toUpperCase();
      const lawyerName = String(lawyer.name || lawyer.nome || '');

      if (lawyerOab === oab && (lawyerUf === uf || !lawyerUf) && lawyerName.length >= 5) {
        return lawyerName;
      }
    }
  }

  // Check last_step or steps for party data
  const lastStep = lawsuit.last_step as Record<string, unknown> | undefined;
  if (lastStep) {
    const stepParties = (lastStep.parties || lastStep.partes || []) as Record<string, unknown>[];
    for (const party of stepParties) {
      const partyLawyers = (party.lawyers || party.advogados || party.attorneys || []) as Record<string, unknown>[];
      for (const lawyer of partyLawyers) {
        const lawyerOab = String(lawyer.oab || lawyer.inscription || lawyer.inscricao || '').replace(/\D/g, '');
        const lawyerUf = String(lawyer.uf || lawyer.state || '').toUpperCase();
        const lawyerName = String(lawyer.name || lawyer.nome || '');

        if (lawyerOab === oab && (lawyerUf === uf || !lawyerUf) && lawyerName.length >= 5) {
          return lawyerName;
        }
      }
    }
  }

  // Deep search in stringified data for OAB pattern
  const jsonStr = JSON.stringify(lawsuit);
  const oabPattern = new RegExp(`"(?:oab|inscription|inscricao)"\\s*:\\s*"?${oab}"?`, 'i');
  if (oabPattern.test(jsonStr)) {
    // OAB is present, try to find the name near it
    const nameMatch = jsonStr.match(new RegExp(`"(?:name|nome)"\\s*:\\s*"([^"]{5,100})"[^}]{0,200}"(?:oab|inscription|inscricao)"\\s*:\\s*"?${oab}"?`, 'i'))
      || jsonStr.match(new RegExp(`"(?:oab|inscription|inscricao)"\\s*:\\s*"?${oab}"?[^}]{0,200}"(?:name|nome)"\\s*:\\s*"([^"]{5,100})"`, 'i'));
    if (nameMatch?.[1]) {
      return nameMatch[1];
    }
  }

  return null;
}

/**
 * Extract lawyer name from Judit async results (paginated responses)
 */
function extractLawyerFromJuditResults(data: Record<string, unknown>, oab: string, uf: string): string | null {
  const pageData = (data.page_data || data.data || []) as Record<string, unknown>[];
  if (!Array.isArray(pageData) || pageData.length === 0) return null;

  const candidateNames = new Map<string, number>();

  for (const item of pageData.slice(0, 20)) {
    const responseData = item.response_data as Record<string, unknown> || item;
    const name = extractNameFromLawsuit(responseData, oab, uf);
    if (name) {
      const normalized = name.toUpperCase().replace(/\s+/g, ' ').trim();
      candidateNames.set(normalized, (candidateNames.get(normalized) || 0) + 1);
    }
  }

  if (candidateNames.size > 0) {
    const sorted = [...candidateNames.entries()].sort((a, b) => b[1] - a[1]);
    return sorted[0][0];
  }

  return null;
}

/**
 * Strategy 2: Official CNA endpoint flow (GET form + POST search)
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
    }

    console.log(`CNA response status: ${searchResponse.status}`);
  } catch (error) {
    console.error('Direct CNA error:', (error as Error).message);
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
        fonte: 'cna',
      };
    }
  } catch {
    // Not valid JSON
  }
  return null;
}
