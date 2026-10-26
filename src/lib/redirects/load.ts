// Carga de la base de redirecciones (docs/REDIRECCIONES.md): una fila por URL vieja con su clave. Fuentes, por orden de
// autoridad: las redirecciones ya cargadas en Shopify, el inventario de la web vieja y Search Console (copias en
// data/redirecciones). Se puede repetir: solo actualiza las fuentes, la clave y los clics; el destino final, el estado y
// la nota que se pongan después no se tocan.
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { shopifyGraphql, type ShopifyConfig } from "../mhd-importer/store-filters";

type KeyType = "producto" | "producto_viejo" | "coleccion" | "categoria_vieja" | "marca" | "pagina" | "blog" | "otro";
type Row = { origin: string; sources: Set<string>; current_target: string | null; inventory_type: string | null; clicks: number; impressions: number };
const DATA = path.join(process.cwd(), "data", "redirecciones");

// CSV sencillo con comillas («a,"b, c",d»).
export function parseCsv(text: string) {
  const rows: string[][] = []; let field = ""; let row: string[] = []; let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) { if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; } else if (char === '"') quoted = false; else field += char; continue; }
    if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n" || char === "\r") { if (char === "\r" && text[i + 1] === "\n") i += 1; row.push(field); rows.push(row); row = []; field = ""; }
    else field += char;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows.filter((item) => item.some((value) => value !== ""));
  return body.map((values) => Object.fromEntries(header.map((name, index) => [name, values[index] ?? ""])));
}

// Ruta sin dominio, sin parámetros ni barra final.
export function originPath(url: string) {
  let value = url.trim().replace(/^https?:\/\/[^/]+/i, "");
  value = value.split("#")[0].split("?")[0];
  if (!value.startsWith("/")) value = `/${value}`;
  return value.length > 1 ? value.replace(/\/+$/, "") : value;
}

// A qué apunta cada URL vieja. Un producto se apunta por su id de Shopify (no cambia al pisarlo); lo demás, por su handle
// o por el tramo de la URL vieja.
export function keyFor(origin: string, target: string | null, inventoryType: string | null, productIds: Map<string, string>): { key_type: KeyType; key_value: string | null; shopify_product_id: string | null; note: string | null } {
  const to = target ? originPath(target) : null;
  const handle = (prefix: string) => (to?.startsWith(prefix) ? decodeURIComponent(to.slice(prefix.length).split("/")[0]) : null);
  if (origin.startsWith("/marca/") || inventoryType === "marca") return { key_type: "marca", key_value: handle("/collections/") ?? origin.replace(/^\/marca\//, "").replace(/-\d+$/, ""), shopify_product_id: null, note: null };
  const product = handle("/products/");
  if (product) { const id = productIds.get(product) ?? null; return { key_type: "producto", key_value: id ?? product, shopify_product_id: id, note: id ? null : `El producto /products/${product} no está en el espejo de la tienda.` }; }
  const collection = handle("/collections/");
  if (collection) return { key_type: "coleccion", key_value: collection, shopify_product_id: null, note: null };
  const page = handle("/pages/");
  if (page) return { key_type: "pagina", key_value: page, shopify_product_id: null, note: null };
  if (to?.startsWith("/blogs/")) return { key_type: "blog", key_value: to, shopify_product_id: null, note: null };
  // Sin redirección todavía: la URL vieja dice qué era. Ficha de PrestaShop: «/categoria/nombre-123.html».
  const segments = origin.split("/").filter(Boolean);
  const oldProduct = /-(\d+)\.html$/.exec(origin);
  if (oldProduct && segments.length >= 2) return { key_type: "producto_viejo", key_value: oldProduct[1], shopify_product_id: null, note: `Categoría vieja: ${segments[0]}` };
  if (segments.length === 1 && !segments[0].includes(".")) return { key_type: "categoria_vieja", key_value: segments[0].replace(/-\d+$/, ""), shopify_product_id: null, note: null };
  return { key_type: "otro", key_value: to, shopify_product_id: null, note: null };
}

async function shopifyRedirects(config: ShopifyConfig) {
  type Page = { urlRedirects: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: { path: string; target: string }[] } };
  const all: { path: string; target: string }[] = []; let after: string | null = null;
  do {
    const page: Page = await shopifyGraphql<Page>(config, `query($after: String) { urlRedirects(first: 250, after: $after) { pageInfo { hasNextPage endCursor } nodes { path target } } }`, { after });
    all.push(...page.urlRedirects.nodes);
    after = page.urlRedirects.pageInfo.hasNextPage ? page.urlRedirects.pageInfo.endCursor : null;
  } while (after);
  return all;
}

async function productIdsByHandle(db: SupabaseClient) {
  const ids = new Map<string, string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("shopify_products").select("id,handle").range(from, from + 999);
    if (error) throw new Error(`No se pudo leer el espejo de la tienda: ${error.message}`);
    for (const row of data as { id: string; handle: string }[]) ids.set(row.handle, row.id);
    if (data.length < 1000) break;
  }
  return ids;
}

export async function loadRedirects(db: SupabaseClient, shopify: ShopifyConfig) {
  const rows = new Map<string, Row>();
  const row = (url: string) => {
    const origin = originPath(url);
    if (!rows.has(origin)) rows.set(origin, { origin, sources: new Set(), current_target: null, inventory_type: null, clicks: 0, impressions: 0 });
    return rows.get(origin)!;
  };
  const fromShopify = await shopifyRedirects(shopify);
  for (const item of fromShopify) { const entry = row(item.path); entry.sources.add("shopify"); entry.current_target = item.target; }
  const inventory = parseCsv(await readFile(path.join(DATA, "redirecciones-todas.csv"), "utf8"));
  for (const item of inventory) { const entry = row(item.origen); entry.sources.add("inventario"); entry.current_target ??= item.destino || null; entry.inventory_type = item.tipo || null; }
  const pages = parseCsv(await readFile(path.join(DATA, "api-paginas-16-meses-2026-10-26.csv"), "utf8"));
  for (const item of pages) { const entry = row(item.page); entry.sources.add("search_console"); entry.clicks = Math.max(entry.clicks, Number(item.clics) || 0); entry.impressions = Math.max(entry.impressions, Number(item.impresiones) || 0); }
  const productIds = await productIdsByHandle(db);
  const now = new Date().toISOString();
  const records = [...rows.values()].filter((entry) => entry.origin !== "/").map((entry) => ({ origin: entry.origin, sources: [...entry.sources], current_target: entry.current_target, ...keyFor(entry.origin, entry.current_target, entry.inventory_type, productIds), clicks_16m: entry.clicks, impressions_16m: entry.impressions, updated_at: now }));
  for (let i = 0; i < records.length; i += 500) {
    const { error } = await db.from("store_redirects").upsert(records.slice(i, i + 500), { onConflict: "origin" });
    if (error) throw new Error(`No se pudieron guardar las redirecciones: ${error.message}`);
  }
  const byType: Record<string, number> = {};
  for (const record of records) byType[record.key_type] = (byType[record.key_type] ?? 0) + 1;
  return { total: records.length, shopify: fromShopify.length, inventario: inventory.length, searchConsole: pages.length, byType };
}
