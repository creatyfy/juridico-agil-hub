import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const EVOLUTION_API_URL = Deno.env.get("EVOLUTION_API_URL")!;
const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY")!;

function evoHeaders() {
  return { "Content-Type": "application/json", apikey: EVOLUTION_API_KEY };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const svc = createClient(supabaseUrl, serviceKey);

    const body = await req.json();
    const { action, token } = body;

    // ─── FETCH: Validate token and return invite data ───
    if (action === "fetch") {
      if (!token) {
        return new Response(JSON.stringify({ error: "Token obrigatório" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: convite, error } = await svc
        .from("convites_vinculacao")
        .select("*, clientes(id, nome, documento, tipo_documento, numero_whatsapp, status_vinculo), processos(id, numero_cnj, classe, tribunal)")
        .eq("token", token)
        .maybeSingle();

      if (error || !convite) {
        return new Response(JSON.stringify({ error: "Convite não encontrado" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Check expiration
      if (new Date(convite.expiracao) < new Date()) {
        if (convite.status === "pendente") {
          await svc.from("convites_vinculacao").update({ status: "expirado" }).eq("id", convite.id);
        }
        return new Response(JSON.stringify({ error: "Convite expirado" }), {
          status: 410,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({
        convite: { id: convite.id, status: convite.status, expiracao: convite.expiracao },
        cliente: convite.clientes,
        processo: convite.processos,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── SEND-OTP: Send OTP via WhatsApp ───
    if (action === "send-otp") {
      const { convite_id, numero_whatsapp } = body;
      if (!convite_id || !numero_whatsapp) {
        return new Response(JSON.stringify({ error: "convite_id e numero_whatsapp são obrigatórios" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Clean phone number
      const cleanNumber = numero_whatsapp.replace(/\D/g, "");
      if (cleanNumber.length < 10 || cleanNumber.length > 13) {
        return new Response(JSON.stringify({ error: "Número de WhatsApp inválido" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Get convite
      const { data: convite } = await svc
        .from("convites_vinculacao")
        .select("id, cliente_id, status, expiracao, advogado_user_id")
        .eq("id", convite_id)
        .eq("status", "pendente")
        .single();

      if (!convite || new Date(convite.expiracao) < new Date()) {
        return new Response(JSON.stringify({ error: "Convite inválido ou expirado" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Check if number is already linked to another client
      const { data: existingClient } = await svc
        .from("clientes")
        .select("id, nome")
        .eq("numero_whatsapp", cleanNumber)
        .neq("id", convite.cliente_id)
        .maybeSingle();

      if (existingClient) {
        return new Response(JSON.stringify({ error: "Este número já está vinculado a outro cliente" }), {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Generate 6-digit OTP
      const otp = String(Math.floor(100000 + Math.random() * 900000));

      // Save OTP
      const { error: otpError } = await svc.from("validacoes_otp").insert({
        cliente_id: convite.cliente_id,
        convite_id: convite.id,
        numero_informado: cleanNumber,
        codigo_otp: otp,
      });

      if (otpError) {
        console.error("OTP insert error:", otpError);
        return new Response(JSON.stringify({ error: "Erro ao gerar código" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Find advogado's WhatsApp instance to send from
      const { data: instance } = await svc
        .from("whatsapp_instancias")
        .select("instance_name, status")
        .eq("user_id", convite.advogado_user_id)
        .eq("status", "connected")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!instance) {
        return new Response(JSON.stringify({ error: "WhatsApp do escritório não está conectado" }), {
          status: 503,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Send OTP via Evolution API
      const whatsappNumber = cleanNumber.startsWith("55") ? cleanNumber : `55${cleanNumber}`;
      const jid = `${whatsappNumber}@s.whatsapp.net`;

      try {
        const evoRes = await fetch(`${EVOLUTION_API_URL}/message/sendText/${instance.instance_name}`, {
          method: "POST",
          headers: evoHeaders(),
          body: JSON.stringify({
            number: jid,
            text: `🔐 Seu código de confirmação para ativar o acompanhamento do processo é: *${otp}*\n\nEste código expira em 5 minutos.`,
          }),
        });

        if (!evoRes.ok) {
          const errData = await evoRes.text();
          console.error("Evolution API error:", errData);
          return new Response(JSON.stringify({ error: "Falha ao enviar mensagem via WhatsApp" }), {
            status: 502,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        console.log(`OTP sent to ${whatsappNumber} via instance ${instance.instance_name}`);
      } catch (e) {
        console.error("Evolution API call failed:", e);
        return new Response(JSON.stringify({ error: "Erro ao conectar com WhatsApp" }), {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ success: true, message: "Código enviado via WhatsApp" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── VERIFY-OTP: Validate OTP code ───
    if (action === "verify-otp") {
      const { convite_id, codigo, ip } = body;
      if (!convite_id || !codigo) {
        return new Response(JSON.stringify({ error: "convite_id e codigo são obrigatórios" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Find latest OTP for this invite
      const { data: otp, error: otpFetchError } = await svc
        .from("validacoes_otp")
        .select("*")
        .eq("convite_id", convite_id)
        .eq("validado", false)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (otpFetchError || !otp) {
        return new Response(JSON.stringify({ error: "Nenhum código pendente encontrado" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Check attempts
      if (otp.tentativas >= 5) {
        return new Response(JSON.stringify({ error: "Número máximo de tentativas excedido. Solicite um novo código." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Increment attempts
      await svc.from("validacoes_otp").update({ tentativas: otp.tentativas + 1 }).eq("id", otp.id);

      // Check expiration
      if (new Date(otp.expiracao) < new Date()) {
        return new Response(JSON.stringify({ error: "Código expirado. Solicite um novo código." }), {
          status: 410,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Validate code
      if (otp.codigo_otp !== codigo.trim()) {
        const remaining = 4 - otp.tentativas;
        return new Response(JSON.stringify({ error: `Código incorreto. ${remaining} tentativa(s) restante(s).` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // OTP is valid! Update everything
      // 1. Mark OTP as validated
      await svc.from("validacoes_otp").update({ validado: true }).eq("id", otp.id);

      // 2. Update cliente with WhatsApp number and status
      await svc.from("clientes")
        .update({ numero_whatsapp: otp.numero_informado, status_vinculo: "ativo" })
        .eq("id", otp.cliente_id);

      // 3. Update convite as used
      await svc.from("convites_vinculacao")
        .update({ status: "utilizado", ip_aceite: ip || null, data_aceite: new Date().toISOString() })
        .eq("id", convite_id);

      return new Response(JSON.stringify({
        success: true,
        message: "Número validado com sucesso! Você receberá atualizações automáticas sobre seu processo.",
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Ação inválida" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Unexpected error:", e);
    return new Response(JSON.stringify({ error: "Erro interno" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
