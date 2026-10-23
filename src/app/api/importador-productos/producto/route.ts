import Anthropic from "@anthropic-ai/sdk";
import { anthropicKey } from "@/lib/mhd-importer/ai";
import { processProduct } from "@/lib/mhd-importer/processor";
import { errorResponse, importerSession, sourcesConfig } from "@/lib/mhd-importer/server";

// Importador de productos MHD: prueba de un producto. POST { codigo } (código de MHD o EAN) monta la ficha con el perfil
// de su familia y la guarda en mhd_importer_product_runs, sin tocar Shopify. GET ?codigo= devuelve la última prueba.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const session = await importerSession();
  if (!session) return Response.json({ error: "Necesitas iniciar sesión." }, { status: 401 });
  const codigo = new URL(request.url).searchParams.get("codigo");
  let query = session.db.from("mhd_importer_product_runs").select("*").order("created_at", { ascending: false }).limit(codigo ? 1 : 20);
  if (codigo) query = query.eq("codigo", codigo);
  const { data, error } = await query;
  return error ? errorResponse(error, "No se pudieron leer las pruebas.") : Response.json({ runs: data });
}

export async function POST(request: Request) {
  const session = await importerSession();
  if (!session) return Response.json({ error: "Necesitas iniciar sesión." }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { codigo?: string };
  const codigo = body.codigo?.trim();
  if (!codigo) return Response.json({ error: "Indica un código de MHD o un EAN." }, { status: 400 });
  try {
    const { data: listing, error } = await session.db.rpc("mhd_importer_product", { p_codigo: codigo });
    if (error) throw error;
    if (!listing) return Response.json({ error: `No hay ningún producto de MHD con el código o EAN ${codigo}.` }, { status: 404 });
    const { data: profileRow, error: profileError } = await session.db.from("mhd_importer_family_profiles").select("profile,status").eq("family_code", listing.cod_familia).maybeSingle();
    if (profileError) throw profileError;
    const result = await processProduct({ db: session.db, config: sourcesConfig(), ai: new Anthropic({ apiKey: anthropicKey(process.env) }) }, listing, profileRow);
    const row: Record<string, unknown> = result.status === "ok"
      ? { codigo: listing.codigo, family_code: listing.cod_familia, status: "ok", result: result.product, warnings: result.warnings, model: "claude-haiku-5-5", usage: result.usage, cost_usd: result.costUsd, created_by: session.email }
      : { codigo: listing.codigo, family_code: listing.cod_familia, status: "discarded", discard_reason: result.reason, warnings: result.warnings, created_by: session.email };
    const { data: saved, error: saveError } = await session.db.from("mhd_importer_product_runs").insert(row).select("*").single();
    if (saveError) throw saveError;
    return Response.json({ run: saved });
  } catch (caught) {
    return errorResponse(caught, "No se pudo procesar el producto.");
  }
}
