import type { SupabaseClient } from "@supabase/supabase-js";

// Identificadores de cada extremo (store_shopify_ids, 2026-10-29): por código de MHD, el producto, la variante y el
// artículo de inventario de Shopify, con la dirección, el EAN y el estado y título que les pone el importador. Los
// escribe quien escribe en Shopify; sustituyen al espejo de la tienda.
type ProductNode = { id: string; handle: string; status: string; title: string; variants: { nodes: { id: string; sku?: string | null; barcode?: string | null; inventoryItem?: { id: string } | null }[] } };

export async function rememberShopifyIds(db: SupabaseClient, codigo: string, product: ProductNode) {
  const variant = product.variants.nodes.find((node) => node.sku === codigo) ?? product.variants.nodes[0];
  if (!variant) return;
  const { error } = await db.from("store_shopify_ids").upsert({ codigo, product_id: product.id, variant_id: variant.id, inventory_item_id: variant.inventoryItem?.id ?? null, handle: product.handle, ean: variant.barcode ?? null, status: product.status, title: product.title, updated_at: new Date().toISOString() }, { onConflict: "codigo" });
  if (error) throw new Error(`No se pudieron guardar los identificadores de Shopify: ${error.message}`);
}

export async function rememberShopifyStatus(db: SupabaseClient, productId: string, status: string) {
  await db.from("store_shopify_ids").update({ status, updated_at: new Date().toISOString() }).eq("product_id", productId);
}
