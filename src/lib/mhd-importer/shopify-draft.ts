// Pieza del importador: crea en Shopify, en BORRADOR, el producto que montó el procesador (una prueba guardada en
// mhd_importer_product_runs). Sube las fotos ya tratadas, la etiqueta energética en PNG y los PDF con su nombre
// normalizado y los vídeos, y lo crea todo de una vez con `productSet`: textos, SEO, colecciones (tipo, etiquetas, proveedor),
// categoría, variante, stock por ubicación y metacampos. Nunca publica. Si el producto (mismo código de MHD) ya se creó
// antes, lo ACTUALIZA en vez de crear otro, conservando su dirección y su estado. Ver docs/IMPORTADOR_PRODUCTOS_MHD.md.
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { STORE_RULES, type ProcessedProduct } from "./processor";
import { fetchIcecatDocument, type IcecatConfig } from "./sources";
import { mediaBytes } from "./media-store";
import { SHOPIFY_CATEGORY_BY_FAMILY } from "./shopify-categories";
import { noTrace, type Trace } from "./trace";
import { shopifyGraphql, type ShopifyConfig } from "./store-filters";
import { MIRROR_PRODUCT_FIELDS, MIRROR_VARIANT_FIELDS, mirrorProduct } from "../shopify-mirror";

// Regla de David (2026-10-26): los productos con revisión pendiente se suben igual, como borrador, y se revisan antes de
// publicar. Llevan esta etiqueta mientras estén pendientes en la cola; al marcarlos «Está bien» se quita.
export const REVIEW_TAG = "Revisar antes de publicar";
export async function setReviewTag(shopify: ShopifyConfig, productId: string, pending: boolean) {
  const mutation = pending ? "tagsAdd" : "tagsRemove";
  const result = await shopifyGraphql<Record<string, { userErrors: { message: string }[] }>>(shopify, `mutation($id: ID!, $tags: [String!]!) { ${mutation}(id: $id, tags: $tags) { userErrors { message } } }`, { id: productId, tags: [REVIEW_TAG] });
  const errors = result[mutation]?.userErrors ?? [];
  if (errors.length) throw new Error(errors.map((item) => item.message).join(" "));
}

type UserError = { field: string[] | null; message: string };
type Upload = { filename: string; mimeType: string; bytes: Uint8Array; resource: "IMAGE" | "FILE" | "VIDEO" };

function check(errors: UserError[], what: string) { if (errors.length) throw new Error(`${what}: ${errors.map((error) => `${error.field?.join(".") ?? ""} ${error.message}`.trim()).join("; ")}`); }

