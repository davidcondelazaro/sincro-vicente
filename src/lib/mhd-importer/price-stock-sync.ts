// Sincronización de precio y stock con Shopify (David, 2026-10-28; diseño en docs/SINCRONIZACIONES_MHD.md). Supabase lee
// MHD (mhd_import_start_scheduled): el stock de /stocks cada 30 min y el precio del listado de productos (`pvp`, la tarifa
// de nuestra web; el de /prices es otra tarifa, David 2026-10-29) cada hora. Esta pieza manda a Shopify solo lo que cambia
// respecto a lo último enviado (mhd_shopify_price_stock), sin IA: el precio en la variante (sin precio tachado) y el
// stock en «Almacén MHD». Todo queda en mhd_sync_events. Los productos que no vienen en la lectura no se tocan: eso lo
// deciden las bajas, con dos lecturas seguidas.
import type { SupabaseClient } from "@supabase/supabase-js";
import { shopifyGraphql, type ShopifyConfig } from "./store-filters";
import { STORE_RULES } from "./processor";

type Change = { codigo: string; product_id: string; variant_id: string; inventory_item_id: string; price: number; stock: number; sent_price: number | null; sent_stock: number | null };
type UserError = { field?: string[] | null; message: string };

// Seguros: la lectura tiene que ser reciente y completa (una a medias parecería que han cambiado o faltan miles).
export const PRICE_STOCK_SYNC = { maxReadAgeMinutes: 90, minRows: 25_000, stockBatch: 250, priceConcurrency: 5, budgetMs: 240_000, bulkFrom: 1000 };

async function event(db: SupabaseClient, kind: string, detail: Record<string, unknown>, codigo: string | null = null) {
  await db.from("mhd_sync_events").insert({ sync: "precio-stock", kind, codigo, detail });
}

// Última lectura terminada de precios y stock de MHD, si es reciente y completa.
async function latestRead(db: SupabaseClient) {
  const { data: runs, error } = await db.from("mhd_catalog_import_runs").select("id,entities,entity_progress,status,last_activity_at").eq("status", "completed").contains("entities", ["prices", "stock"]).not("last_activity_at", "is", null).order("last_activity_at", { ascending: false, nullsFirst: false }).limit(1);
  if (error) throw error;
  const run = runs?.[0] as { id: string; entity_progress: Record<string, { total?: number; done?: number }>; last_activity_at: string } | undefined;
  if (!run) return { ok: false as const, reason: "No hay ninguna lectura de precios y stock terminada." };
  const ageMinutes = (Date.now() - new Date(run.last_activity_at).getTime()) / 60_000;
  const prices = run.entity_progress.prices?.done ?? 0; const stock = run.entity_progress.stock?.done ?? 0;
  if (ageMinutes > PRICE_STOCK_SYNC.maxReadAgeMinutes) return { ok: false as const, reason: `La última lectura de MHD es de hace ${Math.round(ageMinutes)} min.`, run: run.id };
  if (prices < PRICE_STOCK_SYNC.minRows || stock < PRICE_STOCK_SYNC.minRows) return { ok: false as const, reason: `Lectura incompleta: ${prices} precios y ${stock} existencias (mínimo ${PRICE_STOCK_SYNC.minRows}).`, run: run.id };
  return { ok: true as const, run: run.id, prices, stock };
}

