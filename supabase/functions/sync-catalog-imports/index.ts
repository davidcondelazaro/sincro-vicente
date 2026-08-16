import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const SHOPIFY_TIMEOUT_MS = 20_000;
const WORKER_HEARTBEAT_MS = 10_000;
const WORKER_BUDGET_MS = 45_000;
const MAX_PRODUCT_IMAGE_BYTES = 25 * 1024 * 1024;
const PROMOTION_CATEGORY_ID = "V346";
const PROMOTION_TEMPLATE_SUFFIX = "promociones";

type Manufacturer = { id: string; name: string | null; active: boolean | null; image: string | null };
type Category = { id: string; name: string | null; link_rewrite: string | null; id_parent: string | null; active: boolean | null };
type Feature = { id: string; name: string | null };
type Product = { id: string; name: string | null; active: boolean | null; fecha_modificacion: string | null; fecha_modificacion_imagen: string | null; images_sync_pending?: boolean; id_manufacturer: string | null; id_category_default: string | null; product_features: string | null };
type IcecatProduct = { id: string; name: string | null; ean13: string | null; shopify?: ShopifyProduct | null };
type ShopifyProduct = { id: string; handle: string; status: string; title: string; descriptionHtml: string; vendor: string; productType: string; templateSuffix: string | null; tags: string[]; seo: { title: string | null; description: string | null } | null; media: { nodes: { id: string }[] }; metafields: { nodes: { namespace: string; key: string; value: string }[] }; variants: { nodes: { id: string; sku: string; barcode: string | null; price: string; compareAtPrice: string | null; inventoryPolicy: string; inventoryQuantity: number; inventoryItem?: { id: string } | null }[] } };
type ShopifyUserError = { message: string; field?: string[] | null };
type ErrorWithDetails = Error & { details?: Record<string, unknown> };
type Run = { id: string; entity_type: "manufacturers" | "categories" | "features" | "products" | "priorities" | "icecat"; filters: { onlyActive?: boolean; productSyncMode?: "changes" | "all"; manufacturerId?: string; categoryId?: string; featureId?: string; productId?: string; productIds?: string[]; eans?: string[]; modifiedSince?: string; forceImages?: boolean; force?: boolean; name?: string; collectionName?: string }; status: string; total_count: number; processed_count: number; created_count: number; updated_count: number; unchanged_count: number; unpublished_count: number; error_count: number; cursor_entity_id: string | null; started_at: string | null; worker_token?: string | null };
type CollectionRef = { id: string; title: string; handle: string; sourceCategoryId: string | null };
// El origen histórico de las seis exclusiones iniciales era numérico. En la copia
// actual llegan por sus claves de negocio, así que mantenemos ambas formas.
const excludedFeatureIds = new Set(["10603", "10604", "10606", "10607", "10608", "10609", "10593", "10454", "10421", "10419", "10420", "10530", "10543", "10428", "PORTESGRATIS", "DESCATALOGADO", "OFERTA", "SUPEROFERTA", "PRECIOOCULTO", "PRIORIDAD", "ALTOBULTO", "ANCHOBULTO", "LARGOBULTO", "VOLUMEN", "PESOBRUTO", "ALTO", "ANCHO", "LARGO", "PESONETO"]);
const icecatHiddenSections = ["**Peso y dimensiones", "**Empaquetado", "Datos logísticos", "Características del proveedor", "Detalles técnicos", "Aprobaciones reguladoras"];
const icecatHiddenFeatures = ["País de origen"];
const icecatReplacements = ["Empaquetado|Contenido y dimensiones de la caja", "Control de energía|Eficiencia energética", "Contenido y dimensiones|Características del embalaje", "Características de Administración|Otras Prestaciones", "Anaquel de almacenaje|Estante de Almacenaje", "Multi beverage|Bebida Múltiple", "Piernas|Patas"];

