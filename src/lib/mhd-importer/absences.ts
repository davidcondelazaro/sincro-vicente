import type { SupabaseClient } from "@supabase/supabase-js";
import { sendAlert } from "./alerts";
import type { SourcesConfig } from "./gather";
import { STORE_RULES } from "./processor";
import { fetchMhdProductDetail } from "./sources";
import { shopifyGraphql } from "./store-filters";

// Agotados en MHD (David, 2026-10-29; diseño en docs/SINCRONIZACIONES_MHD.md). MHD quita de su listado lo que su
// proveedor no tiene y lo vuelve a poner cuando hay stock: desaparecer = agotado, no baja. Paso de la vuelta, después
// de precio y stock:
//   1. Los productos de la tienda (activos o en borrador) que no vienen en la lectura se confirman uno a uno con su
//      ficha de MHD: solo un «no existe» (404) cuenta; si existe, la lectura por páginas se lo saltó y no se toca.
//   2. Confirmados: stock 0 en «Almacén MHD» y, si se vendían sin stock (BSH, Electrolux…), dejan de venderse así
//      mientras falten. Siguen publicados. Freno: si en una vuelta son más del `absence_brake_pct` % de la tienda, no se
//      toca nada y se avisa (salvo `force`, para la primera puesta al día).
//   3. Los que vuelven a venir: se les devuelve «vender sin stock» si lo tenían (el stock lo repone precio y stock).
//   4. Los que llevan más de `absence_days` días sin volver quedan «pendientes de baja» (archivar y redirigir, aparte).
const CONFIRM_CONCURRENCY = 8, SHOPIFY_CONCURRENCY = 5, STOCK_BATCH = 250;
type Candidate = { codigo: string; product_id: string; variant_id: string; inventory_item_id: string | null; product_status: string };
type UserError = { message: string };

async function setting(db: SupabaseClient, key: string, fallback: number) {
  const { data } = await db.from("store_settings").select("value").eq("key", key).maybeSingle();
  const value = Number(data?.value);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function pool<T>(items: T[], size: number, work: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => { while (next < items.length) await work(items[next++]); }));
}

const setPolicy = (deps: { shopify: SourcesConfig["shopify"] }, productId: string, variantId: string, policy: "CONTINUE" | "DENY") =>
  shopifyGraphql<{ productVariantsBulkUpdate: { userErrors: UserError[] } }>(deps.shopify, `mutation($product: ID!, $variants: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $product, variants: $variants) { userErrors { message } } }`, { product: productId, variants: [{ id: variantId, inventoryPolicy: policy }] })
    .then((result) => { if (result.productVariantsBulkUpdate.userErrors.length) throw new Error(result.productVariantsBulkUpdate.userErrors.map((item) => item.message).join("; ")); });