export async function syncPriceStock(deps: { db: SupabaseClient; shopify: ShopifyConfig }, options: { dryRun?: boolean; codes?: string[] } = {}) {
  const started = Date.now();
  const read = await latestRead(deps.db);
  if (!read.ok) {
    if (!options.dryRun) await event(deps.db, "freno", { reason: read.reason, run: read.run ?? null });
    return { ok: false, reason: read.reason };
  }
  // La API de la base devuelve 1.000 filas por llamada: se piden por páginas.
  let changes: Change[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await deps.db.rpc("mhd_price_stock_changes", { p_run: read.run, p_limit: 50_000 }).range(from, from + 999);
    if (error) throw error;
    changes = changes.concat((data ?? []) as Change[]);
    if (!data || data.length < 1000) break;
  }
  await checkLastBulk(deps);
  if (options.codes?.length) changes = changes.filter((item) => options.codes!.includes(item.codigo));
  const priceChanges = changes.filter((item) => item.sent_price === null || Number(item.sent_price) !== Number(item.price));
  const stockChanges = changes.filter((item) => item.sent_stock === null || item.sent_stock !== item.stock);
  const summary = { run: read.run, changes: changes.length, prices: priceChanges.length, stock: stockChanges.length, pricesSent: 0, stockSent: 0, errors: [] as string[] };
  if (options.dryRun) return { ok: true, dryRun: true, ...summary, sample: changes.slice(0, 10) };

  const location = STORE_RULES.locationIds["Almacén MHD"];
  const sent = new Map<string, { price?: number; stock?: number }>();
  // Stock: de 250 en 250 en una sola llamada cada lote.
  for (let i = 0; i < stockChanges.length && Date.now() - started < PRICE_STOCK_SYNC.budgetMs; i += PRICE_STOCK_SYNC.stockBatch) {
    const batch = stockChanges.slice(i, i + PRICE_STOCK_SYNC.stockBatch);
    try {
      const result = await shopifyGraphql<{ inventorySetQuantities: { userErrors: UserError[] } }>(deps.shopify, `mutation($input: InventorySetQuantitiesInput!, $key: String!) { inventorySetQuantities(input: $input) @idempotent(key: $key) { userErrors { field message } } }`, { key: crypto.randomUUID(), input: { name: "available", reason: "correction", referenceDocumentUri: `gid://sincro-vicente/SyncJob/precio-stock-${read.run}`, quantities: batch.map((item) => ({ inventoryItemId: item.inventory_item_id, locationId: location, quantity: item.stock, changeFromQuantity: null })) } });
      if (result.inventorySetQuantities.userErrors.length) throw new Error(result.inventorySetQuantities.userErrors.map((item) => item.message).join("; "));
      for (const item of batch) sent.set(item.codigo, { ...sent.get(item.codigo), stock: item.stock });
      summary.stockSent += batch.length;
    } catch (caught) { summary.errors.push(`Stock (${batch.length} productos): ${caught instanceof Error ? caught.message : String(caught)}`); }
  }
  // Precio: con muchos cambios (la primera puesta al día, o un cambio de tarifa de MHD), una operación masiva de Shopify
  // que no gasta del límite de llamadas; se da por enviado al lanzarla y la vuelta siguiente repasa su resultado
  // (checkLastBulk). Con pocos, una llamada por producto, unas pocas a la vez; lo que no quepa en el tiempo de la vuelta
  // sale en la siguiente, porque no queda como enviado.
  if (priceChanges.length >= PRICE_STOCK_SYNC.bulkFrom) {
    try {
      const bulk = await launchPriceBulk(deps.shopify, priceChanges);
      for (const item of priceChanges) sent.set(item.codigo, { ...sent.get(item.codigo), price: item.price });
      summary.pricesSent = priceChanges.length;
      await event(deps.db, "masivo", { bulk, codes: priceChanges.map((item) => item.codigo) });
    } catch (caught) { summary.errors.push(`Operación masiva de precios: ${caught instanceof Error ? caught.message : String(caught)}`); }
    priceChanges.length = 0;
  }
  let next = 0;
  const worker = async () => {
    while (next < priceChanges.length && Date.now() - started < PRICE_STOCK_SYNC.budgetMs) {
      const item = priceChanges[next++];
      try {
        const result = await shopifyGraphql<{ productVariantsBulkUpdate: { userErrors: UserError[] } }>(deps.shopify, `mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $productId, variants: $variants) { userErrors { field message } } }`, { productId: item.product_id, variants: [{ id: item.variant_id, price: item.price.toFixed(2), compareAtPrice: null }] });
        if (result.productVariantsBulkUpdate.userErrors.length) throw new Error(result.productVariantsBulkUpdate.userErrors.map((e) => e.message).join("; "));
        sent.set(item.codigo, { ...sent.get(item.codigo), price: item.price });
        summary.pricesSent += 1;
      } catch (caught) { summary.errors.push(`Precio ${item.codigo}: ${caught instanceof Error ? caught.message : String(caught)}`); }
    }
  };
  await Promise.all(Array.from({ length: PRICE_STOCK_SYNC.priceConcurrency }, worker));

  // Lo enviado queda apuntado (y en el histórico, un evento por cambio).
  const byCode = new Map(changes.map((item) => [item.codigo, item]));
  const rows = [...sent].map(([codigo, value]) => {
    const item = byCode.get(codigo)!;
    return { codigo, product_id: item.product_id, variant_id: item.variant_id, inventory_item_id: item.inventory_item_id, price: value.price ?? item.sent_price, stock: value.stock ?? item.sent_stock, sent_at: new Date().toISOString() };
  });
  for (let i = 0; i < rows.length; i += 1000) {
    const { error: saveError } = await deps.db.from("mhd_shopify_price_stock").upsert(rows.slice(i, i + 1000));
    if (saveError) summary.errors.push(`Guardar lo enviado: ${saveError.message}`);
  }
  const events = [...sent].flatMap(([codigo, value]) => {
    const item = byCode.get(codigo)!;
    return [
      ...(value.price !== undefined ? [{ sync: "precio-stock", kind: "precio", codigo, detail: { antes: item.sent_price, ahora: value.price } }] : []),
      ...(value.stock !== undefined ? [{ sync: "precio-stock", kind: "stock", codigo, detail: { antes: item.sent_stock, ahora: value.stock } }] : []),
    ];
  });
  for (let i = 0; i < events.length; i += 1000) await deps.db.from("mhd_sync_events").insert(events.slice(i, i + 1000));
  await event(deps.db, summary.errors.length ? "error" : "vuelta", { ...summary, errors: summary.errors.slice(0, 20), seconds: Math.round((Date.now() - started) / 1000) });
  return { ok: summary.errors.length === 0, ...summary };
}

