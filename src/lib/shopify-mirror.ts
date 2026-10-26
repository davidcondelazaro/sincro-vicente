// Espejo de la tienda de Shopify (2026-10-26): copia local de productos, variantes y colecciones en Supabase
// (shopify_products, shopify_variants, shopify_collections). Se llena con una consulta masiva de Shopify (una sola
// petición para toda la tienda; Shopify prepara un fichero JSONL y se descarga) y cada subida de un producto actualiza
// su fila con `mirrorProduct`. Así las sincronizaciones no preguntan a Shopify producto a producto.
// Ver docs/ESPEJO_TIENDA_SHOPIFY.md.
import type { SupabaseClient } from "@supabase/supabase-js";
import { shopifyGraphql, type ShopifyConfig } from "./mhd-importer/store-filters";

// Lo que se guarda de cada producto. La misma selección vale para la consulta masiva y para la respuesta de una subida.
export const MIRROR_PRODUCT_FIELDS = "id handle status title vendor productType tags createdAt updatedAt category { id fullName }";
export const MIRROR_VARIANT_FIELDS = "id sku barcode price compareAtPrice inventoryPolicy inventoryItem { id }";

type ProductNode = { id: string; handle: string; status: string; title: string; vendor: string; productType: string; tags: string[]; createdAt: string; updatedAt: string; category: { id: string; fullName: string } | null };
type VariantNode = { id: string; sku: string | null; barcode: string | null; price: string | null; compareAtPrice: string | null; inventoryPolicy: string | null; inventoryItem: { id: string } | null };

const productRow = (node: ProductNode, syncedAt: string) => ({
  product_id: node.id, handle: node.handle, status: node.status, title: node.title, vendor: node.vendor, product_type: node.productType || null,
  tags: node.tags ?? [], category_id: node.category?.id ?? null, category_name: node.category?.fullName ?? null,
  shopify_created_at: node.createdAt, shopify_updated_at: node.updatedAt, synced_at: syncedAt,
});
const variantRow = (node: VariantNode, productId: string, syncedAt: string) => ({
  variant_id: node.id, product_id: productId, sku: node.sku || null, barcode: node.barcode || null,
  price: node.price === null ? null : Number(node.price), compare_at_price: node.compareAtPrice === null ? null : Number(node.compareAtPrice),
  inventory_policy: node.inventoryPolicy, inventory_item_id: node.inventoryItem?.id ?? null, synced_at: syncedAt,
});

async function upsertChunks(db: SupabaseClient, table: string, rows: Record<string, unknown>[], onConflict: string) {
  for (let i = 0; i < rows.length; i += 1000) {
    const { error } = await db.from(table).upsert(rows.slice(i, i + 1000), { onConflict });
    if (error) throw new Error(`No se pudo guardar ${table} en el espejo: ${error.message}`);
  }
}

