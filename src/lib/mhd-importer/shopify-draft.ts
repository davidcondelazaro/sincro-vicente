// Pieza del importador: crea en Shopify, en BORRADOR, el producto que montó el procesador (una prueba guardada en
// mhd_importer_product_runs). Sube las fotos ya tratadas, la etiqueta energética en PNG y los PDF con su nombre
// normalizado y los vídeos, y lo crea todo de una vez con `productSet`: textos, SEO, colecciones (tipo, etiquetas, proveedor),
// categoría, variante, stock por ubicación y metacampos. Nunca publica. Si el producto (mismo código de MHD) ya se creó
// antes, lo ACTUALIZA en vez de crear otro, conservando su dirección y su estado. Ver docs/IMPORTADOR_PRODUCTOS_MHD.md.
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { STORE_RULES, type ProcessedProduct } from "./processor";
import { fetchIcecatDocument, type IcecatConfig } from "./sources";
import { shopifyGraphql, type ShopifyConfig } from "./store-filters";

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
  const { error: saveError } = await deps.db.from("mhd_importer_shopify_files").insert({ hash, shopify_file_id: id, filename: file.filename, kind: file.kind, source_url: file.sourceUrl ?? null });
  if (saveError) throw saveError;
  return id;
}

export async function createShopifyDraft(deps: { db: SupabaseClient; shopify: ShopifyConfig; icecat: IcecatConfig }, runId: string) {
  const { data: run, error } = await deps.db.from("mhd_importer_product_runs").select("id,status,result,shopify_product_id").eq("id", runId).single();
  if (error) throw error;
  if (run.status !== "ok" || !run.result) throw new Error("Esta prueba no tiene un producto montado.");
  const product = run.result as ProcessedProduct; const shop = product.shopify;
  if (product.contentBlocked) throw new Error("La ficha tiene afirmaciones sin respaldo en los datos (ver avisos): rehazla antes de guardarla en Shopify.");
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
    const found = (await shopifyGraphql<{ productVariants: { nodes: { product: { id: string } }[] } }>(deps.shopify, `query($q: String!) { productVariants(first: 2, query: $q) { nodes { product { id } } } }`, { q: `barcode:${shop.variant.barcode}` })).productVariants.nodes;
    if (found.length > 1) throw new Error(`Hay más de un producto en Shopify con el EAN ${shop.variant.barcode}: revísalo a mano.`);
    if (found[0]) { existingId = found[0].product.id; refresh = true; }
  }
  type ExistingVariant = { id: string; price: string; compareAtPrice: string | null; sku: string | null; barcode: string | null; inventoryPolicy: string };
  const existing = existingId ? (await shopifyGraphql<{ product: { id: string; handle: string; status: string; variants: { nodes: ExistingVariant[] } } | null }>(deps.shopify, `query($id: ID!) { product(id: $id) { id handle status variants(first: 2) { nodes { id price compareAtPrice sku barcode inventoryPolicy } } } }`, { id: existingId })).product : null;
  // Un producto activo (publicado) nunca recibe lo de negocio del importador, lo haya creado él o no.
  if (existing?.status === "ACTIVE") refresh = true;
  if (refresh && existing && existing.variants.nodes.length !== 1) throw new Error("El producto que ya tiene la tienda tiene varias variantes: el refresco solo cubre productos de una variante.");
  const { data: media, error: mediaError } = await deps.db.from("mhd_importer_media").select("role,position,filename,content_type,bytes,meta").eq("run_id", runId).order("position");
  if (mediaError) throw mediaError;
  const bytesOf = (value: unknown) => new Uint8Array(Buffer.from(String(value).replace(/^\\x/, ""), "hex"));

  // Ubicaciones por nombre.
  const locations = (await shopifyGraphql<{ locations: { nodes: { id: string; name: string }[] } }>(deps.shopify, `{ locations(first: 20) { nodes { id name } } }`)).locations.nodes;
  // Por nombre; si no aparece, el identificador fijo de STORE_RULES.locationIds (que también debe existir).
  const locationId = (name: string) => { const found = locations.find((location) => location.name === name) ?? locations.find((location) => location.id === STORE_RULES.locationIds[name]); if (!found) throw new Error(`No existe la ubicación «${name}» en Shopify.`); return found.id; };

  // 1) Fotos de la galería, en su orden.
  const photos = (media ?? []).filter((item) => item.role === "image").sort((a, b) => a.position - b.position);
  const photoUrls = await stagedUpload(deps.shopify, photos.map((item) => ({ filename: item.filename, mimeType: item.content_type, bytes: bytesOf(item.bytes), resource: "IMAGE" as const })));
  // 2) Etiqueta energética y PDF, como archivos para sus metacampos.
  const label = (media ?? []).find((item) => item.role === "energy_label");
  const pdfs = await Promise.all(product.documents.map(async (document) => ({ document, bytes: (await fetchIcecatDocument(deps.icecat, document.url)).bytes })));
  const labelId = label ? await uploadOnce(deps, { filename: label.filename, mimeType: "image/png", bytes: bytesOf(label.bytes), resource: "IMAGE", kind: "etiqueta_energetica", alt: `Etiqueta energética ${shop.title}` }) : null;
  const documentIds: string[] = [];
  for (const item of pdfs) documentIds.push(await uploadOnce(deps, { filename: item.document.filename, mimeType: "application/pdf", bytes: item.bytes, resource: "FILE", kind: "documento", sourceUrl: item.document.url }));

  // 3) Vídeos (decidido 2026-10-23): el del producto, en la galería después de las fotos del producto; los de marca,
  // en `custom.videos`. Cada vídeo se sube una sola vez: si su huella ya está en mhd_importer_shopify_files, se reutiliza.
  const videos = (media ?? []).filter((item) => item.role === "video").sort((a, b) => a.position - b.position);
  const meta = (item: { meta: unknown }) => item.meta as Record<string, string>;
  const productVideos = videos.filter((item) => meta(item).kind === "producto").slice(0, 1);
  const brandVideos = videos.filter((item) => !productVideos.includes(item));
  const productVideoUrls = await stagedUpload(deps.shopify, productVideos.map((item) => ({ filename: item.filename, mimeType: "video/mp4", bytes: bytesOf(item.bytes), resource: "VIDEO" as const })));
  const videoIds: string[] = [];
  for (const item of brandVideos) videoIds.push(await uploadOnce(deps, { filename: item.filename, mimeType: "video/mp4", bytes: bytesOf(item.bytes), resource: "VIDEO", kind: "video_marca", alt: meta(item).description || item.filename, sourceUrl: meta(item).sourceUrl ?? null }));
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
  // Un borrador aún puede cambiar de dirección; un producto activo (o refrescado) conserva la suya.
  const handle = existing && (refresh || existing.status === "ACTIVE") ? existing.handle : shop.handle;
  const input = {
    title: shop.title, handle, status: existing?.status ?? "DRAFT", vendor: shop.vendor, productType: shop.productType ?? "", tags: shop.tags,
    ...(shop.category ? { category: shop.category.id } : {}), descriptionHtml: shop.descriptionHtml, seo: shop.seo, metafields: finalMetafields,
    files: galleryFiles,
    productOptions: [{ name: "Title", values: [{ name: "Default Title" }] }],
    variants: [variant],
  };
  const data = await shopifyGraphql<{ productSet: { product: { id: string; handle: string; status: string } | null; userErrors: UserError[] } }>(deps.shopify,
    `mutation($input: ProductSetInput!, $identifier: ProductSetIdentifiers) { productSet(input: $input, identifier: $identifier, synchronous: true) { product { id handle status } userErrors { field message } } }`, { input, identifier: existing ? { id: existing.id } : null });
  check(data.productSet.userErrors, existing ? "Shopify no actualizó el producto" : "Shopify no creó el producto");
  const created = data.productSet.product!;
  // Al actualizar, productSet no borra los metacampos que ya no van (p. ej. la etiqueta, el EPREL o la ficha de Icecat
  // de otro modelo): se borran aquí los que gestiona el importador y esta vez no llevan valor.
  if (existing) {
    const managed = [...shop.metafields.map((item) => `${item.namespace}.${item.key}`), "custom.etiqueta_energetica", "custom.eprel", "custom.icecat", "custom.documentos", "custom.videos", "custom.opiniones"];
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
