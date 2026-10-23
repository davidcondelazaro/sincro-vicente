// Enlace de las piezas del importador con las rutas de Next: sesión del usuario y configuración desde el entorno.
import { createClient } from "@/lib/supabase/server";
import { icecatConfigFromEnv, mhdConfigFromEnv } from "./sources";
import { shopifyConfigFromEnv } from "./store-filters";
import type { SourcesConfig } from "./gather";

export async function importerSession() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims.sub ? { db: supabase, email: typeof data.claims.email === "string" ? data.claims.email : null } : null;
}
export function sourcesConfig(): SourcesConfig { return { mhd: mhdConfigFromEnv(process.env), icecat: icecatConfigFromEnv(process.env), shopify: shopifyConfigFromEnv(process.env) }; }
// Los errores de Supabase no son `Error`, pero traen `message`.
export function errorResponse(caught: unknown, fallback: string, status = 500) {
  const message = caught && typeof caught === "object" && "message" in caught && typeof caught.message === "string" ? caught.message : fallback;
  console.error(JSON.stringify({ productImporter: fallback, error: message }));
  return Response.json({ error: message }, { status });
}