// Un producto recién creado o actualizado en Shopify (con sus variantes): se guarda en el espejo al momento.
export async function mirrorProduct(db: SupabaseClient, product: ProductNode & { variants: { nodes: VariantNode[] } }) {
  const syncedAt = new Date().toISOString();
  // Si otro producto tenía antes esa dirección (borrado o renombrado en Shopify), deja de tenerla.
  await db.from("shopify_products").delete().eq("handle", product.handle).neq("product_id", product.id);
  await upsertChunks(db, "shopify_products", [productRow(product, syncedAt)], "product_id");
  await upsertChunks(db, "shopify_variants", product.variants.nodes.map((variant) => variantRow(variant, product.id, syncedAt)), "variant_id");
  await db.from("shopify_variants").delete().eq("product_id", product.id).lt("synced_at", syncedAt);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Refresco completo: consulta masiva de productos y variantes, y las colecciones por páginas (son pocas). Lo que ya
// no está en Shopify se borra del espejo. Devuelve lo guardado. Tarda de segundos a pocos minutos según la tienda.
export async function refreshShopifyMirror(db: SupabaseClient, shopify: ShopifyConfig, options: { maxWaitMs?: number } = {}) {
  // Uno a la vez: los que llevan más de 15 min «en curso» se dan por caídos.
  await db.from("shopify_mirror_runs").update({ status: "error", error: "Se cortó sin terminar.", finished_at: new Date().toISOString() }).eq("status", "running").lt("started_at", new Date(Date.now() - 15 * 60_000).toISOString());
  const { data: run, error: runError } = await db.from("shopify_mirror_runs").insert({}).select("id,started_at").single();
  if (runError) return { skipped: true as const, reason: "Ya se está refrescando el espejo." };
  const syncedAt = run.started_at as string;
  try {
    type Started = { bulkOperationRunQuery: { bulkOperation: { id: string } | null; userErrors: { message: string }[] } };
    const started = await shopifyGraphql<Started>(shopify, `mutation($q: String!) { bulkOperationRunQuery(query: $q) { bulkOperation { id } userErrors { message } } }`,
      { q: `{ products { edges { node { ${MIRROR_PRODUCT_FIELDS} variants { edges { node { ${MIRROR_VARIANT_FIELDS} } } } } } } }` });
    const operation = started.bulkOperationRunQuery.bulkOperation;
    if (!operation) throw new Error(`Shopify no aceptó la consulta masiva: ${started.bulkOperationRunQuery.userErrors.map((item) => item.message).join("; ")}`);
    await db.from("shopify_mirror_runs").update({ bulk_operation_id: operation.id }).eq("id", run.id);
    // Se espera a que Shopify prepare el fichero.
    type Status = { bulkOperation: { status: string; url: string | null; errorCode: string | null; objectCount: string } | null };
    const deadline = Date.now() + (options.maxWaitMs ?? 240_000);
    let url: string | null = null;
    for (let wait = 1_000; ; wait = Math.min(wait * 1.5, 5_000)) {
      const { bulkOperation } = await shopifyGraphql<Status>(shopify, `query($id: ID!) { bulkOperation(id: $id) { status url errorCode objectCount } }`, { id: operation.id });
      if (bulkOperation?.status === "COMPLETED") { url = bulkOperation.url; break; }
      if (bulkOperation && ["FAILED", "CANCELED", "EXPIRED"].includes(bulkOperation.status)) throw new Error(`La consulta masiva de Shopify terminó en ${bulkOperation.status} (${bulkOperation.errorCode ?? "sin código"}).`);
      if (Date.now() > deadline) throw new Error("La consulta masiva de Shopify no terminó a tiempo.");
      await sleep(wait);
    }
    // Sin url: la tienda no tiene productos.
    const text = url ? await (await fetch(url, { signal: AbortSignal.timeout(120_000) })).text() : "";
    const products: ReturnType<typeof productRow>[] = []; const variants: ReturnType<typeof variantRow>[] = [];
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      const node = JSON.parse(line) as (ProductNode | VariantNode) & { __parentId?: string };
      if (node.__parentId) variants.push(variantRow(node as VariantNode, node.__parentId, syncedAt));
      else products.push(productRow(node as ProductNode, syncedAt));
    }
    await upsertChunks(db, "shopify_products", products, "product_id");
    await upsertChunks(db, "shopify_variants", variants, "variant_id");
    const collections = await readCollections(shopify, syncedAt);
    await upsertChunks(db, "shopify_collections", collections, "collection_id");
    // Lo que ya no está en Shopify.
    await db.from("shopify_variants").delete().lt("synced_at", syncedAt);
    await db.from("shopify_products").delete().lt("synced_at", syncedAt);
    await db.from("shopify_collections").delete().lt("synced_at", syncedAt);
    const summary = { products: products.length, variants: variants.length, collections: collections.length };
    await db.from("shopify_mirror_runs").update({ status: "done", finished_at: new Date().toISOString(), ...summary }).eq("id", run.id);
    return { skipped: false as const, ...summary };
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    await db.from("shopify_mirror_runs").update({ status: "error", finished_at: new Date().toISOString(), error: message }).eq("id", run.id);
    throw caught;
  }
}

async function readCollections(shopify: ShopifyConfig, syncedAt: string) {
  type Page = { collections: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: { id: string; handle: string; title: string; ruleSet: { appliedDisjunctively: boolean; rules: { column: string; relation: string; condition: string }[] } | null }[] } };
  const rows: Record<string, unknown>[] = []; let after: string | null = null;
  do {
    const page: Page = await shopifyGraphql<Page>(shopify, `query($after: String) { collections(first: 250, after: $after) { pageInfo { hasNextPage endCursor } nodes { id handle title ruleSet { appliedDisjunctively rules { column relation condition } } } } }`, { after });
    rows.push(...page.collections.nodes.map((node) => ({ collection_id: node.id, handle: node.handle, title: node.title, rules: node.ruleSet?.rules ?? null, disjunctive: node.ruleSet?.appliedDisjunctively ?? null, synced_at: syncedAt })));
    after = page.collections.pageInfo.hasNextPage ? page.collections.pageInfo.endCursor : null;
  } while (after);
  return rows;
}

// Antigüedad del último refresco completo, en horas (null si nunca se ha hecho).
export async function mirrorAgeHours(db: SupabaseClient) {
  const { data } = await db.from("shopify_mirror_runs").select("finished_at").eq("status", "done").order("finished_at", { ascending: false }).limit(1).maybeSingle();
  return data?.finished_at ? (Date.now() - new Date(data.finished_at).getTime()) / 3_600_000 : null;
}
