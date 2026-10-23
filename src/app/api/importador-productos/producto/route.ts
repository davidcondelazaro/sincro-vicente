import Anthropic from "@anthropic-ai/sdk";
import { anthropicKey } from "@/lib/mhd-importer/ai";
import { processProduct } from "@/lib/mhd-importer/processor";
import { createShopifyDraft, updateShopifyTexts } from "@/lib/mhd-importer/shopify-draft";
import { errorResponse, importerSession, sourcesConfig } from "@/lib/mhd-importer/server";

// Importador de productos MHD: prueba de un producto. POST { codigo } (código de MHD o EAN) monta la ficha con el perfil
// de su familia y la guarda en mhd_importer_product_runs, con las fotos tratadas y la etiqueta en mhd_importer_media,
// sin tocar Shopify. POST { action: "shopify", runId } crea esa prueba en Shopify como BORRADOR (nunca publica) o,
// si el producto ya existe, lo actualiza.
// GET ?codigo= devuelve la última prueba de ese producto con la lista de sus archivos.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MEDIA_FIELDS = "id,role,position,filename,content_type,width,height,meta";

export async function GET(request: Request) {
  const session = await importerSession();
  if (!session) return Response.json({ error: "Necesitas iniciar sesión." }, { status: 401 });
  const codigo = new URL(request.url).searchParams.get("codigo");
  let query = session.db.from("mhd_importer_product_runs").select(`*, media:mhd_importer_media(${MEDIA_FIELDS})`).order("created_at", { ascending: false }).limit(codigo ? 1 : 20);
  if (codigo) query = query.eq("codigo", codigo);
  const { data, error } = await query;
  return error ? errorResponse(error, "No se pudieron leer las pruebas.") : Response.json({ runs: data });
}

export async function POST(request: Request) {
  const session = await importerSession();
  if (!session) return Response.json({ error: "Necesitas iniciar sesión." }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { codigo?: string; action?: string; runId?: string };
  if (body.action === "shopify-textos") {
    if (!body.runId) return Response.json({ error: "Falta la prueba." }, { status: 400 });
    try { return Response.json({ created: await updateShopifyTexts({ db: session.db, shopify: sourcesConfig().shopify }, body.runId) }); }
    catch (caught) { return errorResponse(caught, "No se pudieron actualizar los textos en Shopify."); }
  }
  if (body.action === "shopify") {
    if (!body.runId) return Response.json({ error: "Falta la prueba." }, { status: 400 });
    try { const config = sourcesConfig(); return Response.json({ created: await createShopifyDraft({ db: session.db, shopify: config.shopify, icecat: config.icecat }, body.runId) }); }
    catch (caught) { return errorResponse(caught, "No se pudo crear el borrador en Shopify."); }
  }
  const codigo = body.codigo?.trim();
  if (!codigo) return Response.json({ error: "Indica un código de MHD o un EAN." }, { status: 400 });
  try {
    const { data: listing, error } = await session.db.rpc("mhd_importer_product", { p_codigo: codigo });
    if (error) throw error;
    if (!listing) return Response.json({ error: `No hay ningún producto de MHD con el código o EAN ${codigo}.` }, { status: 404 });
    const [{ data: profileRow, error: profileError }, { data: family, error: familyError }] = await Promise.all([
      session.db.from("mhd_importer_family_profiles").select("profile,status").eq("family_code", listing.cod_familia).maybeSingle(),
      session.db.rpc("mhd_importer_family_listing", { p_family_code: listing.cod_familia }),
    ]);
    if (profileError) throw profileError;
    if (familyError) throw familyError;
    const subfamilyEans = ((family ?? []) as { cod_subfamilia: string | null; codigo_ean: string | null }[]).filter((item) => item.cod_subfamilia === listing.cod_subfamilia && item.codigo_ean).map((item) => item.codigo_ean!);
    const result = await processProduct({ db: session.db, config: sourcesConfig(), ai: new Anthropic({ apiKey: anthropicKey(process.env) }) }, listing, profileRow, subfamilyEans);
    const row: Record<string, unknown> = result.status === "ok"
      ? { codigo: listing.codigo, family_code: listing.cod_familia, status: "ok", result: result.product, warnings: result.warnings, model: "claude-haiku-5-5", usage: result.usage, cost_usd: result.costUsd, created_by: session.email }
      : { codigo: listing.codigo, family_code: listing.cod_familia, status: "discarded", discard_reason: result.reason, warnings: result.warnings, created_by: session.email };
    const { data: saved, error: saveError } = await session.db.from("mhd_importer_product_runs").insert(row).select("id").single();
    if (saveError) throw saveError;
    if (result.status === "ok" && result.media.length) {
      const { error: mediaError } = await session.db.from("mhd_importer_media").insert(result.media.map((file) => ({ run_id: saved.id, role: file.role, position: file.position, filename: file.filename, content_type: file.contentType, width: file.width, height: file.height, bytes: `\\x${Buffer.from(file.bytes).toString("hex")}`, meta: file.meta })));
      if (mediaError) throw mediaError;
    }
    const { data: run, error: readError } = await session.db.from("mhd_importer_product_runs").select(`*, media:mhd_importer_media(${MEDIA_FIELDS})`).eq("id", saved.id).single();
    if (readError) throw readError;
    return Response.json({ run });
  } catch (caught) {
    return errorResponse(caught, "No se pudo procesar el producto.");
  }
}
