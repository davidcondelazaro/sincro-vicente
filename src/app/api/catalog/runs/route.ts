import { createClient as createSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function filters(input: Record<string, unknown>) {
  const entityType = input.entityType;
  if (entityType !== "manufacturers" && entityType !== "categories" && entityType !== "features" && entityType !== "products" && entityType !== "priorities" && entityType !== "icecat") throw new Error("La entidad seleccionada no está disponible todavía.");
  const manufacturerId = String(input.manufacturerId ?? "").trim();
  const categoryId = String(input.categoryId ?? "").trim();
  const featureId = String(input.featureId ?? "").trim();
  const productId = String(input.productId ?? "").trim();
  const icecatSkus = String(input.skus ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  const icecatEans = String(input.eans ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  const productIds = [...new Set(productId.split(",").map((value) => value.trim()).filter(Boolean))];
  const modifiedSince = String(input.modifiedSince ?? "").trim();
  const productSyncMode = String(input.productSyncMode ?? "changes").trim();
  const collectionName = String(input.collectionName ?? "").trim();
  if (manufacturerId.length > 100 || categoryId.length > 100 || featureId.length > 100 || productId.length > 2000) throw new Error("El filtro es demasiado largo.");
  if (icecatSkus.join(",").length > 2000 || icecatEans.join(",").length > 2000 || icecatSkus.some((value) => !/^[A-Za-z0-9._-]+$/.test(value)) || icecatEans.some((value) => !/^\d{8,14}$/.test(value))) throw new Error("Los SKU o EAN indicados no son válidos.");
  if (modifiedSince && !/^\d{4}-\d{2}-\d{2}$/.test(modifiedSince)) throw new Error("La fecha de modificación no es válida.");
  if (entityType === "products" && productSyncMode !== "changes" && productSyncMode !== "all") throw new Error("El modo de productos no es válido.");
  if (entityType === "manufacturers") return { entityType, filters: { onlyActive: input.onlyActive !== false, ...(manufacturerId ? { manufacturerId } : {}) } };
  if (entityType === "categories") return { entityType, filters: { ...(categoryId ? { categoryId } : {}) } };
  if (entityType === "features") return { entityType, filters: { ...(featureId ? { featureId } : {}) } };
  if (entityType === "priorities") return { entityType, filters: collectionName ? { collectionName } : {} };
  if (entityType === "icecat") return { entityType, filters: { force: input.force === true, ...(icecatSkus.length ? { productIds: [...new Set(icecatSkus)] } : {}), ...(icecatEans.length ? { eans: [...new Set(icecatEans)] } : {}) } };
  // Conservamos la fecha como fecha de calendario. El worker aplica el inicio
  // de ese día tanto a la modificación del producto como a la de sus imágenes.
  return { entityType, filters: { onlyActive: true, productSyncMode, forceImages: input.forceImages === true, ...(productIds.length ? { productIds } : {}), ...(modifiedSince ? { modifiedSince } : {}) } };
}

export async function GET(request: Request) {
  const supabase = await createSupabaseClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims.sub) return Response.json({ error: "Necesitas iniciar sesión." }, { status: 401 });
  const url = new URL(request.url);
  const entityType = url.searchParams.get("entityType");
  const from = url.searchParams.get("from");
  const until = url.searchParams.get("until");
  const page = Math.max(0, Number.parseInt(url.searchParams.get("page") ?? "0", 10) || 0);
  const pageSize = 15;
  if (entityType && entityType !== "manufacturers" && entityType !== "categories" && entityType !== "features" && entityType !== "products" && entityType !== "priorities" && entityType !== "icecat") return Response.json({ error: "Entidad no válida." }, { status: 400 });
  if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) return Response.json({ error: "La fecha de inicio no es válida." }, { status: 400 });
  if (until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) return Response.json({ error: "La fecha de fin no es válida." }, { status: 400 });
  let query = supabase.from("catalog_import_runs").select("*").order("created_at", { ascending: false });
  if (entityType) query = query.eq("entity_type", entityType);
  else query = query.in("entity_type", ["manufacturers", "categories", "features", "products"]);
  if (from) query = query.gte("created_at", `${from}T00:00:00.000Z`);
  if (until) {
    const end = new Date(`${until}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    query = query.lt("created_at", end.toISOString());
  }
  const { data, error } = await query.range(page * pageSize, page * pageSize + pageSize);
  if (error) return Response.json({ error: "No se pudo recuperar el historial de importaciones." }, { status: 500 });
  const rows = data ?? [];
  return Response.json({ runs: rows.slice(0, pageSize), hasMore: rows.length > pageSize, page });
}

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseClient();
    const { data: claims } = await supabase.auth.getClaims();
    if (!claims?.claims.sub) return Response.json({ error: "Necesitas iniciar sesión." }, { status: 401 });
    const input = filters(await request.json() as Record<string, unknown>);
    const { data: run, error } = await supabase.rpc("start_catalog_import", { p_entity_type: input.entityType, p_filters: input.filters });
    if (error || !run) throw error ?? new Error("No se pudo crear la ejecución.");
    try {
      const worker = input.entityType === "icecat" ? "sync-icecat-imports" : input.entityType === "priorities" ? "sync-priority-imports" : "sync-catalog-imports";
      const { error: dispatchError } = await supabase.functions.invoke(worker, { body: {} });
      if (dispatchError) console.error("Catalog import worker dispatch failed", dispatchError);
    } catch (dispatchError) {
      // La ejecución ya está guardada en la cola; la pantalla debe poder mostrarla aunque falle el aviso inmediato al trabajador.
      console.error("Catalog import worker dispatch failed", dispatchError);
    }
    return Response.json({ run });
  } catch (error) {
    console.error("Catalog import start failed", error);
    const message = error instanceof Error ? error.message : (error && typeof error === "object" && "message" in error ? String((error as { message?: unknown }).message) : "No se pudo iniciar la importación.");
    return Response.json({ error: message || "No se pudo iniciar la importación." }, { status: 500 });
  }
}
