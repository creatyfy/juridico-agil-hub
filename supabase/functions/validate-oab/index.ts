import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

const validUFs = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT',
  'PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];

// Mock database of lawyers for realistic simulation
// In production, replace with actual CNA API integration (requires authentication key)
const mockLawyers: Record<string, { nome: string; status: 'ativo' | 'inativo'; tipo: string }> = {
  // SP
  '123456-SP': { nome: 'CARLOS EDUARDO MENDES DA SILVA', status: 'ativo', tipo: 'Advogado' },
  '654321-SP': { nome: 'ANA BEATRIZ RODRIGUES FERREIRA', status: 'ativo', tipo: 'Advogado' },
  '111111-SP': { nome: 'MARCOS ANTONIO PEREIRA LIMA', status: 'inativo', tipo: 'Advogado' },
  '222222-SP': { nome: 'JULIANA CRISTINA ALMEIDA SANTOS', status: 'ativo', tipo: 'Advogado' },
  '333333-SP': { nome: 'ROBERTO CARLOS OLIVEIRA NETO', status: 'ativo', tipo: 'Advogado' },
  // RJ
  '100200-RJ': { nome: 'FERNANDA LUIZA COSTA BARBOSA', status: 'ativo', tipo: 'Advogado' },
  '200300-RJ': { nome: 'RICARDO AUGUSTO MARTINS FILHO', status: 'ativo', tipo: 'Advogado' },
  '300400-RJ': { nome: 'PATRICIA HELENA SOUZA MOREIRA', status: 'inativo', tipo: 'Advogado' },
  // MG
  '26785-MG': { nome: 'LUCAS FERNANDO ARAÚJO RIBEIRO', status: 'ativo', tipo: 'Advogado' },
  '50100-MG': { nome: 'MARIA CLARA DUARTE TEIXEIRA', status: 'ativo', tipo: 'Advogado' },
  '75300-MG': { nome: 'JOÃO PEDRO CARVALHO MACHADO', status: 'ativo', tipo: 'Advogado' },
  // DF
  '10500-DF': { nome: 'CAMILA ANDRADE NOGUEIRA', status: 'ativo', tipo: 'Advogado' },
  '20800-DF': { nome: 'THIAGO HENRIQUE BATISTA LOPES', status: 'ativo', tipo: 'Advogado' },
  // RS
  '45000-RS': { nome: 'GABRIELA SOUZA FONTANA', status: 'ativo', tipo: 'Advogado' },
  '60200-RS': { nome: 'DIEGO RAFAEL WAGNER SCHMIDT', status: 'inativo', tipo: 'Advogado' },
  // BA
  '30100-BA': { nome: 'ANDERSON LUIS NASCIMENTO SANTOS', status: 'ativo', tipo: 'Advogado' },
  // PR
  '40500-PR': { nome: 'RAFAELA CRISTINA MENDONÇA PRADO', status: 'ativo', tipo: 'Advogado' },
  // PE
  '15700-PE': { nome: 'BRUNO HENRIQUE CAVALCANTI SILVA', status: 'ativo', tipo: 'Advogado' },
  // CE
  '25300-CE': { nome: 'LARISSA MARIA FREITAS GOMES', status: 'ativo', tipo: 'Advogado' },
  // GO
  '35600-GO': { nome: 'FELIPE AUGUSTO BORGES CUNHA', status: 'ativo', tipo: 'Advogado' },
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
    const key = `${cleanOab}-${uf}`;

    console.log(`Validating OAB ${cleanOab}/${uf}...`);

    // Simulate network delay (realistic API response time)
    await new Promise(r => setTimeout(r, 800 + Math.random() * 700));

    const lawyer = mockLawyers[key];

    if (lawyer) {
      console.log(`Found: ${lawyer.nome} - ${lawyer.status}`);
      return new Response(
        JSON.stringify({
          nome: lawyer.nome,
          status: lawyer.status,
          inscricao: cleanOab,
          uf,
          tipo: lawyer.tipo,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Not found in mock database
    console.log(`OAB ${cleanOab}/${uf} not found`);
    return new Response(
      JSON.stringify({ nome: null, status: 'nao_encontrado' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Error in validate-oab:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({
        nome: null,
        status: 'nao_encontrado',
        message: `Erro ao consultar OAB: ${errorMessage}`,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
