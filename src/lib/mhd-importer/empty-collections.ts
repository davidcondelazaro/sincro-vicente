import type { SupabaseClient } from "@supabase/supabase-js";
import { sendAlert } from "./alerts";
import { shopifyGraphql, type ShopifyConfig } from "./store-filters";

// Colecciones vacías (David, 2026-10-28 y 2026-10-31; docs/SINCRONIZACIONES_MHD.md › Colecciones vacías). Paso de la
// vuelta: tras cada subida del importador, y al menos una vez al día, una consulta masiva (1 llamada, ~40 s) cuenta los
// productos activos de cada colección. `productsCount` no vale: incluye los archivados.
//   sin activos: se despublica, nunca se borra, y su dirección redirige arriba (familia → grupo, selección → familia,
//     marca → /pages/marcas); si está en un menú no se toca: solo se avisa;
//   recupera activos: se publica otra vez, se quita su redirección y se borra `seo.hidden`.
// Sin registro propio: lo apagado por este paso es lo que está sin publicar y tiene redirección en su dirección. Lo
// despublicado a mano, sin redirección, no se toca. Lo hecho queda en mhd_sync_events (sync = 'colecciones').
// Simulación: con `empty_collections_apply` distinto de true solo dice en la vuelta y en el resumen lo que haría.
// Freno: más de `empty_collections_max` despublicaciones de golpe no se aplican y se avisa.
const TYPES = new Set(["arbol-familia", "seo", "marca"]);
const PUBLICATIONS = ["gid://shopify/Publication/316155756876", "gid://shopify/Publication/316155855180"];
const BRANDS_PAGE = "/pages/marcas";
const MAX_WAIT_MS = 60_000;
const MIN_WAIT_MS = 5_000;
const DAY_MS = 86_400_000;
const BRAKE_QUIET_MINUTES = 720;
const COLLECTIONS_QUERY = `{ collections { edges { node { id handle title
  tipo: metafield(namespace: "custom", key: "tipo_coleccion") { value }
  padre: metafield(namespace: "custom", key: "categoria_padre") { value }
  oculta: metafield(namespace: "seo", key: "hidden") { value }
  ${PUBLICATIONS.map((id, index) => `p${index}: publishedOnPublication(publicationId: "${id}")`).join("\n  ")}
  products { edges { node { id status } } } } } } }`;

export type StoreCollection = { id: string; handle: string; title: string; tipo: string | null; parentId: string | null; published: boolean; seoHidden: boolean; active: number };
type State = { operation?: string | null; started_at?: string | null; checked_at?: string | null };
type Redirect = { id: string; path: string; target: string };
type UserError = { message: string };

// Filas de la consulta masiva: una por colección y, detrás, una por producto con `__parentId` en su colección.
export function parseCollections(text: string) {
  const collections = new Map<string, StoreCollection>();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (row.__parentId) { const parent = collections.get(row.__parentId); if (parent && row.status === "ACTIVE") parent.active++; continue; }
    collections.set(row.id, { id: row.id, handle: row.handle, title: row.title, tipo: row.tipo?.value ?? null, parentId: row.padre?.value ?? null, published: PUBLICATIONS.some((_, index) => row[`p${index}`] === true), seoHidden: Boolean(row.oculta), active: 0 });
  }
  return [...collections.values()];
}