// Operación masiva de Shopify con los precios (productVariantsBulkUpdate por producto, una línea por producto).
async function launchPriceBulk(shopify: ShopifyConfig, items: Change[]) {
  const { currentBulkOperation: current } = await shopifyGraphql<{ currentBulkOperation: { id: string; status: string } | null }>(shopify, `{ currentBulkOperation(type: MUTATION) { id status } }`);
  if (current && ["CREATED", "RUNNING"].includes(current.status)) throw new Error(`Ya hay una operación masiva en marcha (${current.id}).`);
  const lines = items.map((item) => JSON.stringify({ productId: item.product_id, variants: [{ id: item.variant_id, price: item.price.toFixed(2), compareAtPrice: null }] })).join("\n");
  const staged = await shopifyGraphql<{ stagedUploadsCreate: { stagedTargets: { url: string; parameters: { name: string; value: string }[] }[] } }>(shopify, `mutation { stagedUploadsCreate(input: [{ resource: BULK_MUTATION_VARIABLES, filename: "precios.jsonl", mimeType: "text/jsonl", httpMethod: POST }]) { stagedTargets { url parameters { name value } } } }`);
  const target = staged.stagedUploadsCreate.stagedTargets[0];
  const form = new FormData();
  for (const { name, value } of target.parameters) form.append(name, value);
  form.append("file", new Blob([lines], { type: "text/jsonl" }), "precios.jsonl");
  const upload = await fetch(target.url, { method: "POST", body: form });
  if (!upload.ok) throw new Error(`Subida del fichero de precios: HTTP ${upload.status}`);
  const key = target.parameters.find((item) => item.name === "key")!.value;
  const run = await shopifyGraphql<{ bulkOperationRunMutation: { bulkOperation: { id: string } | null; userErrors: UserError[] } }>(shopify, `mutation($path: String!) { bulkOperationRunMutation(mutation: "mutation call($productId: ID!, $variants: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $productId, variants: $variants) { userErrors { field message } } }", stagedUploadPath: $path) { bulkOperation { id } userErrors { message } } }`, { path: key });
  if (!run.bulkOperationRunMutation.bulkOperation) throw new Error(run.bulkOperationRunMutation.userErrors.map((item) => item.message).join("; "));
  return run.bulkOperationRunMutation.bulkOperation.id;
}

// Repasa la última operación masiva de precios: si terminó con fallos, esos productos dejan de constar como enviados
// para que la vuelta siguiente los mande otra vez. Se repasa una sola vez (evento «masivo-revisado»).
async function checkLastBulk(deps: { db: SupabaseClient; shopify: ShopifyConfig }) {
  const { data: last } = await deps.db.from("mhd_sync_events").select("id,detail").eq("sync", "precio-stock").eq("kind", "masivo").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!last) return;
  const { data: checked } = await deps.db.from("mhd_sync_events").select("id").eq("sync", "precio-stock").eq("kind", "masivo-revisado").contains("detail", { event: last.id }).limit(1).maybeSingle();
  if (checked) return;
  const { bulk, codes } = last.detail as { bulk: string; codes: string[] };
  const { node } = await shopifyGraphql<{ node: { status: string; url: string | null; errorCode: string | null } | null }>(deps.shopify, `query($id: ID!) { node(id: $id) { ... on BulkOperation { status url errorCode } } }`, { id: bulk });
  if (!node || ["CREATED", "RUNNING"].includes(node.status)) return;
  let failed: string[] = node.status === "COMPLETED" ? [] : codes;
  if (node.status === "COMPLETED" && node.url) {
    const text = await (await fetch(node.url)).text();
    failed = text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { __lineNumber?: number; data?: { productVariantsBulkUpdate?: { userErrors?: UserError[] } } })
      .filter((row) => (row.data?.productVariantsBulkUpdate?.userErrors?.length ?? 0) > 0).map((row) => codes[row.__lineNumber ?? -1]).filter(Boolean);
  }
  for (let i = 0; i < failed.length; i += 500) await deps.db.from("mhd_shopify_price_stock").update({ price: null }).in("codigo", failed.slice(i, i + 500));
  await event(deps.db, "masivo-revisado", { event: last.id, bulk, status: node.status, errorCode: node.errorCode, failed: failed.length });
}
