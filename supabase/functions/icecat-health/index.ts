import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Método no permitido" }, 405);
  const username = Deno.env.get("ICECAT_USERNAME");
  const appKey = Deno.env.get("ICECAT_APP_KEY");
  if (!username || !appKey) return json({ icecat: false, configured: false }, 503);
  try {
    const query = new URLSearchParams({ UserName: username, Language: Deno.env.get("ICECAT_LANGUAGE") || "es", GTIN: "0000000000000", app_key: appKey });
    const response = await fetch(`https://live.icecat.biz/api?${query.toString()}`, { signal: AbortSignal.timeout(10_000) });
    // Un EAN inexistente es una respuesta válida: sólo rechazamos credenciales, IP o API no disponible.
    return json({ icecat: ![401, 403, 429, 500, 502, 503, 504].includes(response.status), configured: true }, response.ok || response.status === 400 || response.status === 404 ? 200 : 503);
  } catch {
    return json({ icecat: false, configured: true }, 503);
  }
});
