import Anthropic from "@anthropic-ai/sdk";
import { anthropicKey } from "@/lib/mhd-importer/ai";
import { runAnalyst } from "@/lib/mhd-importer/analyst";
import { selectSample, summarizeFamily, type FamilySummary, type ListingProduct, type SampleProduct } from "@/lib/mhd-importer/family";
import { filterVocabulary, gatherProducts } from "@/lib/mhd-importer/gather";
import { errorResponse, importerSession, sourcesConfig } from "@/lib/mhd-importer/server";

// Importador de productos MHD: familias de MHD y su perfil. GET devuelve el árbol de MHD (línea › familia › subfamilia) o el perfil de una familia (?family=G01);
// POST { action: "sample" } lee la muestra (MHD + Icecat) y guarda el resumen que verá el analista;
// { action: "analyze" } lanza el analista con esa muestra; { action: "save", profile } guarda el perfil corregido y
// { action: "review" } lo da por revisado.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const SAMPLE_SIZE = 15;

export async function GET(request: Request) {
  const session = await importerSession();
  if (!session) return Response.json({ error: "Necesitas iniciar sesión." }, { status: 401 });
  const family = new URL(request.url).searchParams.get("family");
  if (!family) {
    const { data, error } = await session.db.rpc("mhd_importer_tree");
    return error ? errorResponse(error, "No se pudo leer el árbol de MHD.") : Response.json({ tree: data });
  }
  const { data, error } = await session.db.from("mhd_importer_family_profiles").select("*").eq("family_code", family).maybeSingle();
  return error ? errorResponse(error, "No se pudo leer el perfil.") : Response.json({ profile: data });
}

export async function POST(request: Request) {
  const session = await importerSession();
  if (!session) return Response.json({ error: "Necesitas iniciar sesión." }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { action?: string; family?: string; include?: string[]; profile?: unknown };
  if (!body.family) return Response.json({ error: "Petición no válida." }, { status: 400 });
  if (body.action === "analyze") return analyze(session.db, body.family);
  if (body.action === "save" || body.action === "review") {
    const changes = body.action === "save" ? { profile: body.profile, status: "draft", reviewed_at: null, reviewed_by: null } : { status: "reviewed", reviewed_at: new Date().toISOString(), reviewed_by: session.email };
    const { error } = await session.db.from("mhd_importer_family_profiles").update({ ...changes, updated_at: new Date().toISOString() }).eq("family_code", body.family);
    return error ? errorResponse(error, "No se pudo guardar el perfil.") : Response.json({ ok: true });
  }
  if (body.action !== "sample") return Response.json({ error: "Petición no válida." }, { status: 400 });
  try {
    const { data: listing, error } = await session.db.rpc("mhd_importer_family_listing", { p_family_code: body.family });
    if (error) throw error;
    const products = (listing ?? []) as (ListingProduct & { nombre_familia: string | null })[];
    if (!products.length) return Response.json({ error: `La familia ${body.family} no tiene productos en MHD.` }, { status: 404 });
    const config = sourcesConfig();
    const sample = await gatherProducts(session.db, config, selectSample(products, SAMPLE_SIZE, body.include ?? []));
    const familyName = products[0].nombre_familia ?? body.family;
    const summary = summarizeFamily(body.family, familyName, products, sample);
    const vocabulary = await filterVocabulary(session.db, config.shopify);
    const analysisInput = { summary, sample: sample.map(({ listing: product, detail, icecat, errors }) => ({ listing: product, detail, icecat, errors })), vocabularyReadAt: vocabulary.readAt, gatheredAt: new Date().toISOString() };
    const { error: saveError } = await session.db.from("mhd_importer_family_profiles").upsert({ family_code: body.family, family_name: familyName, analysis_input: analysisInput, updated_at: new Date().toISOString() });
    if (saveError) throw saveError;
    return Response.json({ summary, errors: sample.flatMap((item) => item.errors.map((message) => `${item.listing.codigo}: ${message}`)) });
  } catch (caught) {
    return errorResponse(caught, "No se pudo preparar la muestra.");
  }
}

async function analyze(db: NonNullable<Awaited<ReturnType<typeof importerSession>>>["db"], family: string) {
  try {
    const { data: row, error } = await db.from("mhd_importer_family_profiles").select("analysis_input").eq("family_code", family).maybeSingle();
    if (error) throw error;
    const input = row?.analysis_input as { summary: FamilySummary; sample: SampleProduct[] } | null;
    if (!input?.summary) return Response.json({ error: "Prepara primero la muestra de la familia." }, { status: 409 });
    const config = sourcesConfig();
    const vocabulary = await filterVocabulary(db, config.shopify);
    const result = await runAnalyst(new Anthropic({ apiKey: anthropicKey(process.env) }), input.summary, input.sample, vocabulary);
    const { error: saveError } = await db.from("mhd_importer_family_profiles").update({ profile: result.profile, status: "draft", model: result.model, usage: result.usage, cost_usd: result.costUsd, analyzed_at: new Date().toISOString(), reviewed_at: null, reviewed_by: null, updated_at: new Date().toISOString() }).eq("family_code", family);
    if (saveError) throw saveError;
    return Response.json({ profile: result.profile, costUsd: result.costUsd });
  } catch (caught) {
    return errorResponse(caught, "El analista no pudo proponer el perfil.");
  }
}
