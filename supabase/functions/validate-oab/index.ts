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

    console.log(`Consulting OAB ${oab}/${uf}...`);

    // Try the CNA SOAP web service with SOAP 1.1
    const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <ConsultaAdvogado xmlns="http://tempuri.org/">
      <inscricao>${String(oab).replace(/[^0-9]/g, '')}</inscricao>
      <uf>${uf}</uf>
      <nome></nome>
    </ConsultaAdvogado>
  </soap:Body>
</soap:Envelope>`;

    let xmlText = '';
    let soapSuccess = false;

    try {
      const response = await fetch('https://www5.oab.org.br/cnaws/service.asmx', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          'SOAPAction': 'http://tempuri.org/ConsultaAdvogado',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        body: soapBody,
      });

      xmlText = await response.text();
      console.log(`SOAP response status: ${response.status}, body length: ${xmlText.length}`);
      console.log(`SOAP response (first 500 chars): ${xmlText.substring(0, 500)}`);
      soapSuccess = response.ok;
    } catch (soapError) {
      console.error('SOAP request failed:', soapError);
    }

    if (soapSuccess && xmlText.length > 0) {
      // Parse the SOAP XML response
      const nomeMatch = xmlText.match(/<Nome>(.*?)<\/Nome>/i);
      const situacaoMatch = xmlText.match(/<Situacao>(.*?)<\/Situacao>/i) ||
                            xmlText.match(/<SituacaoInscricao>(.*?)<\/SituacaoInscricao>/i) ||
                            xmlText.match(/<TipoInscricao>(.*?)<\/TipoInscricao>/i);

      if (nomeMatch && nomeMatch[1] && nomeMatch[1].trim()) {
        const nome = nomeMatch[1].trim().toUpperCase();
        const situacaoRaw = situacaoMatch ? situacaoMatch[1].trim().toLowerCase() : '';

        let status: 'ativo' | 'inativo' | 'nao_encontrado' = 'ativo';
        if (situacaoRaw.includes('cancel') || situacaoRaw.includes('suspens') ||
            situacaoRaw.includes('licencia') || situacaoRaw.includes('inativ') ||
            situacaoRaw.includes('exclu')) {
          status = 'inativo';
        }

        console.log(`Found: ${nome} - ${status}`);
        return new Response(
          JSON.stringify({ nome, status, inscricao: oab, uf }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Check for fault or empty result
      if (xmlText.includes('Fault') || xmlText.includes('nenhum') || xmlText.includes('Nenhum')) {
        return new Response(
          JSON.stringify({ nome: null, status: 'nao_encontrado' }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Try to extract from ConsultaAdvogadoResult
      const resultMatch = xmlText.match(/<ConsultaAdvogadoResult>([\s\S]*?)<\/ConsultaAdvogadoResult>/i);
      if (resultMatch && resultMatch[1]) {
        console.log(`Result XML: ${resultMatch[1].substring(0, 300)}`);
        // Try to find any name-like element
        const anyName = resultMatch[1].match(/<[^>]*>([\p{L}\s]{5,})<\/[^>]*>/u);
        if (anyName && anyName[1].trim()) {
          return new Response(
            JSON.stringify({ nome: anyName[1].trim().toUpperCase(), status: 'ativo', inscricao: oab, uf }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }
    }

    // If SOAP failed, try alternative CNA search endpoint  
    try {
      console.log('Trying alternative CNA search...');
      const searchUrl = `https://cna.oab.org.br/Home/Search`;
      const formData = new URLSearchParams();
      formData.append('IsMobile', 'false');
      formData.append('NomeAdvo', '');
      formData.append('Inscricao', String(oab).replace(/[^0-9]/g, ''));
      formData.append('Uf', uf);
      formData.append('TipoInsc', 'A'); // A = Advogado

      const searchResponse = await fetch(searchUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Referer': 'https://cna.oab.org.br/',
          'Origin': 'https://cna.oab.org.br',
        },
        body: formData.toString(),
      });

      const htmlText = await searchResponse.text();
      console.log(`CNA search status: ${searchResponse.status}, body length: ${htmlText.length}`);
      console.log(`CNA search response (first 500 chars): ${htmlText.substring(0, 500)}`);

      // Try to parse name and status from HTML
      const nameHtmlMatch = htmlText.match(/class="[^"]*nome[^"]*"[^>]*>([^<]+)</i) ||
                            htmlText.match(/<td[^>]*>([A-ZÀ-ÖØ-Ý\s]{5,})<\/td>/);
      const statusHtmlMatch = htmlText.match(/class="[^"]*situacao[^"]*"[^>]*>([^<]+)</i) ||
                              htmlText.match(/Regular|Ativ[ao]|Suspens[ao]|Cancel/i);

      if (nameHtmlMatch && nameHtmlMatch[1].trim()) {
        const nome = nameHtmlMatch[1].trim().toUpperCase();
        const statusRaw = statusHtmlMatch ? 
          (typeof statusHtmlMatch[1] === 'string' ? statusHtmlMatch[1] : statusHtmlMatch[0]).toLowerCase() : '';
        
        let status: 'ativo' | 'inativo' | 'nao_encontrado' = 'ativo';
        if (statusRaw.includes('cancel') || statusRaw.includes('suspens') || 
            statusRaw.includes('inativ') || statusRaw.includes('exclu')) {
          status = 'inativo';
        }

        console.log(`Found via search: ${nome} - ${status}`);
        return new Response(
          JSON.stringify({ nome, status, inscricao: oab, uf }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    } catch (searchError) {
      console.error('CNA search failed:', searchError);
    }

    // All methods failed
    return new Response(
      JSON.stringify({ 
        nome: null, 
        status: 'nao_encontrado',
        message: 'Não foi possível validar a OAB. O serviço do CNA pode estar temporariamente indisponível.' 
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Error in validate-oab:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ 
        nome: null, 
        status: 'nao_encontrado',
        message: `Erro ao consultar OAB: ${errorMessage}` 
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