// Subida en dos pasos: Shopify da un destino temporal y allí se envía el archivo; devuelve la URL para usarla después.
async function stagedUpload(config: ShopifyConfig, files: Upload[]) {
  if (!files.length) return [];
  const data = await shopifyGraphql<{ stagedUploadsCreate: { stagedTargets: { url: string; resourceUrl: string; parameters: { name: string; value: string }[] }[]; userErrors: UserError[] } }>(config,
    `mutation($input: [StagedUploadInput!]!) { stagedUploadsCreate(input: $input) { stagedTargets { url resourceUrl parameters { name value } } userErrors { field message } } }`,
    { input: files.map((file) => ({ filename: file.filename, mimeType: file.mimeType, resource: file.resource, httpMethod: "POST", fileSize: String(file.bytes.byteLength) })) });
  check(data.stagedUploadsCreate.userErrors, "No se pudo preparar la subida");
  const targets = data.stagedUploadsCreate.stagedTargets;
  await Promise.all(files.map(async (file, index) => {
    const target = targets[index]; const form = new FormData();
    for (const parameter of target.parameters) form.append(parameter.name, parameter.value);
    form.append("file", new Blob([Buffer.from(file.bytes)], { type: file.mimeType }), file.filename);
    const response = await fetch(target.url, { method: "POST", body: form, signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`No se pudo subir ${file.filename} (HTTP ${response.status}).`);
  }));
  return targets.map((target) => target.resourceUrl);
}

// Límites de Shopify (comprobado 2026-10-26: un PDF de 35 MB devuelve «EntityTooLarge»): 20 MB para archivos que no
// son imagen ni vídeo y para imágenes; 1 GB para vídeos (los vídeos ya se limitan antes a 50 MB, el máximo del
// almacenamiento: videos.ts).
export const SHOPIFY_MAX_FILE_BYTES = 20_000_000;
const mb = (bytes: number) => `${(bytes / 1_000_000).toFixed(1).replace(".", ",")} MB`;

// PDF de más de 20 MB: no se sube, sin intentar comprimirlo (David, 2026-10-26: «tan grandes, fuera»). Probado: un ZIP
// le quita un 2 % y limpiarlo con MuPDF, un 8 %; no compensa.
function fitDocument(bytes: Uint8Array): { bytes: Uint8Array | null; note: string | null } {
  if (bytes.byteLength <= SHOPIFY_MAX_FILE_BYTES) return { bytes, note: null };
  return { bytes: null, note: `demasiado grande para Shopify (${mb(bytes.byteLength)}; máximo 20 MB): no se sube.` };
}

// Archivos que se enlazan desde metacampos (etiqueta, PDF): se crean en Archivos de Shopify con su nombre.
async function createFiles(config: ShopifyConfig, files: { originalSource: string; filename: string; contentType: "IMAGE" | "FILE" | "VIDEO"; alt?: string }[]) {
  if (!files.length) return [];
  const data = await shopifyGraphql<{ fileCreate: { files: { id: string }[]; userErrors: UserError[] } }>(config,
    `mutation($files: [FileCreateInput!]!) { fileCreate(files: $files) { files { id } userErrors { field message } } }`,
    { files: files.map((file) => ({ ...file, duplicateResolutionMode: "APPEND_UUID" })) });
  check(data.fileCreate.userErrors, "No se pudieron crear los archivos");
  return data.fileCreate.files.map((file) => file.id);
}

// Archivos que se enlazan desde metacampos (etiqueta, PDF, vídeos de marca): se suben una sola vez. La huella del
// contenido se guarda en mhd_importer_shopify_files; si ya está, se reutiliza el archivo de Shopify.
async function uploadOnce(deps: { db: SupabaseClient; shopify: ShopifyConfig }, file: Upload & { kind: string; alt?: string; sourceUrl?: string | null }) {
  const hash = createHash("sha1").update(file.bytes).digest("hex");
  const { data: known, error } = await deps.db.from("mhd_importer_shopify_files").select("shopify_file_id").eq("hash", hash).maybeSingle();
  if (error) throw error;
  if (known) return known.shopify_file_id as string;
  const [url] = await stagedUpload(deps.shopify, [file]);
  const [id] = await createFiles(deps.shopify, [{ originalSource: url, filename: file.filename, contentType: file.resource, ...(file.alt ? { alt: file.alt } : {}) }]);
  // Con varios productos a la vez, otro puede haber subido el mismo archivo mientras tanto: vale el primero que se guardó.
  const { error: saveError } = await deps.db.from("mhd_importer_shopify_files").upsert({ hash, shopify_file_id: id, filename: file.filename, kind: file.kind, source_url: file.sourceUrl ?? null }, { onConflict: "hash", ignoreDuplicates: true });
  if (saveError) throw saveError;
  const { data: saved, error: readError } = await deps.db.from("mhd_importer_shopify_files").select("shopify_file_id").eq("hash", hash).single();
  if (readError) throw readError;
  return saved.shopify_file_id as string;
}

let locationsCache: { at: number; nodes: { id: string; name: string }[] } | null = null;
async function storeLocations(shopify: ShopifyConfig) {
  if (!locationsCache || Date.now() - locationsCache.at > 3_600_000) locationsCache = { at: Date.now(), nodes: (await shopifyGraphql<{ locations: { nodes: { id: string; name: string }[] } }>(shopify, `{ locations(first: 20) { nodes { id name } } }`)).locations.nodes };
  return locationsCache.nodes;
}

// Todos los canales de venta de la tienda (David, 2026-10-27: «activar el producto en todos los canales»). Hoy son
// «Online Store» y «Shop»; si se instala otro (Google, Meta, punto de venta), entra solo. Se leen una vez por hora.
let channelsCache: { at: number; ids: string[] } | null = null;
export async function publishToStoreChannels(shopify: ShopifyConfig, productId: string) {
  if (!channelsCache || Date.now() - channelsCache.at > 3_600_000) channelsCache = { at: Date.now(), ids: (await shopifyGraphql<{ publications: { nodes: { id: string }[] } }>(shopify, `{ publications(first: 50) { nodes { id } } }`)).publications.nodes.map((item) => item.id) };
  const data = await shopifyGraphql<{ publishablePublish: { userErrors: UserError[] } }>(shopify, `mutation($id: ID!, $input: [PublicationInput!]!) { publishablePublish(id: $id, input: $input) { userErrors { field message } } }`, { id: productId, input: channelsCache.ids.map((publicationId) => ({ publicationId })) });
  check(data.publishablePublish.userErrors, "Shopify no añadió el producto a sus canales de venta");
}

// Colocación en el árbol nuevo (docs/IMPORTADOR_PRODUCTOS_MHD.md, «Colocación al subir»): la subfamilia de MHD (o la
// nuestra si está recolocada) da la familia; en store_collections, su padre es el grupo y su apartado, el apartado. Se
// leen una vez por hora. Sin familia del árbol el producto no se sube: quedaría fuera de todas las colecciones.
let treeCache: { at: number; bySubfamily: Map<string, { apartado: string; grupo: string; familia: string }> } | null = null;
async function treePlacement(db: SupabaseClient, subfamily: string | null) {
  if (!treeCache || Date.now() - treeCache.at > 3_600_000) {
    const [{ data: map, error: mapError }, { data: collections, error: collectionsError }] = await Promise.all([
      db.from("store_mhd_subfamily_map").select("mhd_subfamily_code,collection_handle").not("collection_handle", "is", null),
      db.from("store_collections").select("handle,parent_handle,apartado_handle"),
    ]);
    if (mapError) throw mapError;
    if (collectionsError) throw collectionsError;
    const byHandle = new Map((collections as { handle: string; parent_handle: string | null; apartado_handle: string | null }[]).map((row) => [row.handle, row]));
    const bySubfamily = new Map<string, { apartado: string; grupo: string; familia: string }>();
    for (const row of map as { mhd_subfamily_code: string; collection_handle: string }[]) {
      const family = byHandle.get(row.collection_handle);
      if (family?.parent_handle && family.apartado_handle) bySubfamily.set(row.mhd_subfamily_code, { apartado: family.apartado_handle, grupo: family.parent_handle, familia: row.collection_handle });
    }
    treeCache = { at: Date.now(), bySubfamily };
  }
  return subfamily ? treeCache.bySubfamily.get(subfamily) ?? null : null;
}

// Etiquetas que se conservan al pisar un producto (David, 2026-10-27): de ellas cuelgan las colecciones Ofertas,
// Promociones y Novedades. Las demás (las de categoría del árbol viejo, SuperOferta, Descatalogado…) se quitan.
const KEEP_TAGS = new Set(["Oferta", "Promociones", "Novedad"]);

export async function createShopifyDraft(deps: { db: SupabaseClient; shopify: ShopifyConfig; icecat: IcecatConfig; trace?: Trace }, runId: string) {
  const t = deps.trace ?? noTrace;
  const { data: run, error } = await deps.db.from("mhd_importer_product_runs").select("id,status,result,shopify_product_id").eq("id", runId).single();
  if (error) throw error;
  if (run.status !== "ok" || !run.result) throw new Error("Esta prueba no tiene un producto montado.");
  const product = run.result as ProcessedProduct; const shop = product.shopify;
  if (product.contentBlocked) throw new Error("La ficha tiene afirmaciones sin respaldo en los datos (ver avisos): rehazla antes de guardarla en Shopify.");
  // Cola de revisión (2026-10-26): lo marcado «No importar» no se sube a Shopify.
  const { data: decision, error: decisionError } = await deps.db.from("mhd_importer_review_items").select("status,note").eq("codigo", product.codigo).maybeSingle();
  if (decisionError) throw decisionError;
  if (decision?.status === "no_importar") throw new Error(`Marcado «No importar» en la cola de revisión${decision.note ? `: ${decision.note}` : ""}.`);
  const { data: queued, error: queueError } = await deps.db.from("mhd_importer_review_queue").select("pending").eq("codigo", product.codigo).maybeSingle();
  if (queueError) throw queueError;
  const reviewPending = Boolean(queued?.pending);
  const placement = await t.step("Colocación en el árbol", () => treePlacement(deps.db, product.family.subfamilyCode), (result) => (result ? `${result.apartado} › ${result.grupo} › ${result.familia}` : "Sin familia del árbol"));
  if (!placement) throw new Error(`La subfamilia ${product.family.subfamilyName ?? product.family.subfamilyCode} no tiene familia en el árbol nuevo: no se sube.`);
  // ¿Ya existe en Shopify? Primero la propia prueba; si no, cualquier prueba anterior del mismo código de MHD.
  let existingId = run.shopify_product_id as string | null;
  if (!existingId) {
    const { data: previous, error: previousError } = await deps.db.from("mhd_importer_product_runs").select("shopify_product_id").eq("codigo", product.codigo).not("shopify_product_id", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (previousError) throw previousError;
    existingId = previous?.shopify_product_id ?? null;
  }
  // Si no lo creó el importador, se busca por EAN: es un producto que ya tenía la tienda y se REFRESCA (decidido
  // 2026-10-23): se pisa el contenido (título, SEO, textos, fotos, filtros y metacampos) y se conserva lo de negocio
  // (dirección, estado, precio y precio tachado, SKU, venta sin stock, existencias, disponibilidad y prioridad).
  let refresh = false;
  if (!existingId && shop.variant.barcode) {
    // En el espejo de la tienda (src/lib/shopify-mirror.ts), sin preguntar a Shopify.
    const { data: found, error: mirrorError } = await deps.db.from("shopify_variants").select("product_id").eq("barcode", shop.variant.barcode);
    if (mirrorError) throw new Error(`No se pudo leer el espejo de la tienda: ${mirrorError.message}`);
    const products = [...new Set(found.map((row) => row.product_id as string))];
    if (products.length > 1) throw new Error(`Hay más de un producto en Shopify con el EAN ${shop.variant.barcode}: revísalo a mano.`);
    if (products[0]) { existingId = products[0]; refresh = true; }
  }
  type ExistingVariant = { id: string; price: string; compareAtPrice: string | null; sku: string | null; barcode: string | null; inventoryPolicy: string };
  const existing = existingId ? (await shopifyGraphql<{ product: { id: string; handle: string; status: string; tags: string[]; variants: { nodes: ExistingVariant[] } } | null }>(deps.shopify, `query($id: ID!) { product(id: $id) { id handle status tags variants(first: 2) { nodes { id price compareAtPrice sku barcode inventoryPolicy } } } }`, { id: existingId })).product : null;
  // Un producto activo (publicado) nunca recibe lo de negocio del importador, lo haya creado él o no.
  if (existing?.status === "ACTIVE") refresh = true;
  if (refresh && existing && existing.variants.nodes.length !== 1) throw new Error("El producto que ya tiene la tienda tiene varias variantes: el refresco solo cubre productos de una variante.");
  const { data: media, error: mediaError } = await deps.db.from("mhd_importer_media").select("role,position,filename,content_type,bytes,storage_path,meta").eq("run_id", runId).order("position");
  if (mediaError) throw mediaError;

  // Ubicaciones por nombre (se leen una vez cada hora).
  const locations = await storeLocations(deps.shopify);
  // Por nombre; si no aparece, el identificador fijo de STORE_RULES.locationIds (que también debe existir).
  const locationId = (name: string) => { const found = locations.find((location) => location.name === name) ?? locations.find((location) => location.id === STORE_RULES.locationIds[name]); if (!found) throw new Error(`No existe la ubicación «${name}» en Shopify.`); return found.id; };

  // 1) a 3) a la vez (2026-10-26), cada parte con su tiempo en el registro de los procesos: fotos de la galería, en su
  // orden; etiqueta energética y PDF, como archivos para sus metacampos; vídeos (decidido 2026-10-23): el del
  // producto, en la galería después de las fotos del producto; los de marca, en `custom.videos`. Cada vídeo se sube una
  // sola vez: si su huella ya está en mhd_importer_shopify_files, se reutiliza.
  const photos = (media ?? []).filter((item) => item.role === "image").sort((a, b) => a.position - b.position);
  const label = (media ?? []).find((item) => item.role === "energy_label");
  const videos = (media ?? []).filter((item) => item.role === "video").sort((a, b) => a.position - b.position);
  const meta = (item: { meta: unknown }) => item.meta as Record<string, string>;
  const productVideos = videos.filter((item) => meta(item).kind === "producto").slice(0, 1);
  const brandVideos = videos.filter((item) => !productVideos.includes(item));
  const [photoUrls, { labelId, documentIds }, { productVideoUrls, videoIds }] = await Promise.all([
    t.step("Shopify: subir fotos", async () => stagedUpload(deps.shopify, await Promise.all(photos.map(async (item) => {
      const bytes = await mediaBytes(deps.db, item);
      // Tratadas quedan en ~0,5 MB como mucho; por si acaso, una foto de más de 20 MB no se puede subir.
      if (bytes.byteLength > SHOPIFY_MAX_FILE_BYTES) throw new Error(`La foto ${item.filename} pesa ${mb(bytes.byteLength)} y Shopify admite 20 MB como máximo.`);
      return { filename: item.filename, mimeType: item.content_type, bytes, resource: "IMAGE" as const };
    }))), (result) => `${result.length} fotos`),
    t.step("Shopify: etiqueta y documentos", async () => {
      const labelId = label ? await uploadOnce(deps, { filename: label.filename, mimeType: "image/png", bytes: await mediaBytes(deps.db, label), resource: "IMAGE", kind: "etiqueta_energetica", alt: `Etiqueta energética ${shop.title}` }) : null;
      // Un documento que no se puede subir (p. ej. de más de 20 MB) no impide subir el producto (David, 2026-10-26).
      const uploaded = await Promise.all(product.documents.map(async (document) => {
        try {
          // Icecat dice lo que pesa: si ya se sabe que no cabe, ni se descarga (un PDF de 35 MB tardaba 20-40 s).
          if (document.sizeBytes && document.sizeBytes > SHOPIFY_MAX_FILE_BYTES) {
            t.event("aviso", "Shopify: etiqueta y documentos", `${document.filename}: demasiado grande para Shopify (${mb(document.sizeBytes)} según Icecat; máximo 20 MB): no se sube.`);
            return null;
          }
          const fitted = fitDocument((await fetchIcecatDocument(deps.icecat, document.url)).bytes);
          if (fitted.note) t.event(fitted.bytes ? "decision" : "aviso", "Shopify: etiqueta y documentos", `${document.filename}: ${fitted.note}`);
          if (!fitted.bytes) return null;
          return await uploadOnce(deps, { filename: document.filename, mimeType: "application/pdf", bytes: fitted.bytes, resource: "FILE", kind: "documento", sourceUrl: document.url });
        } catch (caught) {
          t.event("aviso", "Shopify: etiqueta y documentos", `${document.filename}: no se sube (${caught instanceof Error ? caught.message : String(caught)}).`);
          return null;
        }
      }));
      const documentIds = uploaded.filter((id): id is string => Boolean(id));
      return { labelId, documentIds, skipped: uploaded.length - documentIds.length };
    }, (result) => `${result.labelId ? "etiqueta y " : ""}${result.documentIds.length} documentos${result.skipped ? ` (${result.skipped} sin subir)` : ""}`),
    t.step("Shopify: vídeos", async () => {
      const productVideoUrls = await stagedUpload(deps.shopify, await Promise.all(productVideos.map(async (item) => ({ filename: item.filename, mimeType: "video/mp4", bytes: await mediaBytes(deps.db, item), resource: "VIDEO" as const }))));
      const videoIds: string[] = [];
      for (const item of brandVideos) videoIds.push(await uploadOnce(deps, { filename: item.filename, mimeType: "video/mp4", bytes: await mediaBytes(deps.db, item), resource: "VIDEO", kind: "video_marca", alt: meta(item).description || item.filename, sourceUrl: meta(item).sourceUrl ?? null }));
      return { productVideoUrls, videoIds };
    }, (result) => `${result.productVideoUrls.length} del producto · ${result.videoIds.length} de marca`),
  ]);
  const PRODUCT_VIEWS = new Set(["frontal", "tres_cuartos", "abierto", "lateral", "trasera"]);
  const photoFiles = photos.map((item, index) => ({ originalSource: photoUrls[index], alt: String(meta(item).alt ?? shop.title), filename: item.filename, contentType: "IMAGE" }));
  const productViews = photos.findIndex((item) => !PRODUCT_VIEWS.has(meta(item).kind));
  const videoFiles = productVideos.map((item, index) => ({ originalSource: productVideoUrls[index], alt: `${shop.title}, vídeo`, filename: item.filename, contentType: "VIDEO" }));
  const galleryFiles = [...photoFiles.slice(0, productViews < 0 ? photoFiles.length : productViews), ...videoFiles, ...photoFiles.slice(productViews < 0 ? photoFiles.length : productViews)];

  // 4) Producto entero de una vez: en borrador si es nuevo; si ya existía, se actualiza (las fotos se sustituyen).
  const metafields = [
    ...shop.metafields.filter((item) => item.value !== ""),
    ...(labelId ? [{ namespace: "custom", key: "etiqueta_energetica", type: "file_reference", value: labelId }] : []),
    ...(documentIds.length ? [{ namespace: "custom", key: "documentos", type: "list.file_reference", value: JSON.stringify(documentIds) }] : []),
    ...(videoIds.length ? [{ namespace: "custom", key: "videos", type: "list.file_reference", value: JSON.stringify(videoIds) }] : []),
    // Árbol nuevo: siempre los cuatro (productSet borra los que no se envían).
    { namespace: "custom", key: "apartado", type: "single_line_text_field", value: placement.apartado },
    { namespace: "custom", key: "grupo", type: "single_line_text_field", value: placement.grupo },
    { namespace: "custom", key: "familia", type: "single_line_text_field", value: placement.familia },
    ...(product.family.subfamilyCode ? [{ namespace: "custom", key: "mhd_subfamilia", type: "single_line_text_field", value: product.family.subfamilyCode }] : []),
  ];
  const KEEP_ON_REFRESH = new Set(["custom.disponibilidad_con_stock", "custom.disponibilidad_sin_stock", "custom.prioridad"]);
  // productSet deja el producto solo con los metacampos que se le pasan: en el refresco, los que se conservan se
  // vuelven a enviar con su valor actual (comprobado 2026-10-23: omitirlos los borraba).
  const keptValues = refresh && existing ? (await shopifyGraphql<{ product: { metafields: { nodes: { namespace: string; key: string; type: string; value: string }[] } } }>(deps.shopify, `query($id: ID!) { product(id: $id) { metafields(first: 100) { nodes { namespace key type value } } } }`, { id: existing.id })).product.metafields.nodes.filter((item) => KEEP_ON_REFRESH.has(`${item.namespace}.${item.key}`)) : [];
  const finalMetafields = refresh ? [...metafields.filter((item) => !KEEP_ON_REFRESH.has(`${item.namespace}.${item.key}`)), ...keptValues] : metafields;
  const current = existing?.variants.nodes[0];
  const variant = refresh && current
    ? { id: current.id, optionValues: [{ optionName: "Title", name: "Default Title" }], price: current.price, compareAtPrice: current.compareAtPrice, sku: current.sku ?? "", barcode: current.barcode ?? shop.variant.barcode, inventoryPolicy: current.inventoryPolicy,
        inventoryItem: { tracked: true, ...(shop.variant.weightKg ? { measurement: { weight: { value: shop.variant.weightKg, unit: "KILOGRAMS" } } } : {}) } }
    : { ...(current ? { id: current.id } : {}),
        optionValues: [{ optionName: "Title", name: "Default Title" }], price: shop.variant.price, sku: shop.variant.sku, barcode: shop.variant.barcode, inventoryPolicy: shop.variant.inventoryPolicy,
        inventoryItem: { tracked: true, ...(shop.variant.weightKg ? { measurement: { weight: { value: shop.variant.weightKg, unit: "KILOGRAMS" } } } : {}) },
        inventoryQuantities: shop.inventory.map((item) => ({ locationId: locationId(item.location), name: "available", quantity: item.quantity })) };
  const tags = [...new Set([...shop.tags, ...(existing?.tags ?? []).filter((tag) => KEEP_TAGS.has(tag)), ...(reviewPending ? [REVIEW_TAG] : [])])];
  const category = SHOPIFY_CATEGORY_BY_FAMILY[placement.familia] ?? shop.category?.id ?? null;
  // Un borrador aún puede cambiar de dirección; un producto activo (o refrescado) conserva la suya.
  const handle = existing && (refresh || existing.status === "ACTIVE") ? existing.handle : shop.handle;
  const input = {
    title: shop.title, handle, status: existing?.status ?? "DRAFT", vendor: shop.vendor, productType: shop.productType ?? "", tags,
    ...(category ? { category } : {}), descriptionHtml: shop.descriptionHtml, seo: shop.seo, metafields: finalMetafields,
    files: galleryFiles,
    productOptions: [{ name: "Title", values: [{ name: "Default Title" }] }],
    variants: [variant],
  };
  const data = await t.step("Shopify: crear el producto", () => shopifyGraphql<{ productSet: { product: (Parameters<typeof mirrorProduct>[1]) | null; userErrors: UserError[] } }>(deps.shopify,
    `mutation($input: ProductSetInput!, $identifier: ProductSetIdentifiers) { productSet(input: $input, identifier: $identifier, synchronous: true) { product { ${MIRROR_PRODUCT_FIELDS} variants(first: 10) { nodes { ${MIRROR_VARIANT_FIELDS} } } } userErrors { field message } } }`, { input, identifier: existing ? { id: existing.id } : null }), (result) => (result.productSet.product ? (existing ? "actualizado" : "creado en borrador") : null));
  check(data.productSet.userErrors, existing ? "Shopify no actualizó el producto" : "Shopify no creó el producto");
  const created = data.productSet.product!;
  // Canales de venta: todos, también al pisar un producto que ya estaba (publicar en un canal en el que ya está no hace
  // nada). Sin canal no se puede previsualizar el borrador (da 404); estar en el canal no lo enseña al cliente mientras
  // siga en borrador.
  await t.step("Shopify: canales de venta", () => publishToStoreChannels(deps.shopify, created.id), () => `${channelsCache?.ids.length ?? 0} canales`);
  // Al espejo de la tienda en el momento, para que la siguiente subida o procesado ya lo vea.
  await mirrorProduct(deps.db, created);
  // Al actualizar, productSet no borra los metacampos que ya no van (p. ej. la etiqueta, el EPREL o la ficha de Icecat
  // de otro modelo): se borran aquí los que gestiona el importador y esta vez no llevan valor.
  if (existing) {
    const managed = [...shop.metafields.map((item) => `${item.namespace}.${item.key}`), "custom.etiqueta_energetica", "custom.eprel", "custom.icecat", "custom.documentos", "custom.videos"];
    const kept = new Set(finalMetafields.map((item) => `${item.namespace}.${item.key}`));
    const stale = [...new Set(managed)].filter((name) => !kept.has(name)).map((name) => { const [namespace, key] = name.split("."); return { ownerId: created.id, namespace, key }; });
    if (stale.length) {
      const removed = await shopifyGraphql<{ metafieldsDelete: { userErrors: UserError[] } }>(deps.shopify, `mutation($metafields: [MetafieldIdentifierInput!]!) { metafieldsDelete(metafields: $metafields) { userErrors { field message } } }`, { metafields: stale });
      check(removed.metafieldsDelete.userErrors, "Shopify no borró los metacampos que ya no van");
    }
  }
  const { error: saveError } = await deps.db.from("mhd_importer_product_runs").update({ shopify_product_id: created.id }).eq("id", runId);
  if (saveError) throw saveError;
  const host = deps.shopify.storeUrl.replace(/^https?:\/\//, "").replace(/\.myshopify\.com\/?$/, "");
  return { id: created.id, handle: created.handle, status: created.status, updated: Boolean(existing), refreshed: refresh, adminUrl: `https://admin.shopify.com/store/${host}/products/${created.id.split("/").pop()}`, files: { photos: photos.length, label: Boolean(labelId), documents: documentIds.length, productVideos: productVideos.length, brandVideos: videoIds.length } };
}

// Solo textos (decidido 2026-10-23): rehacer la redacción de un producto que ya está en Shopify sin tocar fotos,
// etiqueta, documentos, vídeos, filtros ni nada de negocio. Escribe título, SEO, descripción larga, descripción corta
// y la frase de Elvi (o la borra si esta vez no hay).
export async function updateShopifyTexts(deps: { db: SupabaseClient; shopify: ShopifyConfig }, runId: string) {
  const { data: run, error } = await deps.db.from("mhd_importer_product_runs").select("status,result,codigo").eq("id", runId).single();
  if (error) throw error;
  if (run.status !== "ok" || !run.result) throw new Error("Esta prueba no tiene un producto montado.");
  const product = run.result as ProcessedProduct; const shop = product.shopify;
  if (product.contentBlocked) throw new Error("La ficha tiene afirmaciones sin respaldo en los datos (ver avisos): rehazla antes de guardarla en Shopify.");
  const { data: previous } = await deps.db.from("mhd_importer_product_runs").select("shopify_product_id").eq("codigo", run.codigo).not("shopify_product_id", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const productId = previous?.shopify_product_id as string | undefined;
  if (!productId) throw new Error("Este producto todavía no está en Shopify: guárdalo entero primero.");
  const updated = await shopifyGraphql<{ productUpdate: { product: { id: string; handle: string; status: string } | null; userErrors: UserError[] } }>(deps.shopify,
    `mutation($p: ProductUpdateInput!) { productUpdate(product: $p) { product { id handle status } userErrors { field message } } }`, { p: { id: productId, title: shop.title, descriptionHtml: shop.descriptionHtml, seo: shop.seo } });
  check(updated.productUpdate.userErrors, "Shopify no actualizó los textos");
  const textFields = ["descripcion_corta", "consejo_elvi"];
  const set = shop.metafields.filter((item) => item.namespace === "custom" && textFields.includes(item.key) && item.value !== "").map((item) => ({ ownerId: productId, ...item }));
  if (set.length) check((await shopifyGraphql<{ metafieldsSet: { userErrors: UserError[] } }>(deps.shopify, `mutation($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { field message } } }`, { m: set })).metafieldsSet.userErrors, "Shopify no guardó la descripción corta o la frase de Elvi");
  const missing = textFields.filter((key) => !set.some((item) => item.key === key)).map((key) => ({ ownerId: productId, namespace: "custom", key }));
  if (missing.length) check((await shopifyGraphql<{ metafieldsDelete: { userErrors: UserError[] } }>(deps.shopify, `mutation($m: [MetafieldIdentifierInput!]!) { metafieldsDelete(metafields: $m) { userErrors { field message } } }`, { m: missing })).metafieldsDelete.userErrors, "Shopify no borró la frase de Elvi anterior");
  return { id: productId, handle: updated.productUpdate.product!.handle, status: updated.productUpdate.product!.status, textsOnly: true };
}