function env(name: string) { const value = Deno.env.get(name); if (!value) throw new Error(`Falta ${name}`); return value; }
function shopifyUrl() { return `https://${env("SHOPIFY_STORE_URL").replace(/^https?:\/\//, "").replace(/\/$/, "")}/admin/api/2026-07/graphql.json`; }
async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = SHOPIFY_TIMEOUT_MS) {
  return fetch(input, { ...init, signal: init.signal ?? AbortSignal.timeout(timeoutMs) });
}
async function shopify<T>(query: string, variables: Record<string, unknown>) {
  let response: Response;
  let body: T & { errors?: { message: string }[] };
  try {
    response = await fetchWithTimeout(shopifyUrl(), { method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": env("SHOPIFY_ACCESS_TOKEN") }, body: JSON.stringify({ query, variables }) });
    const raw = await response.text();
    try { body = JSON.parse(raw) as T & { errors?: { message: string }[] }; } catch { body = { errors: [{ message: raw || `Shopify ${response.status}` }] } as T & { errors?: { message: string }[] }; }
  } catch (error) {
    const wrapped = new Error(`Shopify no respondió en ${SHOPIFY_TIMEOUT_MS / 1000} s: ${errorMessage(error)}`) as ErrorWithDetails;
    wrapped.details = { provider: "shopify", operation: "graphql", timeout_ms: SHOPIFY_TIMEOUT_MS, cause: errorDetails(error) };
    throw wrapped;
  }
  if (!response.ok || body.errors?.length) {
    const error = new Error(body.errors?.[0]?.message ?? `Shopify ${response.status}`) as ErrorWithDetails;
    error.details = { provider: "shopify", http_status: response.status, graphql_errors: body.errors ?? [] };
    throw error;
  }
  return body;
}
function errorDetails(error: unknown, context: Record<string, unknown> = {}) {
  const value = error as Partial<ErrorWithDetails> & Record<string, unknown>;
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : (() => { try { return JSON.stringify(error); } catch { return String(error); } })();
  const rawDetails = value?.details;
  const providerDetails = rawDetails && typeof rawDetails === "object" && !Array.isArray(rawDetails)
    ? rawDetails
    : rawDetails == null ? {} : { raw_details: rawDetails };
  return { ...context, name: error instanceof Error ? error.name : typeof error, message, ...(error instanceof Error && error.stack ? { stack: error.stack } : {}), ...providerDetails };
}
function errorMessage(error: unknown) { return errorDetails(error).message as string; }
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function text(value: unknown) { return typeof value === "string" ? value : ""; }
function replaceIcecatText(value: unknown, search: string, replacement: string): unknown {
  if (typeof value === "string") return value.replaceAll(search, replacement);
  if (Array.isArray(value)) return value.map((item) => replaceIcecatText(item, search, replacement));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key.replaceAll(search, replacement), replaceIcecatText(item, search, replacement)]));
  return value;
}
function processIcecatData(payload: Record<string, unknown>) {
  const data = record(payload.data); const generalInfo = record(data.GeneralInfo);
  if (!Object.keys(data).length) return null;
  const generated = record(generalInfo.GeneratedBulletPoints);
  const bulletPoints = Array.isArray(generated.Values) ? generated.Values.filter((item): item is string => typeof item === "string") : [];
  const specifications: Record<string, Record<string, string>> = {};
  for (const groupValue of Array.isArray(data.FeaturesGroups) ? data.FeaturesGroups : []) {
    const group = record(groupValue); const groupName = text(record(record(group.FeatureGroup).Name).Value);
    if (!groupName) continue;
    const features = specifications[groupName] ?? (specifications[groupName] = {});
    for (const featureValue of Array.isArray(group.Features) ? group.Features : []) {
      const feature = record(featureValue); const name = text(record(record(feature.Feature).Name).Value); const value = text(feature.PresentationValue);
      if (name && value) features[name] = value;
    }
  }
  for (const section of icecatHiddenSections) delete specifications[section.trim()];
  for (const [section, features] of Object.entries(specifications)) {
    for (const feature of icecatHiddenFeatures) delete features[feature.trim()];
    if (!Object.keys(features).length) delete specifications[section];
  }
  let filtered: unknown = specifications;
  for (const item of icecatReplacements) { const [search, replacement] = item.split("|").map((part) => part.trim()); if (search && replacement) filtered = replaceIcecatText(filtered, search, replacement); }
  return { _icecat_id: generalInfo.IcecatId ?? null, _synced_at: new Date().toISOString(), bullet_points: bulletPoints, specifications: filtered };
}
async function icecatData(ean: string) {
  const query = new URLSearchParams({ UserName: env("ICECAT_USERNAME"), Language: Deno.env.get("ICECAT_LANGUAGE") || "es", GTIN: ean, app_key: env("ICECAT_APP_KEY") });
  const url = `https://live.icecat.biz/api?${query.toString()}`;
  let response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get("retry-after") ?? "1");
    await new Promise((resolve) => setTimeout(resolve, Math.max(1, Math.min(retryAfter, 30)) * 1_000));
    response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  }
  if (response.status === 401) throw new Error("Icecat rechazó las credenciales configuradas.");
  if (response.status === 429 || response.status >= 500) throw new Error(`Icecat no está disponible temporalmente (${response.status}).`);
  if (!response.ok) return null;
  const payload = await response.json() as Record<string, unknown>;
  return processIcecatData(payload);
}
async function setIcecatMetafield(productId: string, value: Record<string, unknown>) {
  const result = await shopify<{ data: { metafieldsSet: { userErrors: ShopifyUserError[] } } }>(
    `mutation($metafields:[MetafieldsSetInput!]!){metafieldsSet(metafields:$metafields){userErrors{field message}}}`,
    { metafields: [{ ownerId: productId, namespace: "custom", key: "icecat", type: "json", value: JSON.stringify(value, null, 2) }] },
  );
  if (result.data.metafieldsSet.userErrors.length) throw new Error(result.data.metafieldsSet.userErrors.map((item) => item.message).join(" "));
}
function proxyUrl(image: string) {
  const marker = "/imagenes/";
  const path = image.includes(marker) ? image.split(marker, 2)[1] : image;
  return `https://pladisel.es/utils/proxy-images/proxy-images.php?image=${encodeURIComponent(path).replace(/%2F/gi, "/")}&token=kd8%kksi2`;
}
function filename(manufacturer: Manufacturer) {
  const extension = manufacturer.image?.split("?")[0].match(/\.[a-z0-9]{1,5}$/i)?.[0] ?? ".jpg";
  const name = (manufacturer.name ?? manufacturer.id).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "").toLowerCase() || manufacturer.id;
  return `logo_${name}${extension}`;
}
async function findCollection(name: string) {
  const body = await shopify<{ data: { collections: { nodes: { id: string; title: string; handle: string; image: { id: string } | null; metafield: { value: string } | null }[] } } }>(
    `query($query:String!){collections(first:25,query:$query){nodes{id title handle image{id} metafield(namespace:"custom",key:"logotipo"){value}}}}`, { query: `title:${JSON.stringify(name)}` },
  );
  return body.data.collections.nodes.find((item) => item.title.toLocaleLowerCase("es-ES") === name.toLocaleLowerCase("es-ES")) ?? null;
}
async function findProductRedirect(path: string) {
  const result = await shopify<{ data: { urlRedirects: { nodes: { id: string; path: string; target: string }[] } } }>(
    `query($query:String!){urlRedirects(first:10,query:$query){nodes{id path target}}}`, { query: `path:${JSON.stringify(path)}` },
  );
  return result.data.urlRedirects.nodes.find((item) => item.path === path) ?? null;
}
async function ensureProductRedirect(productHandleValue: string, target: string) {
  const path = `/products/${productHandleValue}`;
  const existing = await findProductRedirect(path);
  if (existing) return existing;
  const result = await shopify<{ data: { urlRedirectCreate: { urlRedirect: { id: string; path: string; target: string } | null; userErrors: { message: string }[] } } }>(
    `mutation($urlRedirect:UrlRedirectInput!){urlRedirectCreate(urlRedirect:$urlRedirect){urlRedirect{id path target} userErrors{message}}}`, { urlRedirect: { path, target } },
  );
  if (result.data.urlRedirectCreate.userErrors.length) throw new Error(result.data.urlRedirectCreate.userErrors.map((item) => item.message).join(" "));
  return result.data.urlRedirectCreate.urlRedirect;
}
async function removeProductRedirect(productHandleValue: string) {
  const redirect = await findProductRedirect(`/products/${productHandleValue}`);
  if (!redirect) return false;
  const result = await shopify<{ data: { urlRedirectDelete: { userErrors: { message: string }[] } } }>(
    `mutation($id:ID!){urlRedirectDelete(id:$id){userErrors{message}}}`, { id: redirect.id },
  );
  if (result.data.urlRedirectDelete.userErrors.length) throw new Error(result.data.urlRedirectDelete.userErrors.map((item) => item.message).join(" "));
  return true;
}
async function uploadLogo(manufacturer: Manufacturer) {
  if (!manufacturer.image) return null;
  const source = proxyUrl(manufacturer.image);
  const response = await fetchWithTimeout(source, {}, 15_000);
  if (!response.ok) throw new Error(`No se pudo descargar el logotipo (${response.status}).`);
  const content = new Uint8Array(await response.arrayBuffer());
  const contentType = response.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  const name = filename(manufacturer);
  const existing = await shopify<{ data: { files: { nodes: { id: string }[] } } }>(`query($query:String!){files(first:1,query:$query){nodes{id}}}`, { query: `filename:${JSON.stringify(name)}` });
  if (existing.data.files.nodes[0]) return existing.data.files.nodes[0].id;
  const staged = await shopify<{ data: { stagedUploadsCreate: { stagedTargets: { url: string; resourceUrl: string; parameters: { name: string; value: string }[] }[]; userErrors: { message: string }[] } } }>(
    `mutation($input:[StagedUploadInput!]!){stagedUploadsCreate(input:$input){stagedTargets{url resourceUrl parameters{name value}} userErrors{message}}}`,
    { input: [{ filename: name, mimeType: contentType, resource: "FILE", httpMethod: "POST" }] },
  );
  const target = staged.data.stagedUploadsCreate.stagedTargets[0];
  const errors = staged.data.stagedUploadsCreate.userErrors;
  if (!target || errors.length) throw new Error(errors.map((item) => item.message).join(" ") || "Shopify no preparó la subida del logotipo.");
  const form = new FormData();
  for (const parameter of target.parameters) form.append(parameter.name, parameter.value);
  form.append("file", new Blob([content], { type: contentType }), name);
  const uploaded = await fetchWithTimeout(target.url, { method: "POST", body: form }, 20_000);
  if (!uploaded.ok) throw new Error(`No se pudo subir el logotipo a Shopify (${uploaded.status}).`);
  const created = await shopify<{ data: { fileCreate: { files: { id: string }[]; userErrors: { message: string }[] } } }>(
    `mutation($files:[FileCreateInput!]!){fileCreate(files:$files){files{id} userErrors{message}}}`,
    { files: [{ alt: manufacturer.name ?? manufacturer.id, contentType: "IMAGE", originalSource: target.resourceUrl, filename: name }] },
  );
  const file = created.data.fileCreate.files[0];
  if (!file || created.data.fileCreate.userErrors.length) throw new Error(created.data.fileCreate.userErrors.map((item) => item.message).join(" ") || "Shopify no creó el archivo del logotipo.");
  return file.id;
}
async function fileImageUrl(fileId: string) {
  const body = await shopify<{ data: { node: { image: { url: string } | null } | null } }>(
    `query($id:ID!){node(id:$id){... on MediaImage{image{url}}}}`, { id: fileId },
  );
  return body.data.node?.image?.url ?? null;
}
async function publish(collectionId: string) {
  const publications = await shopify<{ data: { publications: { nodes: { id: string }[] } } }>(`query{publications(first:20){nodes{id}}}`, {});
  if (!publications.data.publications.nodes.length) return;
  const result = await shopify<{ data: { publishablePublish: { userErrors: { message: string }[] } } }>(
    `mutation($id:ID!,$input:[PublicationInput!]!){publishablePublish(id:$id,input:$input){userErrors{message}}}`,
    { id: collectionId, input: publications.data.publications.nodes.map((publication) => ({ publicationId: publication.id })) },
  );
  if (result.data.publishablePublish.userErrors.length) throw new Error(result.data.publishablePublish.userErrors.map((item) => item.message).join(" "));
}
async function unpublish(collectionId: string) {
  const collection = await shopify<{ data: { collection: { resourcePublications: { nodes: { publication: { id: string } }[] } } | null } }>(
    `query($id:ID!){collection(id:$id){resourcePublications(first:100,onlyPublished:true){nodes{publication{id}}}}}`, { id: collectionId },
  );
  const publicationIds = collection.data.collection?.resourcePublications.nodes.map((item) => item.publication.id) ?? [];
  if (!publicationIds.length) return false;
  const result = await shopify<{ data: { publishableUnpublish: { userErrors: { message: string }[] } } }>(
    `mutation($id:ID!,$input:[PublicationInput!]!){publishableUnpublish(id:$id,input:$input){userErrors{message}}}`,
    { id: collectionId, input: publicationIds.map((publicationId) => ({ publicationId })) },
  );
  if (result.data.publishableUnpublish.userErrors.length) throw new Error(result.data.publishableUnpublish.userErrors.map((item) => item.message).join(" "));
  return true;
}
function categoryHandle(category: Category) {
  return (category.link_rewrite ?? category.name ?? category.id).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es-ES").replace(/[_\s]+/g, "-").replace(/[^a-z0-9-]+/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
}
function featureKey(name: string) {
  return name.toLowerCase().trim().replace(/[^a-z0-9_]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
}
async function featureDefinitions() {
  const definitions = new Map<string, string>();
  let after: string | null = null;
  do {
    const body = await shopify<{ data: { metafieldDefinitions: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: { id: string; key: string }[] } } }>(
      `query($after:String){metafieldDefinitions(first:250,after:$after,ownerType:PRODUCT,namespace:"features"){pageInfo{hasNextPage endCursor} nodes{id key}}}`, { after },
    );
    for (const definition of body.data.metafieldDefinitions.nodes) definitions.set(definition.key, definition.id);
    after = body.data.metafieldDefinitions.pageInfo.hasNextPage ? body.data.metafieldDefinitions.pageInfo.endCursor : null;
  } while (after);
  return definitions;
}
async function syncFeature(feature: Feature, definitions: Map<string, string>) {
  const name = feature.name?.trim();
  if (!name) throw new Error("La característica no tiene nombre.");
  const key = featureKey(name);
  if (!key) throw new Error("La característica no tiene una clave válida.");
  const existingId = definitions.get(key);
  if (existingId) return { definitionId: existingId, created: false, action: "unchanged" as const, message: "La definición ya existía: sin cambios." };
  const result = await shopify<{ data: { metafieldDefinitionCreate: { createdDefinition: { id: string } | null; userErrors: { message: string }[] } } }>(
    `mutation($definition:MetafieldDefinitionInput!){metafieldDefinitionCreate(definition:$definition){createdDefinition{id} userErrors{message}}}`,
    { definition: { name, namespace: "features", key, ownerType: "PRODUCT", type: "single_line_text_field", validations: [], pin: false } },
  );
  const created = result.data.metafieldDefinitionCreate.createdDefinition;
  if (!created || result.data.metafieldDefinitionCreate.userErrors.length) throw new Error(result.data.metafieldDefinitionCreate.userErrors.map((item) => item.message).join(" ") || "Shopify no creó la definición.");
  definitions.set(key, created.id);
  return { definitionId: created.id, created: true, action: "created" as const, message: "Definición de característica creada." };
}
async function categoryCollections() {
  const collections: CollectionRef[] = [];
  let after: string | null = null;
  do {
    const body = await shopify<{ data: { collections: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: { id: string; title: string; handle: string; metafield: { value: string } | null }[] } } }>(
      `query($after:String){collections(first:250,after:$after){pageInfo{hasNextPage endCursor} nodes{id title handle metafield(namespace:"custom",key:"id_cateroria_origen"){value}}}}`, { after },
    );
    collections.push(...body.data.collections.nodes.map((item) => ({ id: item.id, title: item.title, handle: item.handle, sourceCategoryId: item.metafield?.value ?? null })));
    after = body.data.collections.pageInfo.hasNextPage ? body.data.collections.pageInfo.endCursor : null;
  } while (after);
  return collections;
}
type PriorityCollection = { id: string; title: string; handle: string; sortOrder: string };
type PriorityProduct = { id: string; title: string; variants: { nodes: { sku: string | null }[] }; metafield: { value: string } | null };
async function priorityCollections() {
  const collections: PriorityCollection[] = [];
  let after: string | null = null;
  do {
    const body = await shopify<{ data: { collections: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: PriorityCollection[] } } }>(
      `query($after:String){collections(first:250,after:$after){pageInfo{hasNextPage endCursor} nodes{id title handle sortOrder}}}`, { after },
    );
    collections.push(...body.data.collections.nodes);
    after = body.data.collections.pageInfo.hasNextPage ? body.data.collections.pageInfo.endCursor : null;
  } while (after);
  return collections;
}
async function priorityProducts(collectionId: string) {
  const products: PriorityProduct[] = [];
  let after: string | null = null;
  do {
    const body = await shopify<{ data: { collection: { products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: PriorityProduct[] } } | null } }>(
      `query($id:ID!,$after:String){collection(id:$id){products(first:250,after:$after){pageInfo{hasNextPage endCursor} nodes{id title variants(first:1){nodes{sku}} metafield(namespace:"custom",key:"prioridad"){value}}}}}`, { id: collectionId, after },
    );
    if (!body.data.collection) break;
    products.push(...body.data.collection.products.nodes);
    after = body.data.collection.products.pageInfo.hasNextPage ? body.data.collection.products.pageInfo.endCursor : null;
  } while (after);
  return products;
}
function priorityValue(product: PriorityProduct) {
  const value = Number.parseInt(product.metafield?.value ?? "", 10);
  return Number.isFinite(value) ? value : 9999;
}
async function syncPriorityCollection(collection: PriorityCollection) {
  const products = await priorityProducts(collection.id);
  if (!products.length) return { action: "unchanged" as const, targetId: collection.id, message: "Colección sin productos: sin cambios." };
  if (collection.sortOrder !== "MANUAL") {
    const result = await shopify<{ data: { collectionUpdate: { userErrors: ShopifyUserError[] } } }>(
      `mutation($input:CollectionInput!){collectionUpdate(input:$input){userErrors{field message}}}`, { input: { id: collection.id, sortOrder: "MANUAL" } },
    );
    if (result.data.collectionUpdate.userErrors.length) throw new Error(result.data.collectionUpdate.userErrors.map((item) => item.message).join(" "));
  }
  const desired = products.map((product, index) => ({ product, index })).sort((left, right) => priorityValue(left.product) - priorityValue(right.product) || left.index - right.index);
  const moves = desired.map((item, index) => ({ id: item.product.id, newPosition: String(index) })).filter((move, index) => products[index]?.id !== move.id);
  if (!moves.length) return { action: "unchanged" as const, targetId: collection.id, message: `Colección "${collection.title}": orden ya correcto (${products.length} productos).` };
  for (let index = 0; index < moves.length; index += 250) {
    const result = await shopify<{ data: { collectionReorderProducts: { userErrors: ShopifyUserError[] } } }>(
      `mutation($id:ID!,$moves:[MoveInput!]!){collectionReorderProducts(id:$id,moves:$moves){userErrors{field message}}}`, { id: collection.id, moves: moves.slice(index, index + 250) },
    );
    if (result.data.collectionReorderProducts.userErrors.length) throw new Error(result.data.collectionReorderProducts.userErrors.map((item) => item.message).join(" "));
  }
  return { action: "updated" as const, targetId: collection.id, message: `Colección "${collection.title}" reordenada por prioridad (${products.length} productos).` };
}
function findCategoryCollection(category: Category, collections: CollectionRef[]) {
  return collections.find((collection) => collection.sourceCategoryId === category.id)
    ?? collections.find((collection) => collection.handle === categoryHandle(category))
    ?? null;
}
function categoryCanRemainPublished(category: Category, allCategories: Map<string, Category>) {
  let current: Category | undefined = category;
  const visited = new Set<string>();
  while (current) {
    if (!current.active) return false;
    const parentId = current.id_parent?.trim();
    if (!parentId || parentId === "0") return true;
    if (visited.has(parentId)) return false;
    visited.add(current.id);
    current = allCategories.get(parentId);
    if (!current) return false;
  }
  return false;
}
async function syncCategory(category: Category, allCategories: Map<string, Category>, collections: CollectionRef[]) {
  const name = category.name?.trim();
  if (!name) throw new Error("La categoría no tiene nombre.");
  const collection = findCategoryCollection(category, collections);
  if (!categoryCanRemainPublished(category, allCategories)) {
    if (!collection) return { collectionId: null, created: false, action: "unchanged" as const, message: "Categoría inactiva (o con padre inactivo): no existe en Shopify, sin cambios." };
    const changed = await unpublish(collection.id);
    return changed
      ? { collectionId: collection.id, created: false, action: "unpublished" as const, message: "Categoría inactiva (o con padre inactivo): retirada de todos los canales." }
      : { collectionId: collection.id, created: false, action: "unchanged" as const, message: "Categoría inactiva (o con padre inactivo): ya estaba desactivada." };
  }
  if (collection) return { collectionId: collection.id, created: false, action: "unchanged" as const, message: "La colección ya existía y está activa: sin cambios." };
  const result = await shopify<{ data: { collectionCreate: { collection: { id: string } | null; userErrors: { message: string }[] } } }>(
    `mutation($input:CollectionInput!){collectionCreate(input:$input){collection{id} userErrors{message}}}`,
    { input: { title: name, handle: categoryHandle(category), sortOrder: "MANUAL", ruleSet: { appliedDisjunctively: false, rules: [{ column: "TAG", relation: "EQUALS", condition: name }] } } },
  );
  const created = result.data.collectionCreate.collection;
  if (!created || result.data.collectionCreate.userErrors.length) throw new Error(result.data.collectionCreate.userErrors.map((item) => item.message).join(" ") || "Shopify no creó la colección.");
  const fields = await shopify<{ data: { metafieldsSet: { userErrors: { message: string }[] } } }>(
    `mutation($metafields:[MetafieldsSetInput!]!){metafieldsSet(metafields:$metafields){userErrors{message}}}`,
    { metafields: [{ ownerId: created.id, namespace: "custom", key: "id_cateroria_origen", type: "single_line_text_field", value: category.id }, { ownerId: created.id, namespace: "custom", key: "es_marca", type: "boolean", value: "false" }] },
  );
  if (fields.data.metafieldsSet.userErrors.length) throw new Error(fields.data.metafieldsSet.userErrors.map((item) => item.message).join(" "));
  await publish(created.id);
  return { collectionId: created.id, created: true, action: "created" as const, message: "Colección de categoría creada y publicada." };
}
async function syncManufacturer(manufacturer: Manufacturer) {
  const name = manufacturer.name?.trim();
  if (!name) throw new Error("La marca no tiene nombre.");
  let collection = await findCollection(name);
  const created = !collection;
  if (collection) return { collectionId: collection.id, created: false, action: "unchanged" as const };
  if (!collection) {
    const result = await shopify<{ data: { collectionCreate: { collection: { id: string; title: string } | null; userErrors: { message: string }[] } } }>(
      `mutation($input:CollectionInput!){collectionCreate(input:$input){collection{id title} userErrors{message}}}`,
      { input: { title: name, sortOrder: "MANUAL", ruleSet: { appliedDisjunctively: false, rules: [{ column: "VENDOR", relation: "EQUALS", condition: name }] } } },
    );
    collection = result.data.collectionCreate.collection;
    if (!collection || result.data.collectionCreate.userErrors.length) throw new Error(result.data.collectionCreate.userErrors.map((item) => item.message).join(" ") || "Shopify no creó la colección.");
  }
  const logoId = await uploadLogo(manufacturer);
  const coverUrl = logoId ? await fileImageUrl(logoId) : null;
  const metafields: Record<string, unknown>[] = [{ ownerId: collection.id, namespace: "custom", key: "es_marca", type: "boolean", value: "true" }];
  if (coverUrl) metafields.push({ ownerId: collection.id, namespace: "custom", key: "logotipo", type: "multi_line_text_field", value: coverUrl });
  const fields = await shopify<{ data: { metafieldsSet: { userErrors: { message: string }[] } } }>(`mutation($metafields:[MetafieldsSetInput!]!){metafieldsSet(metafields:$metafields){userErrors{message}}}`, { metafields });
  if (fields.data.metafieldsSet.userErrors.length) throw new Error(fields.data.metafieldsSet.userErrors.map((item) => item.message).join(" "));
  if (manufacturer.image) {
    if (!coverUrl) throw new Error("El logotipo todavía no está disponible como imagen en Shopify.");
    const image = await shopify<{ data: { collectionUpdate: { userErrors: { message: string }[] } } }>(`mutation($input:CollectionInput!){collectionUpdate(input:$input){userErrors{message}}}`, { input: { id: collection.id, image: { src: coverUrl, altText: name } } });
    if (image.data.collectionUpdate.userErrors.length) throw new Error(image.data.collectionUpdate.userErrors.map((item) => item.message).join(" "));
  }
  await publish(collection.id);
  return { collectionId: collection.id, created: true, action: "created" as const };
}
async function log(runId: string, values: Record<string, unknown>) {
  const { error } = await db.from("catalog_import_events").insert({ run_id: runId, ...values });
  if (error) throw error;
  if (values.entity_type === "products" && values.source_entity_id && ["created", "updated", "unchanged"].includes(String(values.outcome))) {
    const { error: syncError } = await db.from("source_products").update({ shopify_synced: true, images_sync_pending: false }).eq("id", values.source_entity_id);
    if (syncError) throw syncError;
  }
}
async function archive(messageId: number, queueName = "catalog_import_jobs") {
  const rpc = queueName === "icecat_import_jobs" ? "archive_icecat_import_message" : queueName === "priority_import_jobs" ? "archive_priority_import_message" : "archive_catalog_import_message";
  const { error } = await db.rpc(rpc, { p_message_id: messageId });
  if (error) throw error;
}
async function nextManufacturers(run: Run) {
  let query = db.from("source_manufacturers").select("id,name,active,image").order("id", { ascending: true }).limit(20);
  if (run.cursor_entity_id) query = query.gt("id", run.cursor_entity_id);
  if (run.filters.onlyActive !== false) query = query.eq("active", true);
  if (run.filters.manufacturerId) query = query.eq("id", run.filters.manufacturerId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as Manufacturer[];
}
async function nextCategories(run: Run) {
  let query = db.from("source_categories").select("id,name,link_rewrite,id_parent,active").order("id", { ascending: true }).limit(20);
  if (run.cursor_entity_id) query = query.gt("id", run.cursor_entity_id);
  if (run.filters.categoryId) query = query.eq("id", run.filters.categoryId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as Category[];
}
async function nextFeatures(run: Run) {
  let query = db.from("source_features").select("id,name").order("id", { ascending: true }).limit(20).not("id", "in", `(${[...excludedFeatureIds].map((id) => `\"${id}\"`).join(",")})`);
  if (run.cursor_entity_id) query = query.gt("id", run.cursor_entity_id);
  if (run.filters.featureId) query = query.eq("id", run.filters.featureId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as Feature[];
}
async function nextProducts(run: Run) {
  const productIds = run.filters.productIds?.length ? run.filters.productIds : run.filters.productId ? [run.filters.productId] : [];
  let cursor = run.cursor_entity_id;
  while (true) {
    let query = db.from("source_products").select("id,name,active,fecha_modificacion,fecha_modificacion_imagen,images_sync_pending,id_manufacturer,id_category_default,product_features,shopify_synced").order("id", { ascending: true }).limit(100);
    if (cursor) query = query.gt("id", cursor);
    query = query.eq("active", true);
    if (productIds.length) query = query.in("id", productIds);
    if (run.filters.modifiedSince) query = query.gte("fecha_modificacion", `${run.filters.modifiedSince}T00:00:00`);
    const { data, error } = await query;
    if (error) throw error;
    const rows = (data ?? []) as (Product & { shopify_synced?: boolean })[];
    if (!rows.length) return [];
    if (run.filters.productSyncMode !== "changes") return rows.slice(0, 10);
    const { data: links, error: linkError } = await db.from("product_shopify_links").select("source_sku,link_status").in("source_sku", rows.map((row) => row.id));
    if (linkError) throw linkError;
    const linked = new Map((links ?? []).map((link) => [link.source_sku, link.link_status]));
    const candidates = rows.filter((row) => row.shopify_synced === false || row.images_sync_pending === true || linked.get(row.id) !== "linked");
    if (candidates.length) return candidates.slice(0, 10);
    cursor = rows[rows.length - 1].id;
    if (rows.length < 100) return [];
  }
}
async function nextPriorities(run: Run) {
  const name = run.filters.collectionName?.toLowerCase();
  const collections = (await priorityCollections()).filter((collection) => !name || collection.title.toLowerCase().includes(name));
  const currentIndex = run.cursor_entity_id?.startsWith("priority:") ? Number(run.cursor_entity_id.slice("priority:".length)) + 1 : 0;
  const collection = collections[currentIndex];
  return collection ? [{ id: `priority:${currentIndex}`, name: collection.title, priorityCollection: collection }] : [];
}
async function nextIcecatProducts(run: Run) {
  const selections = [...new Set([...(run.filters.productIds ?? []).map((value) => `sku:${value}`), ...(run.filters.eans ?? []).map((value) => `barcode:${value}`)])];
  if (selections.length) {
    const currentIndex = run.cursor_entity_id?.startsWith("icecat:") ? Number(run.cursor_entity_id.slice(7)) + 1 : 0;
    const selection = selections[currentIndex];
    if (!selection) return [];
    const product = await findShopifyProduct(selection);
    return [{ id: `icecat:${currentIndex}`, name: product?.title ?? selection, ean13: product?.variants.nodes[0]?.barcode ?? null, shopify: product }];
  }
  const after = run.cursor_entity_id?.startsWith("icecat-shopify:") ? run.cursor_entity_id.slice("icecat-shopify:".length) : null;
  const query = icecatShopifyQuery(run.filters.force === true);
  const result = await shopify<{ data: { products: { edges: { cursor: string; node: ShopifyProduct }[] } } }>(
    `query($after:String,$query:String!){products(first:10,after:$after,query:$query,sortKey:ID){edges{cursor node{${shopifyProductFields}}}}}`,
    { after, query },
  );
  return result.data.products.edges.map((edge) => ({ id: `icecat-shopify:${edge.cursor}`, name: edge.node.title, ean13: edge.node.variants.nodes.find((variant) => variant.barcode?.trim())?.barcode?.trim() ?? null, shopify: edge.node }));
}
function sourceFeaturePairs(value: string | null) {
  if (!value) return [] as { featureId: string; valueId: string }[];
  return value.split(";").map((part) => part.trim()).filter(Boolean).flatMap((part) => {
    const [featureId, valueId] = part.split("=", 2).map((item) => item?.trim());
    return featureId && valueId ? [{ featureId, valueId }] : [];
  });
}
function synchronizableFeaturePairs(value: string | null) {
  return sourceFeaturePairs(value).filter((pair) => !excludedFeatureIds.has(pair.featureId));
}
function sourceBooleanTagPairs(value: string | null) {
  const tags: string[] = [];
  for (const pair of sourceFeaturePairs(value)) {
    if (pair.featureId === "SUPEROFERTA" && pair.valueId === "SUPEROFERTA_1") tags.push("SuperOferta");
    if (pair.featureId === "DESCATALOGADO" && pair.valueId === "DESCATALOGADO_1") tags.push("Descatalogado");
  }
  return tags;
}
async function validateProduct(product: Product) {
  const problems: string[] = [];
  const warnings: string[] = [];
  if (!product.name?.trim()) problems.push("no tiene nombre");
  if (!product.id_manufacturer) problems.push("no tiene fabricante asignado");
  else { const { data } = await db.from("source_manufacturers").select("id").eq("id", product.id_manufacturer).maybeSingle(); if (!data) problems.push(`el fabricante ${product.id_manufacturer} no existe`); }
  if (!product.id_category_default) problems.push("no tiene categoría asignada");
  else { const { data } = await db.from("source_categories").select("id").eq("id", product.id_category_default).maybeSingle(); if (!data) problems.push(`la categoría ${product.id_category_default} no existe`); }
  const { data: price } = await db.from("source_prices").select("id").eq("id_product", product.id).limit(1).maybeSingle();
  if (!price) problems.push("no tiene fila de precio");
  const { data: stock } = await db.from("source_stock").select("id").eq("id_product", product.id).limit(1).maybeSingle();
  if (!stock) problems.push("no tiene fila de stock");
  const pairs = synchronizableFeaturePairs(product.product_features);
  if (pairs.length) {
    const ids = [...new Set(pairs.map((pair) => pair.featureId))]; const valueIds = [...new Set(pairs.map((pair) => pair.valueId))];
    const [{ data: features }, { data: values }] = await Promise.all([db.from("source_features").select("id").in("id", ids), db.from("source_feature_values").select("id").in("id", valueIds)]);
    const featureIds = new Set((features ?? []).map((item) => item.id)); const knownValueIds = new Set((values ?? []).map((item) => item.id));
    for (const pair of pairs) { if (!featureIds.has(pair.featureId)) warnings.push(`la característica ${pair.featureId} no existe y se omitirá`); if (!knownValueIds.has(pair.valueId)) warnings.push(`el valor de característica ${pair.valueId} no existe y se omitirá`); }
  }
  if (problems.length) throw new Error(`Datos de origen incompletos: ${problems.join("; ")}.`);
  return warnings;
}
function productHandle(product: Product) { return (product.name ?? product.id).trim().toLocaleLowerCase("es-ES").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
function sourceProductHandle(value: string | null | undefined, fallback: string) { return String(value || fallback).trim().replace(/^-+|-+$/g, ""); }
const shopifyProductFields = `id handle status title descriptionHtml vendor productType templateSuffix tags seo{title description} media(first:50){nodes{id}} metafields(first:250){nodes{namespace key value}} variants(first:100){nodes{id sku barcode price compareAtPrice inventoryPolicy inventoryQuantity inventoryItem{id}}}`;
function icecatShopifyQuery(force: boolean) { return force ? "barcode:*" : "barcode:* AND -metafields.custom.icecat:*"; }
async function icecatShopifyProductCount(force: boolean) {
  const result = await shopify<{ data: { productsCount: { count: number } } }>(`query($query:String!){productsCount(query:$query,limit:null){count}}`, { query: icecatShopifyQuery(force) });
  return result.data.productsCount.count;
}
async function findShopifyProduct(query: string) {
  const result = await shopify<{ data: { products: { nodes: ShopifyProduct[] } } }>(`query($query:String!){products(first:1,query:$query){nodes{${shopifyProductFields}}}}`, { query });
  return result.data.products.nodes[0] ?? null;
}
async function findShopifyProductById(id: string) {
  const result = await shopify<{ data: { product: ShopifyProduct | null } }>(`query($id:ID!){product(id:$id){${shopifyProductFields}}}`, { id });
  return result.data.product;
}
async function findProduct(product: Pick<Product, "id" | "name">) {
  const { data: link } = await db.from("product_shopify_links").select("shopify_product_id,link_status").eq("source_sku", product.id).maybeSingle();
  if (link?.link_status === "linked" && link.shopify_product_id) {
    const linked = await findShopifyProductById(link.shopify_product_id);
    if (linked) return linked;
  }
  return await findShopifyProduct(`sku:${JSON.stringify(product.id)}`) ?? await findShopifyProduct(`handle:${JSON.stringify(productHandle(product))}`);
}
async function upsertProductShopifyLink(sourceSku: string, product: ShopifyProduct) {
  const variant = product.variants.nodes.find((item) => item.sku === sourceSku) ?? product.variants.nodes[0];
  if (!variant) throw new Error(`Shopify no devolvió la variante técnica del SKU ${sourceSku}.`);
  const { error } = await db.from("product_shopify_links").upsert({ source_sku: sourceSku, link_status: "linked", shopify_match_count: 1, shopify_product_id: product.id, shopify_variant_id: variant.id, shopify_inventory_item_id: variant.inventoryItem?.id ?? null, shopify_handle: product.handle, shopify_status: product.status }, { onConflict: "source_sku" });
  if (error) throw error;
}
async function syncIcecatProduct(product: IcecatProduct, force: boolean) {
  const existing = product.shopify ?? await findProduct(product);
  if (!existing) return { action: "unchanged" as const, targetId: null, message: "El producto no existe en Shopify: sin cambios." };
  const current = new Map(existing.metafields.nodes.map((field) => [`${field.namespace}.${field.key}`, field.value]));
  if (current.has("custom.icecat") && !force) return { action: "unchanged" as const, targetId: existing.id, message: "Ya tiene datos Icecat: sin cambios." };
  const ean = existing.variants.nodes.find((variant) => variant.barcode?.trim())?.barcode?.trim();
  if (!ean) return { action: "unchanged" as const, targetId: existing.id, message: "El producto de Shopify no tiene EAN: sin cambios." };
  const data = await icecatData(ean);
  if (!data) return { action: "unchanged" as const, targetId: existing.id, message: `Icecat no devolvió datos para el EAN ${ean}.` };
  await setIcecatMetafield(existing.id, data);
  const bulletPoints = Array.isArray(data.bullet_points) ? data.bullet_points.length : 0;
  const specifications = record(data.specifications);
  return { action: current.has("custom.icecat") ? "updated" as const : "created" as const, targetId: existing.id, message: `Datos Icecat guardados para el EAN ${ean}: ${bulletPoints} destacados y ${Object.keys(specifications).length} grupos de especificaciones.` };
}
function productImageFilename(product: Record<string, unknown>, index: number, originalUrl: string) {
  const fallback = String(product.name ?? product.id ?? "product").toLocaleLowerCase("es-ES").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const handle = String(product.link_rewrite || fallback).toLowerCase();
  const cleanHandle = handle.replace(/[^a-z0-9-]/g, "") || String(product.id ?? "product");
  const extension = originalUrl.split(/[?#]/, 1)[0].match(/\.[a-z0-9]{1,5}$/i)?.[0] ?? ".jpg";
  return `${cleanHandle}-${index}${extension}`;
}
async function stageProductImages(product: Record<string, unknown>, imageUrls: string[]) {
  const candidates = await Promise.all(imageUrls.map(async (originalUrl, index) => {
    const filename = productImageFilename(product, index + 1, originalUrl);
    try {
      const response = await fetchWithTimeout(proxyUrl(originalUrl), {}, 15_000);
      if (!response.ok) return null;
      const declaredLength = Number(response.headers.get("content-length") ?? 0);
      if (declaredLength > MAX_PRODUCT_IMAGE_BYTES) throw new Error(`La imagen ${filename} supera el límite de 25 MB y no se subirá.`);
      const content = new Uint8Array(await response.arrayBuffer());
      if (content.byteLength > MAX_PRODUCT_IMAGE_BYTES) throw new Error(`La imagen ${filename} supera el límite de 25 MB y no se subirá.`);
      return { filename, alt: String(product.name ?? ""), content, mime: response.headers.get("content-type")?.split(";")[0] || "image/jpeg" };
    } catch (error) {
      if (error instanceof Error && error.message.includes("supera el límite de 25 MB")) throw error;
      return null;
    }
  }));
  const valid = candidates.filter((item): item is NonNullable<typeof item> => Boolean(item));
  if (!valid.length) return [];
  const staged = await shopify<{ data: { stagedUploadsCreate: { stagedTargets: { url: string; resourceUrl: string; parameters: { name: string; value: string }[] }[]; userErrors: ShopifyUserError[] } } }>(
    `mutation($input:[StagedUploadInput!]!){stagedUploadsCreate(input:$input){stagedTargets{url resourceUrl parameters{name value}} userErrors{field message}}}`,
    // Estas subidas se van a adjuntar a un producto. Usar PRODUCT_IMAGE evita
    // que Shopify las trate como archivos genéricos de la biblioteca y aplique
    // la resolución de duplicados de Files (sufijos UUID en el nombre).
    { input: valid.map((item) => ({ filename: item.filename, mimeType: item.mime, resource: "PRODUCT_IMAGE", httpMethod: "POST" })) },
  );
  const uploadInfo = staged.data.stagedUploadsCreate;
  if (uploadInfo.userErrors.length) throw new Error(uploadInfo.userErrors.map((item) => item.message).join(" "));
  if (uploadInfo.stagedTargets.length !== valid.length) throw new Error("Shopify no preparó todas las imágenes del producto.");
  const uploaded: { resourceUrl: string; filename: string; alt: string }[] = [];
  for (const [item, target] of valid.map((value, index) => [value, uploadInfo.stagedTargets[index]] as const)) {
    const form = new FormData();
    for (const parameter of target.parameters) form.append(parameter.name, parameter.value);
    form.append("file", new Blob([item.content], { type: item.mime }), item.filename);
    const response = await fetchWithTimeout(target.url, { method: "POST", body: form }, 20_000);
    if (!response.ok) throw new Error(`No se pudo subir la imagen ${item.filename} a Shopify (${response.status}).`);
    uploaded.push({ resourceUrl: target.resourceUrl, filename: item.filename, alt: item.alt });
  }
  return uploaded;
}
async function removePreviousProductImageFiles(currentMediaIds: string[]) {
  const ids = [...new Set(currentMediaIds)];
  if (!ids.length) return [];
  const result = await shopify<{ data: { fileDelete: { deletedFileIds: string[]; userErrors: ShopifyUserError[] } } }>(
    `mutation($fileIds:[ID!]!){fileDelete(fileIds:$fileIds){deletedFileIds userErrors{field message}}}`,
    { fileIds: ids },
  );
  if (result.data.fileDelete.userErrors.length) throw new Error(result.data.fileDelete.userErrors.map((item) => item.message).join(" "));
  return result.data.fileDelete.deletedFileIds;
}
async function syncProductImages(productId: string, product: Record<string, unknown>, force: boolean, existing: { media: { nodes: { id: string }[] } } | null) {
  const imageUrls = String(product.images ?? "").split("@").map((value) => value.trim()).filter(Boolean);
  const currentCount = existing?.media.nodes.length ?? 0;
  if (!imageUrls.length) return { sourceCount: 0, removedCount: 0, addedCount: 0, action: "sin imágenes de origen; no se tocaron las actuales" };
  if (!force && currentCount) return { sourceCount: imageUrls.length, removedCount: 0, addedCount: 0, action: `sin cambios (${currentCount} ya existentes)` };
  const currentMediaIds = existing?.media.nodes.map((item) => item.id) ?? [];
  let removedCount = 0;
  if (currentMediaIds.length) {
    const removedFileIds = await removePreviousProductImageFiles(currentMediaIds);
    removedCount = removedFileIds.length;
  }
  const stagedImages = await stageProductImages(product, imageUrls);
  if (!stagedImages.length) throw new Error("No se pudo descargar ninguna imagen desde el origen.");
  const added = await shopify<{ data: { productCreateMedia: { userErrors: { message: string }[] } } }>(`mutation($productId:ID!,$media:[CreateMediaInput!]!){productCreateMedia(productId:$productId,media:$media){userErrors{message}}}`, { productId, media: stagedImages.map((image) => ({ originalSource: image.resourceUrl, mediaContentType: "IMAGE", alt: image.alt })) });
  if (added.data.productCreateMedia.userErrors.length) throw new Error(added.data.productCreateMedia.userErrors.map((item) => item.message).join(" "));
  return { sourceCount: imageUrls.length, removedCount, addedCount: stagedImages.length, action: removedCount ? "reemplazadas" : "importadas" };
}
async function archiveInactiveProduct(product: Product) {
  const existing = await findProduct(product);
  if (!existing) return { action: "unchanged" as const, targetId: null, message: "Producto inactivo: no existe en Shopify, sin cambios." };
  if (existing.status === "ARCHIVED") return { action: "unchanged" as const, targetId: existing.id, message: "Producto inactivo: ya estaba archivado." };
  const result = await shopify<{ data: { productUpdate: { userErrors: { message: string }[] } } }>(`mutation($product:ProductUpdateInput!){productUpdate(product:$product){userErrors{message}}}`, { product: { id: existing.id, status: "ARCHIVED" } });
  if (result.data.productUpdate.userErrors.length) throw new Error(result.data.productUpdate.userErrors.map((item) => item.message).join(" "));
  const categoryNamesForRedirect = await categoryNames(product.id_category_default);
  let collection: Awaited<ReturnType<typeof findCollection>> = null;
  for (const categoryName of categoryNamesForRedirect) {
    collection = await findCollection(categoryName);
    if (collection) break;
  }
  if (!collection) return { action: "unpublished" as const, targetId: existing.id, message: "Producto inactivo archivado en Shopify; no se encontró su colección de categoría para crear la redirección." };
  await ensureProductRedirect(existing.handle, `/collections/${collection.handle}`);
  return { action: "unpublished" as const, targetId: existing.id, message: `Producto inactivo archivado y redirigido a /collections/${collection.handle}.` };
}
function htmlToText(value: string | null) { return (value ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(); }
// Shopify serializa los saltos HTML como <br>, aunque origen los entregue
// como <br />. Comparamos una forma canónica para no actualizar sin cambios.
function normalizedHtml(value: unknown) { return String(value ?? "").replace(/<br\s*\/?>/gi, "<br>").trim(); }
function productTags(product: Record<string, unknown>, categoryNames: string[], existing: string[] = []) {
  const tags = [...categoryNames];
  if (product.on_sale === true) tags.push("Oferta");
  if (product.overlay_energetica === true) tags.push("Energética");
  tags.push(...sourceBooleanTagPairs(String(product.product_features ?? "")));
  tags.push(...existing.filter((tag) => !["Oferta", "Energética", "SuperOferta", "Descatalogado"].includes(tag)));
  return [...new Set(tags)];
}
function sameSet(left: string[], right: string[]) { return left.length === right.length && left.every((item) => right.includes(item)); }
function money(value: unknown) { const number = Number(value); return Number.isFinite(number) ? Math.round((number + Number.EPSILON) * 100) / 100 : 0; }
function productDifferences(existing: ShopifyProduct, input: Record<string, unknown>) {
  const variant = existing.variants.nodes[0]; const desired = (input.variants as Record<string, unknown>[])[0]; const fields = input.metafields as { namespace: string; key: string; value: string }[];
  const currentFields = new Map(existing.metafields.nodes.map((field) => [`${field.namespace}.${field.key}`, field.value]));
  const differences: string[] = [];
  if (!variant) differences.push("variante");
  if (existing.title !== input.title) differences.push("título");
  if (existing.handle !== input.handle) differences.push("handle");
  if (normalizedHtml(existing.descriptionHtml) !== normalizedHtml(input.descriptionHtml)) differences.push("descripción");
  if (existing.vendor !== input.vendor) differences.push("fabricante");
  if (existing.productType !== input.productType) differences.push("tipo de producto");
  if (typeof input.templateSuffix === "string" && existing.templateSuffix !== input.templateSuffix) differences.push("plantilla de tema");
  if (existing.status !== input.status) differences.push("estado");
  if (!sameSet(existing.tags, input.tags as string[])) differences.push("etiquetas");
  if (existing.seo?.title !== (input.seo as { title: string }).title || existing.seo?.description !== (input.seo as { description: string }).description) differences.push("SEO");
  if (variant && (variant.sku !== desired.sku || variant.barcode !== (desired.barcode ?? null) || variant.inventoryPolicy !== desired.inventoryPolicy)) differences.push("variante");
  if (fields.some((field) => currentFields.get(`${field.namespace}.${field.key}`) !== field.value)) differences.push("metacampos");
  return differences;
}
function sameProduct(existing: ShopifyProduct, input: Record<string, unknown>, forceImages: boolean, hasSourceImages: boolean) {
  const variant = existing.variants.nodes[0]; const desired = (input.variants as Record<string, unknown>[])[0]; const fields = input.metafields as { namespace: string; key: string; value: string }[];
  const currentFields = new Map(existing.metafields.nodes.map((field) => [`${field.namespace}.${field.key}`, field.value]));
  return !forceImages && (!hasSourceImages || existing.media.nodes.length > 0) && !!variant
    && existing.title === input.title && existing.handle === input.handle && normalizedHtml(existing.descriptionHtml) === normalizedHtml(input.descriptionHtml) && existing.vendor === input.vendor && existing.productType === input.productType && existing.status === input.status
    && (typeof input.templateSuffix !== "string" || existing.templateSuffix === input.templateSuffix)
    && sameSet(existing.tags, input.tags as string[]) && existing.seo?.title === (input.seo as { title: string }).title && existing.seo?.description === (input.seo as { description: string }).description
    && variant.sku === desired.sku && variant.barcode === (desired.barcode ?? null) && variant.inventoryPolicy === desired.inventoryPolicy
    && fields.every((field) => currentFields.get(`${field.namespace}.${field.key}`) === field.value);
}
async function categoryNames(categoryId: string | null) {
  const names: string[] = []; let id = categoryId; const seen = new Set<string>();
  while (id && id !== "0" && !seen.has(id)) { seen.add(id); const { data } = await db.from("source_categories").select("id,name,id_parent").eq("id", id).maybeSingle(); if (!data) break; if (data.name) names.push(data.name); id = data.id_parent; }
  return names;
}
async function productMetafields(product: Record<string, unknown>) {
  const values: { namespace: string; key: string; type?: string; value: string }[] = [];
  const add = (key: string, value: unknown, type = "single_line_text_field") => { if (value !== null && value !== undefined && String(value).trim()) values.push({ namespace: "custom", key, type, value: String(value).trim() }); };
  add("referencia", product.reference); add("descripcion_corta", htmlToText(product.description_short as string | null)); add("disponibilidad_con_stock", product.available_now); add("disponibilidad_sin_stock", product.available_later); add("prioridad", product.prioridad, "number_integer");
  const pairs = synchronizableFeaturePairs(product.product_features as string | null);
  if (!pairs.length) return values;
  const ids = [...new Set(pairs.map((pair) => pair.featureId))]; const valueIds = [...new Set(pairs.map((pair) => pair.valueId))];
  const [{ data: features }, { data: featureValues }] = await Promise.all([db.from("source_features").select("id,name").in("id", ids), db.from("source_feature_values").select("id,value").in("id", valueIds)]);
  const featuresById = new Map((features ?? []).map((item) => [item.id, item])); const valuesById = new Map((featureValues ?? []).map((item) => [item.id, item.value]));
  for (const pair of pairs) { const feature = featuresById.get(pair.featureId); const value = valuesById.get(pair.valueId); if (feature?.name && value) values.push({ namespace: "features", key: featureKey(feature.name), value }); }
  return values;
}
async function getLocationId() { const result = await shopify<{ data: { locations: { nodes: { id: string }[] } } }>(`query{locations(first:1){nodes{id}}}`, {}); return result.data.locations.nodes[0]?.id ?? null; }
async function syncActiveProduct(summary: Product, forceImages: boolean, modifiedSince?: string) {
  const { data: product, error } = await db.from("source_products").select("*").eq("id", summary.id).single(); if (error || !product) throw error ?? new Error("No se pudo leer el producto.");
  const imageWasModified = Boolean(modifiedSince && product.fecha_modificacion_imagen && new Date(product.fecha_modificacion_imagen).getTime() >= new Date(`${modifiedSince}T00:00:00`).getTime());
  const shouldForceImages = forceImages || imageWasModified;
  const isPromotion = product.id_category_default === PROMOTION_CATEGORY_ID;
  const existing = await findProduct(summary);
  const [{ data: manufacturer }, categories, fields, locationId] = await Promise.all([
    db.from("source_manufacturers").select("name").eq("id", product.id_manufacturer).single(), categoryNames(product.id_category_default), productMetafields(product), getLocationId(),
  ]);
  if (!manufacturer?.name || !locationId) throw new Error("No se pudieron obtener todos los datos necesarios para sincronizar el producto.");
  const priceRow = existing ? null : (await db.from("source_prices").select("precio_tarifa").eq("id_product", product.id).limit(1).single()).data;
  const stockRow = existing ? null : (await db.from("source_stock").select("quantity").eq("id_product", product.id).limit(1).single()).data;
  if (!existing && (!priceRow || !stockRow)) throw new Error("No se pudieron obtener precio y stock necesarios para dar de alta el producto.");
  const price = priceRow ? Number(priceRow.precio_tarifa) * 1.21 : undefined;
  const compareAtPrice = !existing && product.price != null ? Number(product.price) * 1.21 : undefined;
  const stock = stockRow ? (product.available_for_order === false ? 0 : Number(stockRow.quantity ?? 0)) : undefined;
  const title = String(product.name ?? product.id).trim();
  const handle = sourceProductHandle(product.link_rewrite, productHandle(summary)); const inventoryPolicy = product.available_for_order === false || String(product.dato_extra ?? "").includes("out_of_stock{2}") ? "DENY" : "CONTINUE";
  // Igual que el Python original: el tipo no se envía en ProductSetInput;
  // Shopify lo resuelve usando la definición existente del metafield.
  const weight = product.weight == null ? undefined : Number(product.weight);
  const variant: Record<string, unknown> = { optionValues: [{ optionName: "Title", name: "Default Title" }], sku: product.id, ...(product.ean13 ? { barcode: product.ean13 } : {}), inventoryPolicy, ...(Number.isFinite(weight) ? { inventoryItem: { measurement: { weight: { value: weight, unit: "KILOGRAMS" } } } } : {}) };
  if (!existing) Object.assign(variant, { price, ...(compareAtPrice ? { compareAtPrice } : {}), inventoryQuantities: [{ locationId, name: "on_hand", quantity: stock }] });
  const input: Record<string, unknown> = { title, handle, descriptionHtml: product.description ?? "", vendor: manufacturer.name, productType: categories[0] ?? "", tags: productTags(product, categories, existing?.tags), status: "ACTIVE", seo: { title: String(product.meta_title || title).trim(), description: product.meta_description || htmlToText(product.description_short) }, metafields: fields.map(({ namespace, key, value }) => ({ namespace, key, value })), productOptions: [{ name: "Title", position: 1, values: [{ name: "Default Title" }] }], variants: [variant], ...(isPromotion ? { templateSuffix: PROMOTION_TEMPLATE_SUFFIX } : {}) };
  if (existing) { input.id = existing.id; if (sameProduct(existing, input, shouldForceImages, Boolean(product.images))) { await upsertProductShopifyLink(product.id, existing); const sourceCount = String(product.images ?? "").split("@").filter(Boolean).length; return { action: "unchanged" as const, targetId: existing.id, message: `Producto ya actualizado: sin cambios. Imágenes: sin cambios (${existing.media.nodes.length} actuales; ${sourceCount} en origen).` }; } }
  const result = await shopify<{ data: { productSet: { product: ShopifyProduct | null; userErrors: ShopifyUserError[] } } }>(`mutation($input:ProductSetInput!){productSet(input:$input){product{${shopifyProductFields}} userErrors{field message}}}`, { input });
  const updated = result.data.productSet.product; if (!updated || result.data.productSet.userErrors.length) {
    const details = result.data.productSet.userErrors.map((item) => {
      const path = item.field?.join(".");
      const match = path?.match(/metafields\.(\d+)/);
      const field = match ? (input.metafields as { namespace: string; key: string; type?: string }[])[Number(match[1])] : undefined;
      return `${item.message}${path ? ` [${path}${field ? ` → ${field.namespace}.${field.key} (${field.type ?? "tipo no indicado"})` : ""}]` : ""}`;
    }).join(" ");
    const error = new Error(`Shopify productSet: ${details || "no guardó el producto."}`) as ErrorWithDetails;
    error.details = { provider: "shopify", operation: "productSet", user_errors: result.data.productSet.userErrors };
    throw error;
  }
  const imageResult = await syncProductImages(updated.id, product, shouldForceImages, existing);
  await publish(updated.id);
  await upsertProductShopifyLink(product.id, updated);
  const imageMessage = imageResult.removedCount
    ? `Imágenes: se reemplazaron ${imageResult.removedCount} por ${imageResult.addedCount} nuevas (${imageResult.sourceCount} en origen).`
    : imageResult.addedCount
      ? `Imágenes: se importaron ${imageResult.addedCount} (${imageResult.sourceCount} en origen); no había imágenes anteriores.`
      : `Imágenes: ${imageResult.action}.`;
  const redirectRemoved = existing?.status === "ARCHIVED" ? await removeProductRedirect(existing.handle) : false;
  const differences = existing ? productDifferences(existing, input) : [];
  const publicationMessage = existing ? "Producto actualizado y publicado." : "Producto creado y publicado.";
  return { action: existing ? "updated" as const : "created" as const, targetId: updated.id, message: `${publicationMessage}${redirectRemoved ? " Redirección de producto eliminada." : ""} ${imageMessage}${differences.length ? ` Cambios detectados: ${differences.join(", ")}.` : ""}` };
}
export async function processMessage(message: { msg_id: number; message: { run_id?: string }; read_ct?: number }, queueName = "catalog_import_jobs") {
  const messageId = Number(message.msg_id); const runId = message.message?.run_id;
  if (!runId) return archive(messageId, queueName);
  const { data } = await db.from("catalog_import_runs").select("*").eq("id", runId).maybeSingle();
  if (!data || ["completed", "stopped", "failed"].includes(data.status)) return archive(messageId, queueName);
  if (data.status === "paused") return;
  const workerToken = crypto.randomUUID();
  const { data: claimed, error: claimError } = await db.rpc("claim_catalog_import_worker", { p_run_id: runId, p_worker_token: workerToken });
  if (claimError) throw claimError;
  if (!claimed) {
    // Otra invocación sigue viva. Conservamos el mensaje en vuelo sin
    // archivarlo para que el segundo worker no procese la misma ejecución.
    await db.rpc("renew_import_queue_message", { p_queue_name: queueName, p_message_id: messageId, p_visibility_timeout: 30 });
    return;
  }
  const workerStartedAt = Date.now();
  let lastHeartbeatAt = 0;
  const heartbeat = async (entityId: string | null = null, entityName: string | null = null, operation: string | null = null, force = false) => {
    if (!force && Date.now() - lastHeartbeatAt < WORKER_HEARTBEAT_MS) return;
    await db.rpc("heartbeat_catalog_import_worker", { p_run_id: runId, p_worker_token: workerToken, p_entity_id: entityId, p_entity_name: entityName, p_operation: operation });
    await db.rpc("renew_import_queue_message", { p_queue_name: queueName, p_message_id: messageId, p_visibility_timeout: 300 });
    lastHeartbeatAt = Date.now();
  };
  const yieldWorker = async () => {
    await db.from("catalog_import_runs").update({ status: "queued", updated_at: new Date().toISOString() }).eq("id", runId).eq("worker_token", workerToken);
    await db.rpc("release_catalog_import_worker", { p_run_id: runId, p_worker_token: workerToken });
    await db.rpc("renew_import_queue_message", { p_queue_name: queueName, p_message_id: messageId, p_visibility_timeout: 0 });
  };
  try {
    await heartbeat(null, null, "preparando ejecución", true);
    let run = data as Run;
    const hasIcecatSelections = Boolean(run.filters.productIds?.length || run.filters.eans?.length);
    if (run.entity_type === "icecat" && !hasIcecatSelections && run.processed_count === 0 && !run.cursor_entity_id) {
      const total = await icecatShopifyProductCount(run.filters.force === true);
      await db.from("catalog_import_runs").update({ total_count: total, updated_at: new Date().toISOString() }).eq("id", runId);
      run = { ...run, total_count: total };
    }
    if (run.entity_type === "priorities" && run.processed_count === 0 && !run.cursor_entity_id) {
      const priorityName = run.filters.collectionName?.toLowerCase();
      const total = (await priorityCollections()).filter((collection) => !priorityName || collection.title.toLowerCase().includes(priorityName)).length;
      await db.from("catalog_import_runs").update({ total_count: total, updated_at: new Date().toISOString() }).eq("id", runId);
      run = { ...run, total_count: total };
    }
    const categorySource = run.entity_type === "categories"
      ? await db.from("source_categories").select("id,name,link_rewrite,id_parent,active")
      : null;
    if (categorySource?.error) throw categorySource.error;
    const allCategories = new Map((categorySource?.data ?? []).map((category) => [category.id, category as Category]));
    const collections = run.entity_type === "categories" ? await categoryCollections() : [];
    const definitions = run.entity_type === "features" ? await featureDefinitions() : new Map<string, string>();
    while (run.processed_count < run.total_count) {
      if (Date.now() - workerStartedAt >= WORKER_BUDGET_MS) { await yieldWorker(); return; }
      const { data: current } = await db.from("catalog_import_runs").select("*").eq("id", runId).single(); run = current as Run;
      if (run.status === "paused") return;
      if (run.status === "stopped") return archive(messageId, queueName);
      const entities = run.entity_type === "manufacturers" ? await nextManufacturers(run) : run.entity_type === "categories" ? await nextCategories(run) : run.entity_type === "features" ? await nextFeatures(run) : run.entity_type === "products" ? await nextProducts(run) : run.entity_type === "priorities" ? await nextPriorities(run) : await nextIcecatProducts(run);
      if (!entities.length) break;
      for (const entity of entities) {
        if (Date.now() - workerStartedAt >= WORKER_BUDGET_MS) { await yieldWorker(); return; }
        const { data: control } = await db.from("catalog_import_runs").select("status").eq("id", runId).single();
        if (control?.status === "paused") return;
        if (control?.status === "stopped") return archive(messageId, queueName);
        await heartbeat(entity.id, entity.name, "procesando entidad", true);
        let outcome: "created" | "updated" | "unchanged" | "unpublished" | "error" = "error"; let action: "created" | "updated" | "unchanged" | "unpublished" | "error" = "error"; let targetId: string | null = null; let messageText = ""; let details: Record<string, unknown> | null = null;
        try {
          if (run.entity_type === "manufacturers") {
            const result = await syncManufacturer(entity as Manufacturer);
            outcome = result.created ? "created" : "updated"; action = result.action; targetId = result.collectionId;
            messageText = result.created ? "Colección de marca creada y publicada." : "La colección de marca ya existía: sin cambios.";
          } else if (run.entity_type === "categories") {
            const result = await syncCategory(entity as Category, allCategories, collections);
            outcome = result.created ? "created" : "updated"; action = result.action; targetId = result.collectionId; messageText = result.message;
          } else if (run.entity_type === "features") {
            const result = await syncFeature(entity as Feature, definitions);
            outcome = result.created ? "created" : "updated"; action = result.action; targetId = result.definitionId; messageText = result.message;
          } else if (run.entity_type === "products") {
            const product = entity as Product;
            if (product.active !== true) {
              const result = await archiveInactiveProduct(product);
              action = result.action; targetId = result.targetId; outcome = result.action === "unpublished" ? "updated" : "updated"; messageText = result.message;
            } else {
              const warnings = await validateProduct(product);
              const result = await syncActiveProduct(product, run.filters.forceImages === true || product.images_sync_pending === true, run.filters.modifiedSince);
              action = result.action; targetId = result.targetId; outcome = result.action; messageText = result.message;
              if (warnings.length) messageText += ` Aviso: ${warnings.join("; ")}.`;
            }
          } else if (run.entity_type === "priorities") {
            const result = await syncPriorityCollection((entity as { priorityCollection: PriorityCollection }).priorityCollection);
            action = result.action; outcome = result.action; targetId = result.targetId; messageText = result.message;
          } else {
            const result = await syncIcecatProduct(entity as IcecatProduct, run.filters.force === true);
            action = result.action; targetId = result.targetId; outcome = result.action === "created" ? "created" : "updated"; messageText = result.message;
            // Icecat limita a cinco consultas por segundo; mantenemos el intervalo del Python original.
            await new Promise((resolve) => setTimeout(resolve, 200));
          }
        }
        catch (error) { details = errorDetails(error, { entity_type: run.entity_type, source_entity_id: entity.id, source_entity_name: entity.name, operation: "catalog_sync" }); messageText = details.message as string; }
        const counts = { processed_count: run.processed_count + 1, cursor_entity_id: entity.id, created_count: run.created_count + (action === "created" ? 1 : 0), updated_count: run.updated_count + (action === "updated" ? 1 : 0), unchanged_count: run.unchanged_count + (action === "unchanged" ? 1 : 0), unpublished_count: run.unpublished_count + (action === "unpublished" ? 1 : 0), error_count: run.error_count + (action === "error" ? 1 : 0), updated_at: new Date().toISOString() };
        await db.from("catalog_import_runs").update(counts).eq("id", runId);
        await log(runId, { level: outcome === "error" ? "error" : "success", outcome, entity_type: run.entity_type, source_entity_id: entity.id, source_entity_name: entity.name, shopify_resource_id: targetId, message: messageText, ...(details ? { details } : {}) });
        run = { ...run, ...counts };
        await heartbeat(entity.id, entity.name, "entidad registrada");
      }
    }
    await db.from("catalog_import_runs").update({ status: "completed", finished_at: new Date().toISOString() }).eq("id", runId);
    await log(runId, { level: "info", outcome: "status", entity_type: run.entity_type, message: "Importación completada." });
    await db.rpc("release_catalog_import_worker", { p_run_id: runId, p_worker_token: workerToken });
    await archive(messageId, queueName);
  } catch (error) {
    const details = errorDetails(error, { operation: "catalog_worker", retry_count: Number(message.read_ct ?? 1) }); const text = details.message as string; const attempt = Number(message.read_ct ?? 1);
    await db.rpc("release_catalog_import_worker", { p_run_id: runId, p_worker_token: workerToken });
    if (attempt >= 3) { await db.from("catalog_import_runs").update({ status: "failed", finished_at: new Date().toISOString() }).eq("id", runId); await log(runId, { level: "error", outcome: "status", entity_type: data.entity_type, message: `Importación fallida: ${text}`, details }); await archive(messageId, queueName); }
    else { await db.from("catalog_import_runs").update({ status: "queued" }).eq("id", runId); await log(runId, { level: "warning", outcome: "status", entity_type: data.entity_type, message: `Reintento ${attempt}: ${text}`, details }); await db.rpc("renew_import_queue_message", { p_queue_name: queueName, p_message_id: messageId, p_visibility_timeout: 0 }); }
  }
}

export async function handleWorkerRequest(request: Request, queueName = "catalog_import_jobs") {
  if (request.method !== "POST") return json({ error: "Método no permitido" }, 405);
  const rpc = queueName === "icecat_import_jobs" ? "read_icecat_import_message" : queueName === "priority_import_jobs" ? "read_priority_import_message" : "read_catalog_import_message";
  const { data, error } = await db.rpc(rpc);
  if (error) return json({ error: error.message }, 500);
  if (!data) return json({ accepted: false, empty: true });
  EdgeRuntime.waitUntil(processMessage(data, queueName));
  return json({ accepted: true, runId: data.message?.run_id ?? null }, 202);
}

if (import.meta.main) Deno.serve((request) => handleWorkerRequest(request, "catalog_import_jobs"));
