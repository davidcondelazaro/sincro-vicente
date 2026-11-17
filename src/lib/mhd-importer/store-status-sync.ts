import type { SupabaseClient } from "@supabase/supabase-js";
import { sendAlert } from "./alerts";
import { shopifyGraphql, type ShopifyConfig } from "./store-filters";

// Estados de la tienda (David, 2026-11-17). `store_shopify_ids` solo se actualizaba cuando un proceso nuestro escribía en
// Shopify, así que lo que se cambiaba a mano o con un script se quedaba viejo: el 17-11 decía 349 borradores y 0
// archivados, y Shopify tenía 84 y 2.855 (los publicados en la revisión del 15-11 seguían como borradores). Cada noche se
// leen de Shopify los borradores y los archivados (unos miles, pocas consultas) y el resto de la tabla pasa a activo.
// No detecta productos borrados en Shopify: siguen como activos hasta que un proceso los toque.
const PAGE = 250;

async function productIds(shopify: ShopifyConfig, status: "draft" | "archived") {
  const ids: string[] = [];
  let after: string | null = null;
  do {
    const data: { products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: { id: string }[] } } = await shopifyGraphql(shopify,
      `query($after: String, $q: String!) { products(first: ${PAGE}, after: $after, query: $q) { pageInfo { hasNextPage endCursor } nodes { id } } }`, { after, q: `status:${status}` });
    ids.push(...data.products.nodes.map((node) => node.id));
    after = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
  } while (after);
  return ids;
}

export async function syncStoreStatuses(deps: { db: SupabaseClient; shopify: ShopifyConfig }, options: { dryRun?: boolean } = {}) {
  const { db, shopify } = deps;
  const [drafts, archived] = await Promise.all([productIds(shopify, "draft"), productIds(shopify, "archived")]);
  const { data, error } = await db.rpc("mhd_store_status_refresh", { p_draft: drafts, p_archived: archived, p_dry_run: options.dryRun ?? false });
  if (error) {
    await sendAlert(db, { key: "estados-tienda:error", subject: "Estados de la tienda: no se pudieron guardar", lines: [error.message] });
    throw new Error(error.message);
  }
  const summary = { shopifyDrafts: drafts.length, shopifyArchived: archived.length, ...(data as Record<string, unknown>) };
  if (!options.dryRun) await db.from("mhd_sync_events").insert({ sync: "estados-tienda", kind: "vuelta", detail: summary });
  return summary;
}
