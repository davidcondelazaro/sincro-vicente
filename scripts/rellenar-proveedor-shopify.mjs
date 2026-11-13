/**
 * Relleno puntual del proveedor de MHD en Shopify (David, 2026-11-13).
 *
 * MHD manda desde el 12-11-2026 `cd_proveedor` y `nombre_proveedor` en cada producto. Este script lee el listado
 * completo de MHD y todos los productos de Shopify (por SKU = código MHD) y escribe los metacampos
 * custom.proveedor_codigo y custom.proveedor_nombre donde falten o no coincidan. Lo que MHD ya no tiene en el listado
 * se queda como está (sin proveedor, o con el que ya tuviera): no se borra nada.
 *
 * Ejecutar desde sincro-vicente:
 *   set -a; source .env.local; set +a
 *   node scripts/rellenar-proveedor-shopify.mjs            # en seco: solo cuenta y deja el CSV
 *   node scripts/rellenar-proveedor-shopify.mjs --limit 20 --apply
 *   node scripts/rellenar-proveedor-shopify.mjs --apply
 * Deja el resultado en outputs/proveedor-shopify-<fecha>.csv.
 */
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const limitAt = args.indexOf("--limit");
const limit = limitAt >= 0 ? Number(args[limitAt + 1]) : Infinity;

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Falta ${name} en el entorno.`);
  return value;
};
const trim = (value) => value.replace(/^\/+|\/+$/g, "");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- MHD ------------------------------------------------------------------------------------------------------------
const mhd = { url: required("MHD_API_URL"), version: required("MHD_API_VERSION"), subPath: required("MHD_API_SUB_PATH"), user: required("MHD_API_USER"), pass: required("MHD_API_PASS"), proxyUrl: process.env.MHD_PROXY_URL, proxyToken: process.env.MHD_PROXY_TOKEN };
const mhdAuth = `Basic ${Buffer.from(`${mhd.user}:${mhd.pass}`).toString("base64")}`;

// Igual que mhdFetch (src/lib/mhd-importer/sources.ts): por el proxy de Pladisel si está configurado, si no directa.
function mhdFetch(target) {
  if (mhd.proxyUrl && mhd.proxyToken) {
    const url = `${mhd.proxyUrl}${mhd.proxyUrl.includes("?") ? "&" : "?"}url=${encodeURIComponent(target)}`;
    return fetch(url, { headers: { "X-Proxy-Token": mhd.proxyToken, "X-MHD-Authorization": mhdAuth, Accept: "application/json" }, signal: AbortSignal.timeout(120_000) });
  }
  return fetch(target, { headers: { Origin: "https://utils.electronicavicente.com", Referer: "https://utils.electronicavicente.com/", "User-Agent": "Mozilla/5.0", Accept: "application/json", Authorization: mhdAuth }, signal: AbortSignal.timeout(120_000) });
}

async function mhdPage(page, pageSize) {
  const target = `${mhd.url.replace(/\/$/, "")}/api/${trim(mhd.version)}/${trim(mhd.subPath)}/products?page=${page}&pageSize=${pageSize}`;
  for (let attempt = 1; ; attempt++) {
    const response = await mhdFetch(target).catch((error) => ({ ok: false, status: String(error) }));
    if (response.ok) {
      const text = await response.text();
      const body = JSON.parse(text.slice(text.indexOf("{"))); // por si se cuela un Warning de PHP delante
      if (body.success) return body;
    }
    if (attempt >= 5) throw new Error(`MHD no devolvió la página ${page} (${response.status}).`);
    await sleep(3000 * attempt);
  }
}

async function mhdSuppliers() {
  const pageSize = 1000;
  const first = await mhdPage(1, pageSize);
  const pages = Math.ceil(first.extra.totalRecords / pageSize);
  const rows = [...first.data];
  for (let page = 2; page <= pages; page++) rows.push(...(await mhdPage(page, pageSize)).data);
  const map = new Map();
  for (const row of rows) {
    if (row.cd_proveedor === null || row.cd_proveedor === undefined || !row.nombre_proveedor?.trim()) continue;
    map.set(String(row.codigo), { codigo: Number(row.cd_proveedor), nombre: row.nombre_proveedor.trim() });
  }
  console.log(`MHD: ${rows.length} productos en el listado, ${map.size} con proveedor.`);
  return map;
}

// --- Shopify --------------------------------------------------------------------------------------------------------
const store = required("SHOPIFY_STORE_URL").replace(/^https?:\/\//, "").replace(/\/$/, "");
const token = required("SHOPIFY_ACCESS_TOKEN");

async function shopify(query, variables) {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(`https://${store}/admin/api/2026-07/graphql.json`, { method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(60_000) }).catch(() => null);
    const body = response ? await response.json().catch(() => null) : null;
    const throttled = !response || response.status === 429 || response.status >= 500 || body?.errors?.some((error) => error.extensions?.code === "THROTTLED");
    if (!throttled && body && !body.errors?.length) return body.data;
    if (!throttled || attempt >= 8) throw new Error(body?.errors?.map((error) => error.message).join(" ") || `Shopify devolvió HTTP ${response?.status}.`);
    await sleep(2000 * attempt);
  }
}

