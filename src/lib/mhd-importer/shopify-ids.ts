import type { SupabaseClient } from "@supabase/supabase-js";
import { shopifyGraphql, type ShopifyConfig } from "./store-filters";

// Identificadores de cada extremo (store_shopify_ids, 2026-10-29): por código de MHD, el producto, la variante y el
// artículo de inventario de Shopify, con la dirección, el EAN y el estado, título y tipo (familia) que les pone el importador. Los
// escribe quien escribe en Shopify; sustituyen al espejo de la tienda.
// Lo que se pide a Shopify al crear o actualizar un producto: lo justo para guardar sus identificadores.
export const ID_PRODUCT_FIELDS = "id handle status title productType variants(first: 10) { nodes { id sku barcode inventoryItem { id } } }";
type ProductNode = { id: string; handle: string; status: string; title: string; productType?: string | null; variants: { nodes: { id: string; sku?: string | null; barcode?: string | null; inventoryItem?: { id: string } | null }[] } };

export async function rememberShopifyIds(db: SupabaseClient, codigo: string, product: ProductNode) {
  const variant = product.variants.nodes.find((node) => node.sku === codigo) ?? product.variants.nodes[0];
  if (!variant) return;
  const { error } = await db.from("store_shopify_ids").upsert({ codigo, product_id: product.id, variant_id: variant.id, inventory_item_id: variant.inventoryItem?.id ?? null, handle: product.handle, ean: variant.barcode ?? null, status: product.status, title: product.title, product_type: product.productType || null, updated_at: new Date().toISOString() }, { onConflict: "codigo" });
  if (error) throw new Error(`No se pudieron guardar los identificadores de Shopify: ${error.message}`);
}

export async function rememberShopifyStatus(db: SupabaseClient, productId: string, status: string) {
  await db.from("store_shopify_ids").update({ status, updated_at: new Date().toISOString() }).eq("product_id", productId);
}

// Lo puntual se pregunta a Shopify en el momento (una consulta ligera por producto; el importador tarda un minuto o
// más en cada uno, así que no pesa). Los productos de la tienda con este EAN, también los que no son de MHD.
export async function storeProductsByEan(shopify: ShopifyConfig, ean: string) {
  const data = await shopifyGraphql<{ productVariants: { nodes: { product: { id: string; status: string; createdAt: string } }[] } }>(shopify,
    `query($q: String!) { productVariants(first: 20, query: $q) { nodes { product { id status createdAt } } } }`, { q: `barcode:"${ean.replace(/"/g, "")}"` });
  const byId = new Map(data.productVariants.nodes.map((node) => [node.product.id, node.product]));
  return [...byId.values()];
}

// El producto de la tienda que ya tiene esta dirección, si hay alguno.
export async function handleOwner(shopify: ShopifyConfig, handle: string) {
  const data = await shopifyGraphql<{ productByIdentifier: { id: string } | null }>(shopify, `query($h: String!) { productByIdentifier(identifier: { handle: $h }) { id } }`, { h: handle });
  return data.productByIdentifier?.id ?? null;
}
