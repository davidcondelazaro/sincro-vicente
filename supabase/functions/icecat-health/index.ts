import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Método no permitido" }, 405);
  const username = Deno.env.get("ICECAT_USERNAME");
  const appKey = Deno.env.get("ICECAT_APP_KEY");
  if (!username || !appKey) return json({ icecat: false, configured: false }, 503);
  try {
    // Producto de Full Icecat del catálogo MHD: sólo responde 200 si la IP de salida (o la del proxy) está autorizada.
    const query = new URLSearchParams({ UserName: username, Language: Deno.env.get("ICECAT_LANGUAGE") || "es", GTIN: "3700460207656", app_key: appKey });
    const proxyUrl = Deno.env.get("ICECAT_PROXY_URL");
    const response = await fetch(`${proxyUrl || "https://live.icecat.biz/api"}?${query.toString()}`, { signal: AbortSignal.timeout(15_000), headers: proxyUrl ? { "X-Proxy-Token": Deno.env.get("ICECAT_PROXY_TOKEN") ?? "" } : undefined });
    return json({ icecat: response.ok, configured: true, ...(response.status === 403 ? { error: "IP de salida no autorizada para Full Icecat." } : {}) }, response.ok ? 200 : 503);
  } catch {
    return json({ icecat: false, configured: true }, 503);
  }
});
