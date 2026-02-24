import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getTenantUsage } from "../_shared/tenant-usage.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonResponse(body: unknown, status = 200, extraHeaders: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      ...extraHeaders,
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        ...corsHeaders,
        "Cache-Control": "public, max-age=86400",
      },
    });
  }

  if (req.method !== "GET") {
    return jsonResponse({ error: "method_not_allowed" }, 405, {
      "Allow": "GET, OPTIONS",
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "unauthorized" }, 401);
    }

    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return jsonResponse({ error: "unauthorized" }, 401);
    }

    const usage = await getTenantUsage(supabase, user.id);

    return jsonResponse(usage, 200, {
      "Cache-Control": "private, max-age=15, stale-while-revalidate=45, must-revalidate",
      "Vary": "Authorization",
    });
  } catch (error) {
    console.error("get_tenant_usage_error", error);
    return jsonResponse({ error: "internal_error" }, 500);
  }
});
