import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
// Dejamos margen antes del límite de ejecución de la función para liberar
// el mensaje de cola de forma fiable y continuar sin esperas entre tramos.
const WORKER_BUDGET_MS = 30_000;
const SHOPIFY_TIMEOUT_MS = 20_000;
const STOCK_BATCH_SIZE = 25;
type ImportType = "prices" | "stock";
type Run = { id: string; import_type: ImportType; mode: "changes" | "all" | "selective" | "partial"; filters: { productIds?: string[]; changedSince?: string }; status: string; total_count: number; processed_count: number; updated_count: number; unchanged_count: number; warning_count: number; error_count: number; cursor_source_id: string | null };
type ShopifyVariant = { id: string; sku: string | null; price: string; compareAtPrice: string | null; inventoryItem: { id: string; inventoryLevel: { quantities: { name: string; quantity: number }[] } | null } | null };
type ShopifyProduct = { id: string; variants: { nodes: ShopifyVariant[] } };
type ErrorWithDetails = Error & { details?: Record<string, unknown> };

function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }); }
function env(name: string) { const value = Deno.env.get(name); if (!value) throw new Error(`Falta ${name}`); return value; }
function shopifyUrl() { return `https://${env("SHOPIFY_STORE_URL").replace(/^https?:\/\//, "").replace(/\/$/, "")}/admin/api/2026-07/graphql.json`; }
function errorDetails(error: unknown, context: Record<string, unknown> = {}) {
  const candidate = error as Partial<ErrorWithDetails> & Record<string, unknown>;
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : JSON.stringify(error);
  const details = candidate?.details && typeof candidate.details === "object" ? candidate.details : {};
  return { ...context, name: error instanceof Error ? error.name : typeof error, message, ...(error instanceof Error && error.stack ? { stack: error.stack } : {}), ...details };
}
async function shopify<T>(operation: string, query: string, variables: Record<string, unknown>) {
  let httpStatus: number | null = null; let raw = ""; let body: T & { errors?: unknown };
  try {
    const result = await fetch(shopifyUrl(), { method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": env("SHOPIFY_ACCESS_TOKEN") }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(SHOPIFY_TIMEOUT_MS) });
    httpStatus = result.status; raw = await result.text(); body = JSON.parse(raw) as T & { errors?: unknown };
  } catch (cause) {
    const error = new Error(`Shopify no respondió: ${cause instanceof Error ? cause.message : String(cause)}`) as ErrorWithDetails;
    error.details = { provider: "shopify", operation, variables, http_status: httpStatus, raw_response: raw || null, timeout_ms: SHOPIFY_TIMEOUT_MS };
    throw error;
  }
  if (httpStatus < 200 || httpStatus >= 300 || body.errors) {
    const error = new Error(`Shopify devolvió un error HTTP/GraphQL (${httpStatus})`) as ErrorWithDetails;
    error.details = { provider: "shopify", operation, variables, http_status: httpStatus, response: body, raw_response: raw };
    throw error;
  }
  return body;
}
function money(value: number | string | null | undefined) { const parsed = Number(value); return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null; }
function sameMoney(left: number | string | null | undefined, right: number | string | null | undefined) { const a = money(left); const b = money(right); return a !== null && b !== null && Math.round(a * 100) === Math.round(b * 100); }
// Shopify usa esta referencia únicamente para identificar el origen del ajuste.
// No incluimos el SKU sin codificar: algunos contienen espacios u otros caracteres
// que convertirían la referencia en una URI inválida.
function stockReference(reference: string) {
  return `https://sincro-vicente.local/stock-import/${encodeURIComponent(reference)}`;
}
async function locationId() {
  const result = await shopify<{ data: { locations: { nodes: { id: string }[] } } }>("locations", "query{locations(first:1){nodes{id}}}", {});
  const id = result.data.locations.nodes[0]?.id; if (!id) throw new Error("Shopify no tiene una ubicación de inventario disponible."); return id;
}
async function findVariant(productId: string, location?: string) {
  const inventoryFields = location ? "inventoryItem{id inventoryLevel(locationId:$location){quantities(names:[\"available\"]){name quantity}}}" : "inventoryItem{id}";
  const query = `query($query:String!${location ? ",$location:ID!" : ""}){products(first:1,query:$query){nodes{id variants(first:100){nodes{id sku price compareAtPrice ${inventoryFields}}}}}}`;
  const result = await shopify<{ data: { products: { nodes: ShopifyProduct[] } } }>("find_variant", query, { query: `sku:${JSON.stringify(productId)}`, ...(location ? { location } : {}) });
  const product = result.data.products.nodes[0];
  const variant = product?.variants.nodes.find((item) => item.sku === productId);
  if (!product || !variant) { const error = new Error(`No se encontró una variante Shopify con SKU ${productId}.`) as ErrorWithDetails; error.details = { provider: "shopify", operation: "find_variant", variables: { sku: productId, ...(location ? { location } : {}) }, response: result }; throw error; }
  return { product, variant };
}
async function updatePrice(product: ShopifyProduct, variant: ShopifyVariant, desiredPrice: number, desiredCompare: number | null) {
  const variants: Record<string, unknown>[] = [{ id: variant.id, price: desiredPrice }];
  if (desiredCompare !== null) variants[0].compareAtPrice = desiredCompare;
  const result = await shopify<{ data: { productVariantsBulkUpdate: { userErrors: { field?: string[]; message: string; code?: string }[] } } }>("productVariantsBulkUpdate", "mutation($productId:ID!,$variants:[ProductVariantsBulkInput!]!){productVariantsBulkUpdate(productId:$productId,variants:$variants){userErrors{field message code}}}", { productId: product.id, variants });
  const errors = result.data.productVariantsBulkUpdate.userErrors;
  if (errors.length) { const error = new Error(errors.map((item) => item.message).join(" ")) as ErrorWithDetails; error.details = { provider: "shopify", operation: "productVariantsBulkUpdate", variables: { productId: product.id, variants }, response: result, user_errors: errors }; throw error; }
}
async function updateStock(variant: ShopifyVariant, location: string, quantity: number, reference: string) {
  const inventoryItemId = variant.inventoryItem?.id;
  if (!inventoryItemId) throw new Error("La variante Shopify no tiene artículo de inventario.");
  const input = { reason: "correction", referenceDocumentUri: stockReference(reference), setQuantities: [{ inventoryItemId, locationId: location, quantity, changeFromQuantity: null }] };
  const idempotencyKey = `stock-${encodeURIComponent(reference)}`;
  const result = await shopify<{ data: { inventorySetOnHandQuantities: { userErrors: { field?: string[]; message: string; code?: string }[] } } }>("inventorySetOnHandQuantities", "mutation($input:InventorySetOnHandQuantitiesInput!,$idempotencyKey:String!) {inventorySetOnHandQuantities(input:$input) @idempotent(key:$idempotencyKey) {userErrors{field message code}}}", { input, idempotencyKey });
  const errors = result.data.inventorySetOnHandQuantities.userErrors;
  if (errors.length) { const error = new Error(errors.map((item) => item.message).join(" ")) as ErrorWithDetails; error.details = { provider: "shopify", operation: "inventorySetOnHandQuantities", variables: { input }, response: result, user_errors: errors }; throw error; }
}
async function findStockVariants(productIds: string[]) {
  const { data, error } = await db.from("product_shopify_links").select("source_sku,shopify_product_id,shopify_variant_id,shopify_inventory_item_id").eq("link_status", "linked").not("shopify_inventory_item_id", "is", null).in("source_sku", productIds);
  if (error) throw error;
  return new Map((data ?? []).map((item) => [item.source_sku, { id: item.shopify_variant_id, sku: item.source_sku, product: { id: item.shopify_product_id }, inventoryItem: { id: item.shopify_inventory_item_id } }]));
}
async function findPriceVariants(productIds: string[]) {
  const { data, error } = await db.from("product_shopify_links").select("source_sku,shopify_product_id,shopify_variant_id").eq("link_status", "linked").in("source_sku", productIds);
  if (error) throw error;
  return new Map((data ?? []).map((item) => [item.source_sku, { id: item.shopify_variant_id, sku: item.source_sku, price: null, compareAtPrice: null, product: { id: item.shopify_product_id } }]));
}
async function updateStockBatch(items: { inventoryItemId: string; quantity: number }[], location: string, reference: string) {
  const input = { reason: "correction", referenceDocumentUri: stockReference(reference), setQuantities: items.map((item) => ({ inventoryItemId: item.inventoryItemId, locationId: location, quantity: item.quantity, changeFromQuantity: null })) };
  const idempotencyKey = `stock-${encodeURIComponent(reference)}`;
  const result = await shopify<{ data: { inventorySetOnHandQuantities: { userErrors: { field?: string[]; message: string; code?: string }[] } } }>("inventorySetOnHandQuantities", "mutation($input:InventorySetOnHandQuantitiesInput!,$idempotencyKey:String!) {inventorySetOnHandQuantities(input:$input) @idempotent(key:$idempotencyKey) {userErrors{field message code}}}", { input, idempotencyKey });
  const errors = result.data.inventorySetOnHandQuantities.userErrors;
  if (errors.length) { const error = new Error(errors.map((item) => item.message).join(" ")) as ErrorWithDetails; error.details = { provider: "shopify", operation: "inventorySetOnHandQuantities", variables: { input, idempotencyKey }, response: result, user_errors: errors }; throw error; }
}
async function log(runId: string, values: Record<string, unknown>) {
  const { error } = await db.from("price_stock_import_events").insert({ run_id: runId, ...values });
  if (error) throw error;
  if (values.outcome === "updated" && values.source_row_id) {
    const { data: run, error: runError } = await db.from("price_stock_import_runs").select("import_type").eq("id", runId).single();
    if (runError) throw runError;
    const table = run.import_type === "prices" ? "source_prices" : "source_stock";
    const { error: syncError } = await db.from(table).update({ shopify_synced: true }).eq("id", values.source_row_id);
    if (syncError) throw syncError;
  }
  if (values.outcome === "error" && values.source_row_id) {
    const { data: run, error: runError } = await db.from("price_stock_import_runs").select("import_type").eq("id", runId).single();
    if (runError) throw runError;
    const table = run.import_type === "prices" ? "source_prices" : "source_stock";
    const { error: pendingError } = await db.from(table).update({ shopify_synced: false }).eq("id", values.source_row_id);
    if (pendingError) throw pendingError;
  }
}
async function archive(type: ImportType, messageId: number) { await db.rpc("archive_price_stock_import_message", { p_import_type: type, p_message_id: messageId }); }
async function triggerNext(type: ImportType) {
  await fetch(`${env("SUPABASE_URL")}/functions/v1/sync-price-stock-imports`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${env("SUPABASE_SERVICE_ROLE_KEY")}`, apikey: env("SUPABASE_SERVICE_ROLE_KEY") }, body: JSON.stringify({ importType: type }) });
}
async function nextRow(run: Run) {
  const { data, error } = await db.rpc("next_price_stock_import_source_row", { p_run_id: run.id });
  if (error) throw error;
  return data as Record<string, unknown> | null;
}

async function processMessage(type: ImportType, message: { msg_id: number; message?: { run_id?: string }; read_ct?: number }) {
  const messageId = Number(message.msg_id); const runId = message.message?.run_id;
  if (!runId) return archive(type, messageId);
  const { data: initial, error } = await db.from("price_stock_import_runs").select("*").eq("id", runId).maybeSingle();
  if (error || !initial || initial.import_type !== type || ["completed", "stopped", "failed"].includes(initial.status)) return archive(type, messageId);
  if (initial.status === "paused") return;
  const workerToken = crypto.randomUUID();
  const { data: claimed, error: claimError } = await db.rpc("claim_price_stock_import_worker", { p_run_id: runId, p_worker_token: workerToken });
  if (claimError) throw claimError;
  if (!claimed) return;
  const started = Date.now(); let run = initial as Run; let location: string | null = null;
  try {
    while (run.processed_count < run.total_count) {
      if (Date.now() - started >= WORKER_BUDGET_MS) {
        const next = await db.rpc("enqueue_next_price_stock_import_message", { p_import_type: type, p_run_id: runId, p_message_id: messageId }); if (next.error) throw next.error; await db.rpc("release_price_stock_import_worker", { p_run_id: runId, p_worker_token: workerToken }); await triggerNext(type); return;
      }
      const { data: control } = await db.from("price_stock_import_runs").select("*").eq("id", runId).single(); run = control as Run;
      if (run.status === "paused") { await db.rpc("release_price_stock_import_worker", { p_run_id: runId, p_worker_token: workerToken }); return; }
      if (run.status === "stopped") { await db.rpc("release_price_stock_import_worker", { p_run_id: runId, p_worker_token: workerToken }); return archive(type, messageId); }
      if (type === "prices") {
        const batch: Record<string, unknown>[] = [];
        while (batch.length < STOCK_BATCH_SIZE && run.processed_count + batch.length < run.total_count) { const source = await nextRow(run); if (!source) break; batch.push(source); const cursor = String(source.id); await db.from("price_stock_import_runs").update({ cursor_source_id: cursor }).eq("id", runId).eq("worker_token", workerToken); run = { ...run, cursor_source_id: cursor }; }
        if (!batch.length) break;
        const variants = await findPriceVariants(batch.map((source) => String(source.id_product)));
        for (const source of batch) { const productId = String(source.id_product); const variant = variants.get(productId); let outcome: "updated" | "unchanged" | "error" = "error"; let warning = false; let note = ""; let details: Record<string, unknown> | null = null; try { const tariff = Number(source.precio_tarifa); if (!Number.isFinite(tariff)) throw new Error("El precio de tarifa de origen no es válido."); if (!variant) throw new Error(`No se encontró una variante Shopify con SKU ${productId}.`); const desiredPrice = money(tariff * 1.21)!; const desiredCompare = source.product_price == null || !Number(source.product_price) ? null : money(Number(source.product_price) * 1.21); const priceChanged = !sameMoney(variant.price, desiredPrice); const compareChanged = desiredCompare !== null && !sameMoney(variant.compareAtPrice, desiredCompare); warning = desiredCompare === null; if (priceChanged || compareChanged) { await updatePrice({ id: variant.product.id, variants: { nodes: [variant as ShopifyVariant] } }, variant as ShopifyVariant, desiredPrice, desiredCompare); outcome = "updated"; note = `Precio ${desiredPrice.toFixed(2)} € actualizado.`; } else { outcome = "unchanged"; note = "Precio ya sincronizado: sin cambios."; } if (warning) note += " Aviso: no se sincronizó el precio comparado porque falta en origen."; } catch (caught) { details = errorDetails(caught, { import_type: "prices", source_row_id: source.id, product_id: productId, operation: "price_sync", retry_count: Number(message.read_ct ?? 1) }); note = String(details.message); } const counts = { processed_count: run.processed_count + 1, cursor_source_id: String(source.id), updated_count: run.updated_count + (outcome === "updated" ? 1 : 0), unchanged_count: run.unchanged_count + (outcome === "unchanged" ? 1 : 0), warning_count: run.warning_count + (warning ? 1 : 0), error_count: run.error_count + (outcome === "error" ? 1 : 0), updated_at: new Date().toISOString() }; await db.from("price_stock_import_runs").update(counts).eq("id", runId); await log(runId, { level: outcome === "error" ? "error" : warning ? "warning" : "success", outcome, source_row_id: source.id, product_id: productId, shopify_product_id: variant?.product.id ?? null, shopify_variant_id: variant?.id ?? null, message: note, ...(details ? { details } : {}) }); run = { ...run, ...counts }; }
        continue;
      }
      if (type === "stock") {
        location ??= await locationId(); const batch: Record<string, unknown>[] = []; let batchCursor = run.cursor_source_id;
        while (batch.length < STOCK_BATCH_SIZE && run.processed_count + batch.length < run.total_count) { const source = await nextRow(run); if (!source) break; batch.push(source); batchCursor = String(source.id); await db.from("price_stock_import_runs").update({ cursor_source_id: batchCursor }).eq("id", runId).eq("worker_token", workerToken); run = { ...run, cursor_source_id: batchCursor }; }
        if (!batch.length) break;
        const variants = await findStockVariants(batch.map((source) => String(source.id_product)));
        const accepted = batch.filter((source) => variants.has(String(source.id_product)));
        let batchError: Record<string, unknown> | null = null;
        try { if (accepted.length) await updateStockBatch(accepted.map((source) => ({ inventoryItemId: variants.get(String(source.id_product))!.inventoryItem!.id, quantity: source.available_for_order === false ? 0 : Math.max(0, Math.trunc(Number(source.quantity ?? 0)) || 0) })), location, `${runId}/${batch[0].id}-${batch[batch.length - 1].id}`); }
        catch (caught) { batchError = errorDetails(caught, { import_type: "stock", operation: "stock_batch_sync", retry_count: Number(message.read_ct ?? 1) }); }
        for (const source of batch) { const productId = String(source.id_product); const variant = variants.get(productId); const details = !variant ? { import_type: "stock", operation: "find_stock_variants", product_id: productId, message: `No se encontró una variante Shopify con SKU ${productId}.` } : batchError; const outcome: "updated" | "error" = details ? "error" : "updated"; const quantity = source.available_for_order === false ? 0 : Math.max(0, Math.trunc(Number(source.quantity ?? 0)) || 0); const counts = { processed_count: run.processed_count + 1, cursor_source_id: String(source.id), updated_count: run.updated_count + (outcome === "updated" ? 1 : 0), error_count: run.error_count + (outcome === "error" ? 1 : 0), updated_at: new Date().toISOString() }; await db.from("price_stock_import_runs").update(counts).eq("id", runId); await log(runId, { level: outcome === "updated" ? "success" : "error", outcome, source_row_id: source.id, product_id: productId, shopify_product_id: variant?.product.id ?? null, shopify_variant_id: variant?.id ?? null, message: outcome === "updated" ? `Stock ${quantity} confirmado por Shopify (lote).` : String(details.message), details }); run = { ...run, ...counts }; }
        continue;
      }
      const source = await nextRow(run); if (!source) break;
      const productId = String(source.id_product); await db.rpc("heartbeat_price_stock_import_worker", { p_run_id: runId, p_worker_token: workerToken, p_source_id: source.id, p_product_id: productId, p_operation: "sincronizando Shopify" });
      let outcome: "updated" | "unchanged" | "error" = "error"; let level: "success" | "warning" | "error" = "error"; let note = ""; let details: Record<string, unknown> | null = null; let shopifyProductId: string | null = null; let shopifyVariantId: string | null = null; let warning = false;
      try {
        if (type === "prices") {
          const tariff = Number(source.precio_tarifa); if (!Number.isFinite(tariff)) throw new Error("El precio de tarifa de origen no es válido.");
          const desiredPrice = money(tariff * 1.21)!;
          // Igual que el alta de producto: un precio comparado vacío o cero no se envía.
          // En una actualización se conserva el valor Shopify y se deja advertencia.
          const desiredCompare = source.product_price == null || !Number(source.product_price) ? null : money(Number(source.product_price) * 1.21);
          const found = await findVariant(productId); shopifyProductId = found.product.id; shopifyVariantId = found.variant.id;
          const priceChanged = !sameMoney(found.variant.price, desiredPrice); const compareChanged = desiredCompare !== null && !sameMoney(found.variant.compareAtPrice, desiredCompare);
          warning = desiredCompare === null;
          if (priceChanged || compareChanged) { await updatePrice(found.product, found.variant, desiredPrice, desiredCompare); outcome = "updated"; note = `Precio ${desiredPrice.toFixed(2)} €${compareChanged ? `; precio comparado ${desiredCompare?.toFixed(2)} €` : ""} actualizado.`; }
          else { outcome = "unchanged"; note = "Precio ya sincronizado: sin cambios."; }
          if (warning) note += " Aviso: no se sincronizó el precio comparado porque source_products.price está vacío; no se eliminó el valor existente en Shopify.";
          level = warning ? "warning" : "success";
        } else {
          location ??= await locationId();
          const desired = source.available_for_order === false ? 0 : Math.max(0, Math.trunc(Number(source.quantity ?? 0)) || 0);
          // El origen es la fuente de verdad para stock: no se consulta el nivel actual.
          // Shopify confirma la recepción de la cantidad absoluta, pero no permite atribuir
          // de forma fiable un posible delta cero a cada fila de un lote.
          const found = await findVariant(productId); shopifyProductId = found.product.id; shopifyVariantId = found.variant.id;
          await updateStock(found.variant, location, desired, `${runId}/${source.id}`);
          outcome = "updated"; level = "success"; note = `Stock ${desired} confirmado por Shopify.`;
        }
      } catch (caught) { details = errorDetails(caught, { import_type: type, source_row_id: source.id, product_id: productId, operation: type === "prices" ? "price_sync" : "stock_sync", retry_count: Number(message.read_ct ?? 1) }); note = String(details.message); }
      const counts = { processed_count: run.processed_count + 1, cursor_source_id: source.id, updated_count: run.updated_count + (outcome === "updated" ? 1 : 0), unchanged_count: run.unchanged_count + (outcome === "unchanged" ? 1 : 0), warning_count: run.warning_count + (warning ? 1 : 0), error_count: run.error_count + (outcome === "error" ? 1 : 0), updated_at: new Date().toISOString() };
      await db.from("price_stock_import_runs").update(counts).eq("id", runId);
      await log(runId, { level, outcome, source_row_id: source.id, product_id: productId, shopify_product_id: shopifyProductId, shopify_variant_id: shopifyVariantId, message: note, ...(details ? { details } : {}) });
      run = { ...run, ...counts };
    }
    await db.from("price_stock_import_runs").update({ status: "completed", finished_at: new Date().toISOString() }).eq("id", runId);
    await log(runId, { level: "info", outcome: "status", message: "Importación completada." }); await db.rpc("release_price_stock_import_worker", { p_run_id: runId, p_worker_token: workerToken }); await archive(type, messageId);
  } catch (caught) {
    const details = errorDetails(caught, { import_type: type, operation: "price_stock_worker", retry_count: Number(message.read_ct ?? 1) }); const attempt = Number(message.read_ct ?? 1);
    await db.rpc("release_price_stock_import_worker", { p_run_id: runId, p_worker_token: workerToken });
    if (attempt >= 3) { await db.from("price_stock_import_runs").update({ status: "failed", finished_at: new Date().toISOString() }).eq("id", runId); await log(runId, { level: "error", outcome: "status", message: `Importación fallida: ${details.message}`, details }); await archive(type, messageId); }
    else { await db.from("price_stock_import_runs").update({ status: "queued" }).eq("id", runId); await log(runId, { level: "warning", outcome: "status", message: `Reintento ${attempt}: ${details.message}`, details }); }
  }
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return response({ error: "Método no permitido" }, 405);
  try {
    const body = await request.json().catch(() => ({})) as { importType?: ImportType };
    if (body.importType !== "prices" && body.importType !== "stock") return response({ error: "importType debe ser prices o stock" }, 400);
    const { data, error } = await db.rpc("read_price_stock_import_message", { p_import_type: body.importType });
    if (error) throw error; if (!data) return response({ processed: false }); EdgeRuntime.waitUntil(processMessage(body.importType, data)); return response({ processed: true }, 202);
  } catch (error) { console.error("price/stock worker failed", error); return response({ error: errorDetails(error).message }, 500); }
});