export async function syncAbsences(deps: { db: SupabaseClient; sources: SourcesConfig }, options: { runId: string; cycleId?: string; dryRun?: boolean; force?: boolean }) {
  const db = deps.db;
  const [days, brakePct] = await Promise.all([setting(db, "absence_days", 30), setting(db, "absence_brake_pct", 2)]);
  const summary = { candidates: 0, confirmed: 0, skippedByRead: 0, applied: 0, policyOff: 0, returned: 0, policyBack: 0, open: 0, due: 0, braked: false, errors: [] as string[] };

  // 1. Candidatos, confirmados con la ficha de MHD.
  const { data: candidateRows, error } = await db.rpc("mhd_absence_candidates", { p_run: options.runId });
  if (error) throw error;
  const candidates = (candidateRows ?? []) as Candidate[];
  summary.candidates = candidates.length;
  const confirmed: Candidate[] = []; const skipped: string[] = [];
  await pool(candidates, CONFIRM_CONCURRENCY, async (item) => {
    try { const detail = await fetchMhdProductDetail(deps.sources.mhd, item.codigo); if (detail.status === 404) confirmed.push(item); else skipped.push(item.codigo); }
    catch (caught) { summary.errors.push(`Ficha ${item.codigo}: ${caught instanceof Error ? caught.message : String(caught)}`); }
  });
  summary.confirmed = confirmed.length; summary.skippedByRead = skipped.length;

  // 2. Freno y aplicación.
  const { count: storeSize } = await db.from("shopify_products").select("product_id", { count: "exact", head: true }).eq("status", "ACTIVE");
  const limit = Math.max(1, Math.round((storeSize ?? 0) * brakePct / 100));
  if (confirmed.length > limit && !options.force) {
    summary.braked = true;
    if (!options.dryRun) await sendAlert(db, { key: "agotados:freno", subject: `Freno: ${confirmed.length} productos desaparecidos de MHD de golpe`, lines: [`En esta vuelta MHD ha dejado de traer ${confirmed.length} productos de la tienda (confirmados uno a uno), más del ${brakePct} % (${limit}).`, "No se ha tocado nada: revisa si es normal antes de aplicarlo."], href: "/importar-datos-mhd" });
  } else if (!options.dryRun && confirmed.length) {
    // Estado actual de cada variante (política y stock), de 250 en 250.
    const current = new Map<string, { policy: string; stock: number | null }>();
    for (let i = 0; i < confirmed.length; i += STOCK_BATCH) {
      const ids = confirmed.slice(i, i + STOCK_BATCH).map((item) => item.variant_id);
      const result = await shopifyGraphql<{ nodes: ({ id: string; inventoryPolicy: string; inventoryQuantity: number | null } | null)[] }>(deps.sources.shopify, `query($ids: [ID!]!) { nodes(ids: $ids) { ... on ProductVariant { id inventoryPolicy inventoryQuantity } } }`, { ids });
      for (const node of result.nodes) if (node) current.set(node.id, { policy: node.inventoryPolicy, stock: node.inventoryQuantity });
    }
    const location = STORE_RULES.locationIds["Almacén MHD"];
    const done = new Set<string>();
    for (let i = 0; i < confirmed.length; i += STOCK_BATCH) {
      const batch = confirmed.slice(i, i + STOCK_BATCH).filter((item) => item.inventory_item_id);
      try {
        const result = await shopifyGraphql<{ inventorySetQuantities: { userErrors: UserError[] } }>(deps.sources.shopify, `mutation($input: InventorySetQuantitiesInput!, $key: String!) { inventorySetQuantities(input: $input) @idempotent(key: $key) { userErrors { message } } }`, { key: crypto.randomUUID(), input: { name: "on_hand", reason: "correction", referenceDocumentUri: `gid://sincro-vicente/SyncJob/agotados-${options.runId}`, quantities: batch.map((item) => ({ inventoryItemId: item.inventory_item_id, locationId: location, quantity: 0, changeFromQuantity: null })) } });
        if (result.inventorySetQuantities.userErrors.length) throw new Error(result.inventorySetQuantities.userErrors.map((item) => item.message).join("; "));
        for (const item of batch) done.add(item.codigo);
      } catch (caught) { summary.errors.push(`Stock a 0 (${batch.length}): ${caught instanceof Error ? caught.message : String(caught)}`); }
    }
    const selling = confirmed.filter((item) => done.has(item.codigo) && current.get(item.variant_id)?.policy === "CONTINUE");
    const policyOff = new Set<string>();
    await pool(selling, SHOPIFY_CONCURRENCY, async (item) => {
      try { await setPolicy({ shopify: deps.sources.shopify }, item.product_id, item.variant_id, "DENY"); policyOff.add(item.codigo); }
      catch (caught) { summary.errors.push(`Vender sin stock ${item.codigo}: ${caught instanceof Error ? caught.message : String(caught)}`); }
    });
    const applied = confirmed.filter((item) => done.has(item.codigo));
    if (applied.length) {
      const { error: insertError } = await db.from("mhd_missing_products").insert(applied.map((item) => ({ codigo: item.codigo, product_id: item.product_id, variant_id: item.variant_id, inventory_item_id: item.inventory_item_id, stock_before: current.get(item.variant_id)?.stock ?? null, policy_before: current.get(item.variant_id)?.policy ?? null, cycle_id: options.cycleId ?? null })));
      if (insertError) summary.errors.push(`Guardar desaparecidos: ${insertError.message}`);
      // Lo último enviado pasa a 0: cuando vuelva, precio y stock verá el cambio y lo repondrá.
      for (let i = 0; i < applied.length; i += 500) await db.from("mhd_shopify_price_stock").update({ stock: 0, sent_at: new Date().toISOString() }).in("codigo", applied.slice(i, i + 500).map((item) => item.codigo));
      for (let i = 0; i < applied.length; i += 1000) await db.from("mhd_sync_events").insert(applied.slice(i, i + 1000).map((item) => ({ sync: "agotados", kind: "agotado", codigo: item.codigo, detail: { stock_antes: current.get(item.variant_id)?.stock ?? null, vendia_sin_stock: policyOff.has(item.codigo), estado: item.product_status } })));
    }
    summary.applied = applied.length; summary.policyOff = policyOff.size;
  }

  // 3. Los que vuelven.
  const { data: returnRows, error: returnError } = await db.rpc("mhd_absence_returns", { p_run: options.runId });
  if (returnError) throw returnError;
  const returns = (returnRows ?? []) as { id: number; codigo: string; product_id: string; variant_id: string; policy_before: string | null }[];
  summary.returned = returns.length;
  if (!options.dryRun && returns.length) {
    let back = 0;
    await pool(returns.filter((item) => item.policy_before === "CONTINUE"), SHOPIFY_CONCURRENCY, async (item) => {
      try { await setPolicy({ shopify: deps.sources.shopify }, item.product_id, item.variant_id, "CONTINUE"); back += 1; }
      catch (caught) { summary.errors.push(`Devolver vender sin stock ${item.codigo}: ${caught instanceof Error ? caught.message : String(caught)}`); }
    });
    summary.policyBack = back;
    await db.from("mhd_missing_products").update({ returned_at: new Date().toISOString() }).in("id", returns.map((item) => item.id));
    await db.from("mhd_sync_events").insert(returns.map((item) => ({ sync: "agotados", kind: "repuesto", codigo: item.codigo, detail: { vuelve_a_vender_sin_stock: item.policy_before === "CONTINUE" } })));
  }

  // 4. Cuántos siguen fuera y cuántos pasan ya de los días acordados.
  const [{ count: open }, { count: due }] = await Promise.all([
    db.from("mhd_missing_products").select("id", { count: "exact", head: true }).is("returned_at", null).is("archived_at", null),
    db.from("mhd_missing_products").select("id", { count: "exact", head: true }).is("returned_at", null).is("archived_at", null).lt("missing_since", new Date(Date.now() - days * 86_400_000).toISOString()),
  ]);
  summary.open = open ?? 0; summary.due = due ?? 0;
  if (summary.errors.length && !options.dryRun) await sendAlert(db, { key: "agotados:error", subject: `Agotados en MHD: ${summary.errors.length} errores`, lines: summary.errors.slice(0, 10) });
  return { ...summary, days, brakePct, limit, skippedCodes: skipped.slice(0, 50) };
}
