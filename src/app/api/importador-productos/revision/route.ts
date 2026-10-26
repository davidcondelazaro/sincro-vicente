import { setReviewTag } from "@/lib/mhd-importer/shopify-draft";
import { errorResponse, importerSession, sourcesConfig } from "@/lib/mhd-importer/server";

// Cola de revisión a mano del importador (docs/IMPORTADOR_PRODUCTOS_MHD.md): GET devuelve los productos cuya última
// prueba trae motivos de revisión (vista mhd_importer_review_queue) con lo decidido; POST { codigo, decision, note }
// guarda la decisión («resuelto», «no_importar», «avisar_mhd») o, con decision «reabrir», la borra. Si el producto ya
// está en Shopify, «resuelto» le quita la etiqueta «Revisar antes de publicar» y «reabrir» se la vuelve a poner.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DECISIONS = new Set(["resuelto", "no_importar", "avisar_mhd"]);
const QUEUE_FIELDS = "codigo,family_code,family_name,run_id,run_at,title,ean,reasons,reasons_hash,decision,note,reviewer,decided_at,pending";

export async function GET() {
  const session = await importerSession();
  if (!session) return Response.json({ error: "Necesitas iniciar sesión." }, { status: 401 });
  try {
    const items = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await session.db.from("mhd_importer_review_queue").select(QUEUE_FIELDS).order("pending", { ascending: false }).order("family_code").order("codigo").range(from, from + 999);
      if (error) throw error;
      items.push(...data);
      if (data.length < 1000) break;
    }
    return Response.json({ items });
  } catch (caught) { return errorResponse(caught, "No se pudo leer la cola de revisión."); }
}

export async function POST(request: Request) {
  const session = await importerSession();
  if (!session) return Response.json({ error: "Necesitas iniciar sesión." }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { codigo?: string; decision?: string; note?: string };
  if (!body.codigo || !(body.decision === "reabrir" || DECISIONS.has(body.decision ?? ""))) return Response.json({ error: "Petición no válida." }, { status: 400 });
  if ((body.decision === "no_importar" || body.decision === "avisar_mhd") && !body.note?.trim()) return Response.json({ error: "Di por qué, para que quede en el informe." }, { status: 400 });
  try {
    const { data: inShopify, error: shopifyError } = await session.db.from("mhd_importer_product_runs").select("shopify_product_id").eq("codigo", body.codigo).not("shopify_product_id", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (shopifyError) throw shopifyError;
    const productId = inShopify?.shopify_product_id as string | undefined;
    if (body.decision === "reabrir") {
      const { error } = await session.db.from("mhd_importer_review_items").delete().eq("codigo", body.codigo);
      if (error) throw error;
      if (productId) await setReviewTag(sourcesConfig().shopify, productId, true);
      return Response.json({ ok: true });
    }
    // La decisión se guarda con la huella de los motivos que calcula la vista: si cambian, el producto vuelve a la cola.
    const { data: item, error: readError } = await session.db.from("mhd_importer_review_queue").select("run_id,reasons_hash").eq("codigo", body.codigo).maybeSingle();
    if (readError) throw readError;
    if (!item) return Response.json({ error: "Ese producto no está en la cola." }, { status: 404 });
    const { error } = await session.db.from("mhd_importer_review_items").upsert({ codigo: body.codigo, status: body.decision, note: body.note?.trim() || null, reasons_hash: item.reasons_hash, run_id: item.run_id, reviewer: session.email, updated_at: new Date().toISOString() });
    if (error) throw error;
    if (productId && body.decision === "resuelto") await setReviewTag(sourcesConfig().shopify, productId, false);
    return Response.json({ ok: true });
  } catch (caught) { return errorResponse(caught, "No se pudo guardar la decisión."); }
}