export function decideCollections(collections: StoreCollection[], menus: Set<string>) {
  const byId = new Map(collections.map((collection) => [collection.id, collection]));
  const parentOf = (collection: StoreCollection) => (collection.parentId ? byId.get(collection.parentId) : undefined);
  const target = (collection: StoreCollection) => {
    if (collection.tipo === "marca") return BRANDS_PAGE;
    let parent = parentOf(collection);
    // Si el de arriba también está vacío, se sube otro nivel: no se redirige a una colección sin productos.
    for (let hops = 0; parent && TYPES.has(parent.tipo ?? "") && !parent.active && parent.parentId && hops < 5; hops++) parent = parentOf(parent);
    return parent ? `/collections/${parent.handle}` : "/";
  };
  const inScope = collections.filter((collection) => TYPES.has(collection.tipo ?? ""));
  const empty = inScope.filter((collection) => !collection.active && collection.published);
  return {
    unpublish: empty.filter((collection) => !menus.has(collection.handle)).map((collection) => ({ collection, target: target(collection) })),
    recovered: inScope.filter((collection) => collection.active > 0 && !collection.published),
    inMenu: empty.filter((collection) => menus.has(collection.handle)),
  };
}

export function menuHandles(menus: { items: MenuItem[] }[]) {
  const handles = new Set<string>();
  const walk = (items: MenuItem[]) => {
    for (const item of items) {
      const handle = item.url?.split("/collections/")[1]?.split("?")[0].replace(/\/+$/, "");
      if (handle) handles.add(handle);
      walk(item.items ?? []);
    }
  };
  for (const menu of menus) walk(menu.items);
  return handles;
}
type MenuItem = { url: string | null; items?: MenuItem[] };

async function setting<T>(db: SupabaseClient, key: string, fallback: T): Promise<T> {
  const { data } = await db.from("store_settings").select("value").eq("key", key).maybeSingle();
  return (data?.value ?? fallback) as T;
}

async function saveState(db: SupabaseClient, state: State) {
  const { error } = await db.from("store_settings").upsert({ key: "empty_collections_state", value: state, updated_by: "vuelta automática", updated_at: new Date().toISOString() });
  if (error) throw error;
}

// Toca mirar si alguna tanda ha terminado desde la última comprobación, o si lleva un día sin mirarse (cambios a mano).
async function isDue(db: SupabaseClient, checkedAt?: string | null) {
  if (!checkedAt || Date.now() - new Date(checkedAt).getTime() > DAY_MS) return true;
  const { count, error } = await db.from("mhd_importer_jobs").select("id", { count: "exact", head: true }).eq("status", "terminado").gt("finished_at", checkedAt);
  if (error) throw error;
  return Boolean(count);
}

