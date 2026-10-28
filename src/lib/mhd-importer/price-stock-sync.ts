// Sincronización de precio y stock con Shopify (David, 2026-10-28; diseño en docs/SINCRONIZACIONES_MHD.md). Cada 30 min
// Supabase lee /prices y /stocks de MHD (mhd_import_start_scheduled); esta pieza manda a Shopify solo lo que cambia
// respecto a lo último enviado (mhd_shopify_price_stock), sin IA: el precio en la variante (sin precio tachado) y el
// stock en «Almacén MHD». Todo queda en mhd_sync_events. Los productos que no vienen en la lectura no se tocan: eso lo
// deciden las bajas, con dos lecturas seguidas.
import type { SupabaseClient } from "@supabase/supabase-js";
import { shopifyGraphql, type ShopifyConfig } from "./store-filters";
import { STORE_RULES } from "./processor";

type Change = { codigo: string; product_id: string; variant_id: string; inventory_item_id: string; price: number; stock: number; sent_price: number | null; sent_stock: number | null };
type UserError = { field?: string[] | null; message: string };

// Seguros: la lectura tiene que ser reciente y completa (una a medias parecería que han cambiado o faltan miles).
export const PRICE_STOCK_SYNC = { maxReadAgeMinutes: 90, minRows: 25_000, stockBatch: 250, priceConcurrency: 5, budgetMs: 240_000 };

async function event(db: SupabaseClient, kind: string, detail: Record<string, unknown>, codigo: string | null = null) {
  await db.from("mhd_sync_events").insert({ sync: "precio-stock", kind, codigo, detail });
}

// Última lectura terminada de precios y stock de MHD, si es reciente y completa.
async function latestRead(db: SupabaseClient) {
  const { data: runs, error } = await db.from("mhd_catalog_import_runs").select("id,entities,entity_progress,status,last_activity_at").eq("status", "completed").contains("entities", ["prices", "stock"]).order("last_activity_at", { ascending: false }).limit(1);
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
  const { data, error } = await deps.db.rpc("mhd_price_stock_changes", { p_run: read.run, p_limit: 50_000 });
  if (error) throw error;
  let changes = (data ?? []) as Change[];
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
      const result = await shopifyGraphql<{ inventorySetQuantities: { userErrors: UserError[] } }>(deps.shopify, `mutation($input: InventorySetQuantitiesInput!) { inventorySetQuantities(input: $input) { userErrors { field message } } }`, { input: { name: "available", reason: "correction", referenceDocumentUri: `gid://sincro-vicente/SyncJob/precio-stock-${read.run}`, quantities: batch.map((item) => ({ inventoryItemId: item.inventory_item_id, locationId: location, quantity: item.stock, changeFromQuantity: null })) } });
      if (result.inventorySetQuantities.userErrors.length) throw new Error(result.inventorySetQuantities.userErrors.map((item) => item.message).join("; "));
      for (const item of batch) sent.set(item.codigo, { ...sent.get(item.codigo), stock: item.stock });
      summary.stockSent += batch.length;
    } catch (caught) { summary.errors.push(`Stock (${batch.length} productos): ${caught instanceof Error ? caught.message : String(caught)}`); }
  }
  // Precio: una llamada por producto, unas pocas a la vez (lo normal son unos cientos por vuelta; si un día son miles,
  // lo que no quepa en el tiempo de la vuelta sale en la siguiente, porque no queda como enviado).
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