const productsQuery = `query($after: String) { products(first: 200, after: $after) { pageInfo { hasNextPage endCursor } nodes { id status variants(first: 1) { nodes { sku } }
  codigo: metafield(namespace: "custom", key: "proveedor_codigo") { value } nombre: metafield(namespace: "custom", key: "proveedor_nombre") { value } } } }`;

async function shopifyProducts() {
  const products = [];
  for (let after = null; ;) {
    const { products: page } = await shopify(productsQuery, { after });
    for (const node of page.nodes) products.push({ id: node.id, status: node.status, sku: node.variants.nodes[0]?.sku?.trim() ?? "", codigo: node.codigo?.value ?? null, nombre: node.nombre?.value ?? null });
    if (!page.pageInfo.hasNextPage) break;
    after = page.pageInfo.endCursor;
  }
  console.log(`Shopify: ${products.length} productos.`);
  return products;
}

const setMutation = `mutation($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { field message } } }`;

// --- Relleno --------------------------------------------------------------------------------------------------------
const csvCell = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;

const suppliers = await mhdSuppliers();
const products = await shopifyProducts();
const rows = [];
const changes = [];
for (const product of products) {
  const supplier = suppliers.get(product.sku);
  if (!supplier) { rows.push({ ...product, result: product.codigo ? "sin dato en MHD (se deja el que tenía)" : "sin dato en MHD" }); continue; }
  const same = product.codigo === String(supplier.codigo) && product.nombre === supplier.nombre;
  if (same) { rows.push({ ...product, result: "ya estaba" }); continue; }
  changes.push({ product, supplier });
}
const todo = changes.slice(0, limit);
console.log(`Por escribir: ${changes.length}${todo.length < changes.length ? ` (en esta pasada, ${todo.length})` : ""}. ${apply ? "Escribiendo…" : "En seco: no se escribe nada."}`);

const results = new Map();
if (apply) {
  // metafieldsSet admite 25 metacampos por llamada: 12 productos (24). Cuatro llamadas a la vez.
  const groups = [];
  for (let i = 0; i < todo.length; i += 12) groups.push(todo.slice(i, i + 12));
  let next = 0; let done = 0;
  async function worker() {
    while (next < groups.length) {
      const group = groups[next++];
      const metafields = group.flatMap(({ product, supplier }) => [
        { ownerId: product.id, namespace: "custom", key: "proveedor_codigo", type: "number_integer", value: String(supplier.codigo) },
        { ownerId: product.id, namespace: "custom", key: "proveedor_nombre", type: "single_line_text_field", value: supplier.nombre },
      ]);
      try {
        const { metafieldsSet } = await shopify(setMutation, { m: metafields });
        const error = metafieldsSet.userErrors.map((item) => item.message).join(" | ");
        for (const { product } of group) results.set(product.id, error ? `error: ${error}` : "escrito");
      } catch (error) {
        for (const { product } of group) results.set(product.id, `error: ${error.message}`);
      }
      done += group.length;
      if (done % 1200 < 12) console.log(`  ${done}/${todo.length}`);
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
}
for (const { product, supplier } of changes) {
  rows.push({ ...product, nuevo_codigo: supplier.codigo, nuevo_nombre: supplier.nombre, result: results.get(product.id) ?? (apply ? "pendiente (fuera del límite)" : "por escribir (en seco)") });
}

const counts = rows.reduce((acc, row) => ({ ...acc, [row.result.startsWith("error") ? "error" : row.result]: (acc[row.result.startsWith("error") ? "error" : row.result] ?? 0) + 1 }), {});
console.log("Resultado:", counts);
const file = `outputs/proveedor-shopify-${new Date().toISOString().slice(0, 10)}.csv`;
const header = ["product_id", "estado", "sku", "codigo_antes", "nombre_antes", "codigo_nuevo", "nombre_nuevo", "resultado"];
writeFileSync(file, [header.join(";"), ...rows.map((row) => [row.id, row.status, row.sku, row.codigo, row.nombre, row.nuevo_codigo, row.nuevo_nombre, row.result].map(csvCell).join(";"))].join("\n"));
console.log(`CSV: ${file}`);