async function waitForOperation(shopify: ShopifyConfig, id: string, budgetMs: number) {
  const deadline = Date.now() + Math.max(MIN_WAIT_MS, Math.min(MAX_WAIT_MS, budgetMs));
  for (let wait = 1_000; ; wait = Math.min(wait * 1.5, 5_000)) {
    const { bulkOperation } = await shopifyGraphql<{ bulkOperation: { status: string; url: string | null; errorCode: string | null } | null }>(shopify, `query($id: ID!) { bulkOperation(id: $id) { status url errorCode } }`, { id });
    if (bulkOperation?.status === "COMPLETED") return { url: bulkOperation.url };
    if (!bulkOperation || ["FAILED", "CANCELED", "CANCELING", "EXPIRED"].includes(bulkOperation.status)) return { failed: `La consulta masiva de Shopify terminó en ${bulkOperation?.status ?? "nada"} (${bulkOperation?.errorCode ?? "sin código"}).` };
    if (Date.now() + wait > deadline) return { running: true };
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

async function findRedirect(shopify: ShopifyConfig, path: string) {
  const { urlRedirects } = await shopifyGraphql<{ urlRedirects: { nodes: Redirect[] } }>(shopify, `query($q: String!) { urlRedirects(first: 5, query: $q) { nodes { id path target } } }`, { q: `path:${path}` });
  return urlRedirects.nodes.find((row) => row.path === path) ?? null;
}

async function unpublishCollection(deps: { db: SupabaseClient; shopify: ShopifyConfig }, collection: StoreCollection, target: string, errors: string[]) {
  const { db, shopify } = deps;
  const input = PUBLICATIONS.map((publicationId) => ({ publicationId }));
  const { publishableUnpublish: done } = await shopifyGraphql<{ publishableUnpublish: { userErrors: UserError[] } }>(shopify, `mutation($id: ID!, $p: [PublicationInput!]!) { publishableUnpublish(id: $id, input: $p) { userErrors { message } } }`, { id: collection.id, p: input });
  if (done.userErrors.length) { errors.push(`${collection.handle}: ${done.userErrors[0].message}`); return; }
  const path = `/collections/${collection.handle}`;
  let redirect = await findRedirect(shopify, path);
  if (!redirect) {
    const { urlRedirectCreate: created } = await shopifyGraphql<{ urlRedirectCreate: { urlRedirect: Redirect | null; userErrors: UserError[] } }>(shopify, `mutation($r: UrlRedirectInput!) { urlRedirectCreate(urlRedirect: $r) { urlRedirect { id path target } userErrors { message } } }`, { r: { path, target } });
    if (created.userErrors.length) errors.push(`Redirección de ${collection.handle}: ${created.userErrors[0].message}`);
    redirect = created.urlRedirect;
  }
  await db.from("mhd_sync_events").insert({ sync: "colecciones", kind: "despublicada", detail: { handle: collection.handle, title: collection.title, tipo: collection.tipo, origen: path, destino: redirect?.target ?? null } });
}

async function publishCollection(deps: { db: SupabaseClient; shopify: ShopifyConfig }, collection: StoreCollection, redirect: Redirect, errors: string[]) {
  const { db, shopify } = deps;
  const input = PUBLICATIONS.map((publicationId) => ({ publicationId }));
  const { publishablePublish: done } = await shopifyGraphql<{ publishablePublish: { userErrors: UserError[] } }>(shopify, `mutation($id: ID!, $p: [PublicationInput!]!) { publishablePublish(id: $id, input: $p) { userErrors { message } } }`, { id: collection.id, p: input });
  if (done.userErrors.length) { errors.push(`${collection.handle}: ${done.userErrors[0].message}`); return; }
  const { urlRedirectDelete: gone } = await shopifyGraphql<{ urlRedirectDelete: { userErrors: UserError[] } }>(shopify, `mutation($id: ID!) { urlRedirectDelete(id: $id) { userErrors { message } } }`, { id: redirect.id });
  if (gone.userErrors.length) errors.push(`Redirección de ${collection.handle}: ${gone.userErrors[0].message}`);
  if (collection.seoHidden) {
    const { metafieldsDelete: hidden } = await shopifyGraphql<{ metafieldsDelete: { userErrors: UserError[] } }>(shopify, `mutation($m: [MetafieldIdentifierInput!]!) { metafieldsDelete(metafields: $m) { userErrors { message } } }`, { m: [{ ownerId: collection.id, namespace: "seo", key: "hidden" }] });
    if (hidden.userErrors.length) errors.push(`seo.hidden de ${collection.handle}: ${hidden.userErrors[0].message}`);
  }
  await db.from("mhd_sync_events").insert({ sync: "colecciones", kind: "republicada", detail: { handle: collection.handle, title: collection.title, tipo: collection.tipo, productos: collection.active, origen: redirect.path, destino: redirect.target } });
}

async function run(deps: { db: SupabaseClient; shopify: ShopifyConfig }, options: { budgetMs: number }) {
  const { db, shopify } = deps;
  const state = await setting<State>(db, "empty_collections_state", {});
  let operation = state.operation ?? null;
  let startedAt = state.started_at ?? null;
  if (!operation) {
    if (!(await isDue(db, state.checked_at))) return { skipped: true, reason: "Sin subidas nuevas desde la última comprobación." };
    const { bulkOperationRunQuery: started } = await shopifyGraphql<{ bulkOperationRunQuery: { bulkOperation: { id: string } | null; userErrors: UserError[] } }>(shopify, `mutation($q: String!) { bulkOperationRunQuery(query: $q) { bulkOperation { id } userErrors { message } } }`, { q: COLLECTIONS_QUERY });
    if (!started.bulkOperation) return { skipped: true, reason: `Shopify no aceptó la consulta masiva: ${started.userErrors.map((item) => item.message).join("; ")}` };
    operation = started.bulkOperation.id;
    startedAt = new Date().toISOString();
    await saveState(db, { ...state, operation, started_at: startedAt });
  }
  const result = await waitForOperation(shopify, operation, options.budgetMs);
  // No acabó a tiempo: la próxima vuelta recoge el resultado sin lanzar otra.
  if (result.running) return { waiting: true };
  if (result.failed) { await saveState(db, { checked_at: state.checked_at ?? null }); throw new Error(result.failed); }
  const text = result.url ? await (await fetch(result.url, { signal: AbortSignal.timeout(60_000) })).text() : "";
  const collections = parseCollections(text);
  if (!collections.length) { await saveState(db, { checked_at: state.checked_at ?? null }); throw new Error("La consulta masiva de Shopify no trajo colecciones."); }
  const [{ menus }, apply, max] = await Promise.all([
    shopifyGraphql<{ menus: { nodes: { items: MenuItem[] }[] } }>(shopify, `{ menus(first: 50) { nodes { items { url items { url items { url } } } } } }`),
    setting(db, "empty_collections_apply", false),
    setting(db, "empty_collections_max", 25),
  ]);
  const decision = decideCollections(collections, menuHandles(menus.nodes));
  // Solo vuelven las que apagó este paso: las que tienen redirección en su dirección.
  const publish: { collection: StoreCollection; redirect: Redirect }[] = [];
  for (const collection of decision.recovered) { const redirect = await findRedirect(shopify, `/collections/${collection.handle}`); if (redirect) publish.push({ collection, redirect }); }
  const applying = apply === true;
  const braked = decision.unpublish.length > Number(max);
  const errors: string[] = [];
  if (applying) {
    if (braked) await sendAlert(db, { key: "colecciones-vacias:freno", quietMinutes: BRAKE_QUIET_MINUTES, subject: `Freno: ${decision.unpublish.length} colecciones vacías de golpe`, lines: [`Saldrían ${decision.unpublish.length} colecciones sin productos activos, más del tope (${max}).`, "No se ha despublicado ninguna: revisa si es normal o sube el tope `empty_collections_max`.", decision.unpublish.slice(0, 20).map((item) => item.collection.handle).join(", ")] });
    else for (const item of decision.unpublish) await unpublishCollection(deps, item.collection, item.target, errors);
    for (const item of publish) await publishCollection(deps, item.collection, item.redirect, errors);
  }
  await saveState(db, { checked_at: startedAt });
  return {
    mode: applying ? "aplicar" : "simulación", collections: collections.length, braked, errors,
    unpublish: decision.unpublish.map((item) => ({ handle: item.collection.handle, tipo: item.collection.tipo, origen: `/collections/${item.collection.handle}`, destino: item.target })),
    publish: publish.map(({ collection, redirect }) => ({ handle: collection.handle, tipo: collection.tipo, productos: collection.active, origen: redirect.path, destino: redirect.target })),
    inMenu: decision.inMenu.map((collection) => collection.handle),
  };
}

// Un fallo aquí no debe tumbar la vuelta: precio, stock y altas ya están hechos. Se avisa y se reintenta en la siguiente.
export async function syncEmptyCollections(deps: { db: SupabaseClient; shopify: ShopifyConfig }, options: { budgetMs: number }): Promise<Record<string, unknown>> {
  try { return await run(deps, options); }
  catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    await sendAlert(deps.db, { key: "colecciones-vacias:error", subject: "Colecciones vacías: no se pudo comprobar", lines: ["El paso de colecciones vacías de la vuelta ha fallado; se reintenta en la siguiente.", message] });
    return { failed: message };
  }
}
