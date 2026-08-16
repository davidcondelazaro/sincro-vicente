/**
 * Completa la relación SKU Vicente -> IDs técnicos de Shopify.
 *
 * Ejecutar desde sincro-vicente con las variables de .env.local exportadas:
 *   set -a; source .env.local; set +a; npm run sync:shopify-links
 */

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Falta ${name} en el entorno.`);
  return value;
};

const shopifyStore = required("SHOPIFY_STORE_URL").replace(/^https?:\/\//, "").replace(/\/$/, "");
const shopifyToken = required("SHOPIFY_ACCESS_TOKEN");
const supabaseUrl = required("NEXT_PUBLIC_SUPABASE_URL").replace(/\/$/, "");
const ingestToken = required("CATALOG_INGEST_TOKEN");

async function shopify(query, variables) {
  const response = await fetch(`https://${shopifyStore}/admin/api/2026-07/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": shopifyToken },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json();
  if (!response.ok || body.errors?.length) throw new Error(body.errors?.map((item) => item.message).join(" ") || `Shopify devolvió HTTP ${response.status}.`);
  return body.data;
}

async function catalogRequest(body) {
  const response = await fetch(`${supabaseUrl}/functions/v1/import-source-catalog`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-catalog-ingest-token": ingestToken,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : `Supabase devolvió HTTP ${response.status}.`);
  return payload;
}

async function upsert(rows) {
  if (rows.length) await catalogRequest({ action: "shopify-links-upsert", rows });
}

async function sourceSkus(after) {
  const payload = await catalogRequest({ action: "shopify-links-skus", ...(after ? { afterSourceSku: after } : {}) });
  return payload.rows ?? [];
}

const variantsQuery = `query($query:String!){productVariants(first:250,query:$query){nodes{id sku inventoryItem{id} product{id handle status}}}}`;
async function shopifyVariants(skus) {
  const query = skus.map((sku) => `sku:${JSON.stringify(sku)}`).join(" OR ");
  const data = await shopify(variantsQuery, { query });
  const matches = new Map();
  for (const variant of data.productVariants.nodes) {
    const sku = variant.sku?.trim();
    if (!sku || !skus.includes(sku)) continue;
    const existing = matches.get(sku) ?? [];
    existing.push(variant);
    matches.set(sku, existing);
  }
  return matches;
}

const SHOPIFY_BATCH_SIZE = 50;
let sourceAfter = null;
let sourcePages = 0;
let processed = 0;
let linked = 0;
let missingInShopify = 0;
let ambiguousInShopify = 0;

do {
  const sourceRows = await sourceSkus(sourceAfter);
  if (!sourceRows.length) break;
  for (let index = 0; index < sourceRows.length; index += SHOPIFY_BATCH_SIZE) {
    const skus = sourceRows.slice(index, index + SHOPIFY_BATCH_SIZE).map((row) => String(row.id).trim()).filter(Boolean);
    const variantsBySku = await shopifyVariants(skus);
    const rows = [];
    for (const sku of skus) {
      const matches = variantsBySku.get(sku) ?? [];
      if (!matches.length) {
        missingInShopify += 1;
        rows.push({ source_sku: sku, link_status: "missing_in_shopify", shopify_match_count: 0, shopify_product_id: null, shopify_variant_id: null, shopify_inventory_item_id: null, shopify_handle: null, shopify_status: null });
        continue;
      }
      if (matches.length > 1) {
        ambiguousInShopify += 1;
        rows.push({ source_sku: sku, link_status: "ambiguous_in_shopify", shopify_match_count: matches.length, shopify_product_id: null, shopify_variant_id: null, shopify_inventory_item_id: null, shopify_handle: null, shopify_status: null });
        continue;
      }
      const variant = matches[0];
      linked += 1;
      rows.push({
        source_sku: sku,
        link_status: "linked",
        shopify_match_count: 1,
        shopify_product_id: variant.product.id,
        shopify_variant_id: variant.id,
        shopify_inventory_item_id: variant.inventoryItem?.id ?? null,
        shopify_handle: variant.product.handle,
        shopify_status: variant.product.status,
      });
    }
    await upsert(rows);
    processed += rows.length;
  }
  sourceAfter = String(sourceRows.at(-1).id);
  sourcePages += 1;
  process.stdout.write(`Página de origen ${sourcePages}: ${processed} SKU procesados; ${linked} enlaces guardados.\n`);
} while (true);

console.log(JSON.stringify({ source_pages: sourcePages, processed, linked, missing_in_shopify: missingInShopify, ambiguous_in_shopify: ambiguousInShopify }, null, 2));
