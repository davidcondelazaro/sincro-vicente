// Pieza del importador: el procesador. Monta la ficha de un producto de MHD con el perfil de su familia y todas las
// decisiones del 2026-10-23 (docs/IMPORTADOR_PRODUCTOS_MHD.md), sin escribir en Shopify: devuelve el producto tal como
// se crearía (textos, colecciones, variante, stock, metacampos), las fotos ya tratadas y la etiqueta en PNG.
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { classifyInStore, productDistinction, type Classification } from "./classification";
import { writeContent, type ProductContent } from "./content";
import { resolveBrand, type BrandChoice } from "./brands";
import { sourceDisagreements } from "./facts";
import { resolveModel, type ModelChoice } from "./models";
import { energyClassReason, median, priceReason } from "./review";
import type { ListingProduct } from "./family";
import { cached } from "./cache";
import { gatherProduct, type SourcesConfig } from "./gather";
import { embeddableYoutubeVideos, icecatMetafield, summarizeIcecat, type IcecatSummary } from "./icecat";
import { checkIcecatIdentity, labelMatches, labelText } from "./identity";
import { classifyImages, imageFilenames, KIND_ALT, normalizeEnergyLabel, orderImages, pdfFirstPageToPng, prepareImages, processImage, slugify, type ClassifiedImage, type ImageKind } from "./images";
import type { FamilyProfile } from "./profile";
import { classifyVideos, prepareVideos, type VideoKind } from "./videos";
import { applyProfile, discardReason, firstNumber, sourceValues, type AppliedRules } from "./rules";
import { fetchIcecatByModel, fetchIcecatDocument, fetchMhdMedia } from "./sources";
import { shopifyGraphql } from "./store-filters";

// Decisiones de David (2026-10-23), provisionales donde se indica.
export const STORE_RULES = {
  stockLocation: "Almacén MHD",                 // principal; Electrónica Vicente y Yois a 0
  zeroLocations: ["Electrónica Vicente", "Yois"],
  // Identificadores de las ubicaciones en Shopify (electronica-vicente, comprobados 2026-10-23). Se usan si el nombre
  // cambia o no aparece; si una ubicación se renombra o se crea otra, hay que actualizarlos aquí.
  locationIds: { "Electrónica Vicente": "gid://shopify/Location/114068816204", "Almacén MHD": "gid://shopify/Location/127022137676", "Yois": "gid://shopify/Location/127022104908" } as Record<string, string>,
  priority: 20,                                 // pendiente del criterio que nos den
  availabilityInStock: "Recíbelo en 3/4 días laborables",     // provisional: pendiente del plazo exacto
  availabilityOutOfStock: "Recíbelo en 4/5 días laborables",  // provisional; solo se ve si se puede comprar sin stock
  // Venta sin stock: marcas de BSH y Electrolux; alcance pendiente de confirmar (propuesta: solo gran electrodoméstico).
  sellOutOfStockBrands: ["BALAY", "BOSCH", "SIEMENS", "AEG", "ELECTROLUX", "ZANUSSI"],
  sellOutOfStockLines: ["G", "H", "I"],         // Lavado y Secado, Frío y Congelación, Cocción
  documentTypes: { "EU Product Fiche": "ficha-de-producto-ue", "manual pdf": "manual-de-usuario" } as Record<string, string>,
  minIcecatLabelHeight: 1000,
  minMainImageSide: 800,                        // por debajo, se busca otra principal grande sobre blanco
};

export type MetafieldInput = { namespace: string; key: string; type: string; value: string };
export type ProcessedImage = { position: number; filename: string; alt: string; kind: ImageKind; background: string; width: number; height: number; treatment: string; description: string; sourceUrl: string; isMhdMain: boolean };
export type ProcessedProduct = {
  codigo: string; ean: string | null; model: string | null; brand: string;
  modelChoice: ModelChoice; brandChoice: BrandChoice;
  review_reasons: string[];        // cola de revisión a mano (review.ts); el producto se procesa igual
  family: { code: string | null; name: string | null; subfamilyCode: string | null; subfamilyName: string | null; profileStatus: string };
  content: ProductContent; elviReview: { ok: boolean; reason: string } | null;
  contentBlocked: boolean;         // el revisor de datos encontró afirmaciones sin respaldo: no se guarda en Shopify
  shopify: {
    title: string; handle: string; status: "DRAFT"; vendor: string; productType: string | null; tags: string[]; category: Classification["category"];
    descriptionHtml: string; seo: { title: string; description: string };
    variant: { sku: string; barcode: string | null; price: string; compareAtPrice: null; inventoryPolicy: "CONTINUE" | "DENY"; weightKg: number | null; tracked: true };
    inventory: { location: string; quantity: number }[]; metafields: MetafieldInput[]; publications: string[];
  };
  classification: Classification;
  filters: AppliedRules["metafields"]; origins: AppliedRules["origins"]; missingFilters: string[];
  images: ProcessedImage[]; droppedImages: { url: string; width: number; height: number; kind: ImageKind; description: string; reason: string }[];
  energyLabel: { letter: string | null; source: string | null; filename: string | null; width: number | null; height: number | null; eprel: string | null };
  documents: { type: string; filename: string; url: string; sizeBytes: number | null }[];
  videos: { youtube: Record<string, string>[]; mp4: { url: string; description: string; kind: VideoKind; reason: string; filename: string; sizeBytes: number; hash: string }[] };
  price: { pvp: number | null; ignored: { pvpBefore: number | null; cost: number | null }; vat: number | null; stock: number | null };
  sources: { mhdDetail: boolean; icecat: boolean; icecatTitle: string | null; technicalSheet: string | null };
};
export type MediaFile = { role: "image" | "energy_label" | "video"; position: number; filename: string; contentType: string; width: number; height: number; bytes: Uint8Array; meta: Record<string, unknown> };
export type ProcessResult = { status: "ok"; product: ProcessedProduct; media: MediaFile[]; warnings: string[]; review_reasons: string[]; costUsd: number; usage: Record<string, unknown> } | { status: "discarded"; reason: string; warnings: string[] };

type Listing = ListingProduct & { cod_familia: string | null; nombre_familia: string | null; cod_linea: string | null; descripcion: string | null; pvp_antes: number | null; iva: number | null; triple_neto?: number | null; img_eficiencia: string | null; opciones_entrega: Record<string, unknown> | null };

const json = (value: unknown) => JSON.stringify(value);
const LISTS = new Set(["filtro.conectividad", "filtro.caracteristicas", "filtro.mas_especificaciones"]);

function weightKg(values: Map<string, string>) {
  for (const key of ["mhd:peso", "icecat:peso y dimensiones|peso"]) {
    const raw = values.get(key); const n = raw ? firstNumber(raw) : null;
    if (raw && n) return /\bg\b/i.test(raw) && !/kg/i.test(raw) ? n / 1000 : n;
  }
  return null;
}

// Dirección de la ficha (decidido 2026-10-23): tipo + marca + modelo; si existe, color, y en último caso -2, -3…
// Una dirección que ya tiene este mismo producto (creado antes desde el importador) cuenta como libre.
async function freeHandle(config: SourcesConfig, base: string, color: string | null, ownId: string | null) {
  const exists = async (handle: string) => { const found = (await shopifyGraphql<{ productByIdentifier: { id: string } | null }>(config.shopify, `query($h: String!) { productByIdentifier(identifier: { handle: $h }) { id } }`, { h: handle })).productByIdentifier; return Boolean(found && found.id !== ownId); };
  const candidates = [base, ...(color ? [`${base}-${slugify(color)}`] : [])];
  for (const handle of candidates) if (!(await exists(handle))) return handle;
  for (let n = 2; n < 20; n += 1) if (!(await exists(`${base}-${n}`))) return `${base}-${n}`;
  throw new Error(`No hay dirección libre para ${base}.`);
}

// Etiqueta energética (decidido 2026-10-23): SVG de MHD → PDF de Icecat → imagen de Icecat con tamaño suficiente.
// Cada candidata se lee y se descarta si lleva otro modelo (el SVG de MHD sale de Icecat por EAN y puede venir mal).
// La imagen no se puede leer: solo se usa si Icecat está comprobado como nuestro modelo.
async function energyLabelFile(config: SourcesConfig, listing: Listing, icecat: IcecatSummary | null, models: (string | null)[], warnings: string[]) {
  if (listing.img_ficha_eficiencia) {
    const media = await fetchMhdMedia(listing.img_ficha_eficiencia);
    const isSvg = media.contentType.includes("svg") || listing.img_ficha_eficiencia.endsWith(".svg");
    const matches = labelMatches(await labelText(media.bytes, isSvg ? "svg" : "image"), models);
    if (matches === false) warnings.push("La etiqueta de MHD es de otro modelo: no se usa.");
    else return { ...(await normalizeEnergyLabel(media.bytes, isSvg)), source: "MHD (SVG oficial de EPREL)" };
  }
  if (icecat?.energyLabel) {
    const media = await fetchIcecatDocument(config.icecat, icecat.energyLabel.url);
    if (icecat.energyLabel.contentType === "application/pdf" || media.contentType.includes("pdf")) {
      if (labelMatches(await labelText(media.bytes, "pdf"), models) === false) { warnings.push("La etiqueta de Icecat es de otro modelo: no se usa."); return null; }
      return { ...(await normalizeEnergyLabel(await pdfFirstPageToPng(media.bytes), false)), source: "Icecat (PDF)" };
    }
    const meta = await sharp(media.bytes).metadata();
    if ((meta.height ?? 0) < STORE_RULES.minIcecatLabelHeight) { warnings.push(`Etiqueta de baja calidad en Icecat (${meta.width}×${meta.height}): no se usa.`); return null; }
    return { ...(await normalizeEnergyLabel(media.bytes, false)), source: "Icecat (imagen)" };
  }
  return null;
}

// Icecat de nuestro modelo (identity.ts). Si el EAN lleva a otro producto, se busca por marca y modelo; si tampoco,
// el producto sigue sin Icecat (ni ficha técnica, ni etiqueta, ni ficha UE, ni EPREL) y va al informe.
async function verifiedIcecat(deps: { db: SupabaseClient; config: SourcesConfig; ai: Anthropic }, listing: Listing, icecat: IcecatSummary | null, warnings: string[]) {
  if (!icecat) return { icecat: null, costUsd: 0, check: null };
  const product = { title: listing.titulo ?? "", brand: listing.nombre_marca ?? "", ref: listing.ref_proved };
  const check = await checkIcecatIdentity(deps.ai, product, icecat);
  if (check.same) return { icecat, costUsd: check.costUsd, check };
  warnings.push(`Icecat de otro modelo: el EAN lleva a «${icecat.title ?? icecat.modelName}» (${check.reason}). No se usa nada de esa ficha.`);
  // Se busca con el modelo de MHD limpio («BCS200BK BLACK» → «BCS200BK»); si no sirve (código interno…), con el de MHD.
  const mhdModel = resolveModel(listing, null); const ref = !mhdModel.needsReview && mhdModel.model ? mhdModel.model : listing.ref_proved;
  if (ref && listing.nombre_marca) {
    const byModel = await cached(deps.db, "icecat", `modelo:${listing.nombre_marca}:${ref}`.toUpperCase(), 24 * 7, () => fetchIcecatByModel(deps.config.icecat, listing.nombre_marca!, ref)).catch(() => null);
    const found = summarizeIcecat(byModel?.payload ?? null, deps.config.icecat.language);
    if (found) {
      const recheck = await checkIcecatIdentity(deps.ai, product, found);
      if (recheck.same) { warnings.push(`Icecat encontrado por marca y modelo: «${found.title}».`); return { icecat: found, costUsd: check.costUsd + recheck.costUsd, check: recheck }; }
    }
  }
  warnings.push("Icecat no tiene nuestro modelo: ficha técnica solo con MHD y sin etiqueta de Icecat.");
  return { icecat: null, costUsd: check.costUsd, check };
}

// Mediana del PVP de la subfamilia (sin el propio producto) para la revisión de precios. Se lee el listado de la familia
// con la función del importador (las tablas mhd_catalog_* solo las lee service_role) y se guarda 10 minutos en memoria,
// así un lote de la misma familia la calcula una sola vez.
const familyPrices = new Map<string, { at: number; rows: Promise<{ codigo: string; cod_subfamilia: string | null; pvp: number | null }[]> }>();
async function subfamilyPrices(db: SupabaseClient, listing: Listing) {
  if (!listing.cod_familia || !listing.cod_subfamilia) return null;
  let entry = familyPrices.get(listing.cod_familia);
  if (!entry || Date.now() - entry.at > 10 * 60_000) {
    const rows = Promise.resolve(db.rpc("mhd_importer_family_listing", { p_family_code: listing.cod_familia })).then(({ data, error }) => { if (error) throw new Error(error.message); return (data ?? []) as { codigo: string; cod_subfamilia: string | null; pvp: number | null }[]; });
    entry = { at: Date.now(), rows }; familyPrices.set(listing.cod_familia, entry);
    rows.catch(() => familyPrices.delete(listing.cod_familia!));
  }
  const others = (await entry.rows).filter((row) => row.cod_subfamilia === listing.cod_subfamilia && row.codigo !== listing.codigo && Number(row.pvp) > 0).map((row) => Number(row.pvp));
  return { median: median(others), count: others.length };
}

export async function processProduct(deps: { db: SupabaseClient; config: SourcesConfig; ai: Anthropic }, listing: Listing, profileRow: { profile: FamilyProfile | null; status: string } | null, subfamilyEans: string[]): Promise<ProcessResult> {
  const warnings: string[] = []; let cost = 0; const usage: Record<string, unknown> = {};
  const gathered = await gatherProduct(deps.db, deps.config, listing);
  warnings.push(...gathered.errors);
  const identity = await verifiedIcecat(deps, listing, gathered.icecat, warnings);
  cost += identity.costUsd;
  const reason = discardReason(listing, gathered.detail, identity.icecat);
  if (reason) return { status: "discarded", reason, warnings };
  if (!profileRow?.profile) throw new Error(`La familia ${listing.nombre_familia ?? listing.cod_familia} todavía no tiene perfil: analízala primero.`);
  if (profileRow.status !== "reviewed") warnings.push("El perfil de la familia aún no está revisado.");
  const profile = profileRow.profile; const icecat = identity.icecat;

  // Filtros por reglas (sin IA). La letra energética del listado de MHD completa la eficiencia si el perfil no la sacó.
  const values = sourceValues(gathered.detail, icecat, listing);
  const applied = applyProfile(profile, values, listing.cod_subfamilia);
  // Solo si la tabla de eficiencia del perfil usa la escala nueva («Nueva A»…); en hornos, campanas, cocinas o termos
  // (escala antigua, A+++…) no se pone (decidido 2026-10-26).
  const efficiencyRules = profile.filters.filter((rule) => rule.metafield === "features.eficiencia_energ_tica" && (!rule.subfamilies?.length || Boolean(listing.cod_subfamilia && rule.subfamilies.includes(listing.cod_subfamilia))));
  const newScale = efficiencyRules.some((rule) => [...rule.table, ...rule.ranges].some((item) => /^nueva\s/i.test(item.value.trim())));
  if (!applied.metafields["features.eficiencia_energ_tica"] && listing.letra_eficiencia && newScale && /^[A-G]$/i.test(listing.letra_eficiencia.trim())) {
    applied.metafields["features.eficiencia_energ_tica"] = `Nueva ${listing.letra_eficiencia.trim().toUpperCase()}`;
    applied.origins["features.eficiencia_energ_tica"] = [{ value: applied.metafields["features.eficiencia_energ_tica"] as string, source: "mhd:letra_eficiencia" }];
  }
  if (applied.missing.length) warnings.push(`Filtros sin dato en MHD ni Icecat: ${[...new Set(applied.missing)].join(", ")}.`);

  // Modelo limpio (models.ts) y marca (brands.ts): para el título, la dirección, la referencia y los nombres de archivo.
  const modelChoice = resolveModel(listing, icecat); const brandChoice = resolveBrand(listing, icecat);
  const model = modelChoice.model ?? listing.ref_proved ?? listing.codigo;
  // Lo que va a revisión sale después como «Revisión: …»; aquí, solo los cambios que no necesitan revisión.
  if (modelChoice.source === "icecat" && !modelChoice.needsReview) warnings.push(`Modelo: ${modelChoice.reason}`);
  if (brandChoice.reason && !brandChoice.needsReview) warnings.push(`Marca: ${brandChoice.reason}`);

  // Fotos antes de redactar (2026-10-26): sin ninguna descargable no se gasta la redacción. La foto principal del listado
  // de MHD (`img/<EAN>_…`) no existe en su servidor en buena parte del catálogo (S3 contesta 403, no es un bloqueo por IP);
  // las de la ficha (`img/analyzed/mhd/…`) sí. Si MHD no da ninguna, se usan las de Icecat comprobado.
  const photoUrls = gathered.detail?.fotos?.length ? gathered.detail.fotos : listing.imagen ? [listing.imagen] : [];
  let prepared = await prepareImages(photoUrls);
  warnings.push(...prepared.errors.map((error) => error.replace(/\(HTTP 403\)/, "(HTTP 403: MHD no tiene esa foto en su servidor)")));
  if (!prepared.images.length && icecat?.gallery?.length) {
    const fromIcecat = await prepareImages(icecat.gallery.map((picture) => picture.url).filter(Boolean));
    warnings.push(...fromIcecat.errors);
    if (fromIcecat.images.length) warnings.push(`Fotos de Icecat (${fromIcecat.images.length}): MHD no tiene ninguna descargable.`);
    prepared = fromIcecat;
  }
  if (!prepared.images.length) return { status: "discarded", reason: "Sin imagen descargable (ni en MHD ni en Icecat)", warnings };

  const written = await writeContent(deps.ai, { profile, listing, detail: gathered.detail, icecat, metafields: applied.metafields, values, model });
  warnings.push(...written.errors.map((error) => `Validación del texto: ${error}`));
  if (written.elviReview && !written.elviReview.ok) warnings.push(`Frase de Elvi descartada: ${written.elviReview.reason}`);
  if (written.blocked) warnings.push("Ficha bloqueada: el revisor de datos encontró afirmaciones sin respaldo. Hay que rehacerla o revisarla antes de guardarla en Shopify.");
  cost += written.costUsd ?? 0; usage.content = written.usage; usage.contentAttempts = written.attempts; usage.contentErrors = written.attemptErrors;

  // Fotos: la IA dice qué vista es cada una; el código calcula el fondo, ordena y trata.
  const classified = prepared.images.length ? await classifyImages(deps.ai, written.content.title, prepared.images, listing.imagen) : { classified: [] as ClassifiedImage[], costUsd: 0, usage: null };
  cost += classified.costUsd ?? 0; usage.images = classified.usage;
  let ordered = orderImages(classified.classified);
  // Si todas las de MHD se descartan al revisarlas (fondo negro, pequeñas…), se prueban las de Icecat comprobado.
  if (!ordered.keep.length && icecat?.gallery?.length && !prepared.images.some((image) => icecat.gallery.some((picture) => picture.url === image.url))) {
    const fromIcecat = await prepareImages(icecat.gallery.map((picture) => picture.url).filter(Boolean));
    if (fromIcecat.images.length) {
      const again = await classifyImages(deps.ai, written.content.title, fromIcecat.images, null);
      cost += again.costUsd ?? 0;
      prepared = { images: [...prepared.images, ...fromIcecat.images], errors: prepared.errors };
      ordered = orderImages(again.classified);
      if (ordered.keep.length) warnings.push(`Fotos de Icecat (${ordered.keep.length}): las de MHD no pasaron la revisión.`);
    }
  }
  if (!ordered.keep.length) return { status: "discarded", reason: "Sin imagen válida (todas descartadas al revisarlas)", warnings };
  const brand = brandChoice.brand;
  // Tipo para la dirección y los archivos: lo que va delante de la marca en el título («Freidora de aire»), porque en
  // familias amplias el nombre del perfil es genérico («pequeño electrodoméstico de preparación de alimentos»).
  const brandAt = written.content.title.toLowerCase().indexOf(brand.toLowerCase());
  const productType = (brandAt > 0 ? written.content.title.slice(0, brandAt).trim() : "") || profile.product.singular;
  const base = slugify(`${productType} ${brand} ${model}`);
  const treated = await Promise.all(ordered.keep.map(async (image) => ({ image, file: await processImage(prepared.images.find((item) => item.url === image.url)!.bytes, image) })));
  // Si la principal de MHD queda pequeña tras tratarla (< 800 px), pasa a principal la frontal o tres cuartos sobre
  // blanco más grande, si la hay (decidido 2026-10-23).
  const side = (entry: (typeof treated)[number]) => Math.max(entry.file.width, entry.file.height); // el lado largo: un combi es estrecho por naturaleza
  if (treated[0] && side(treated[0]) < STORE_RULES.minMainImageSide) {
    const better = treated.filter((entry) => (entry.image.kind === "frontal" || entry.image.kind === "tres_cuartos") && entry.image.background === "blanco" && side(entry) >= STORE_RULES.minMainImageSide).sort((a, b) => side(b) - side(a))[0];
    if (better) { treated.splice(treated.indexOf(better), 1); treated.unshift(better); }
    else warnings.push(`La foto principal queda pequeña (${treated[0].file.width}×${treated[0].file.height}) y no hay otra frontal o tres cuartos grande sobre blanco.`);
  }
  const filenames = imageFilenames(base, treated.map((entry) => entry.image.kind));
  const media: MediaFile[] = []; const images: ProcessedImage[] = [];
  for (const [position, { image, file }] of treated.entries()) {
    const alt = position === 0 ? written.content.title : `${written.content.title}, ${KIND_ALT[image.kind]}`;
    media.push({ role: "image", position, filename: filenames[position], contentType: file.contentType, width: file.width, height: file.height, bytes: file.bytes, meta: { alt, kind: image.kind } });
    images.push({ position, filename: filenames[position], alt, kind: image.kind, background: image.background, width: file.width, height: file.height, treatment: file.treatment, description: image.description, sourceUrl: image.url, isMhdMain: image.isMhdMain });
  }

  // Etiqueta energética como PNG en su metacampo, fuera de la galería.
  const label = await energyLabelFile(deps.config, listing, icecat, [listing.ref_proved, ...(model !== listing.ref_proved ? [model] : []), ...(identity.check?.same ? [icecat?.partCode ?? null, icecat?.modelName ?? null] : [])], warnings).catch((caught: Error) => { warnings.push(`Etiqueta energética: ${caught.message}`); return null; });
  const labelFilename = label ? `${slugify(`${brand} ${model}`)}-etiqueta-energetica.png` : null;
  if (label && labelFilename) media.push({ role: "energy_label", position: 0, filename: labelFilename, contentType: "image/png", width: label.width, height: label.height, bytes: label.bytes, meta: { source: label.source } });

  // Documentos: ficha UE y manual (decidido 2026-10-23), con nombre normalizado. Vídeos: YouTube en español
  // comprobados; MP4 del producto o de la marca (provisional: es «de producto» si su descripción nombra el modelo).
  const docBase = slugify(`${brand} ${model}`);
  const documents = (icecat?.documents ?? []).filter((document) => STORE_RULES.documentTypes[document.type]).map((document) => ({ type: document.type, filename: `${docBase}-${STORE_RULES.documentTypes[document.type]}.pdf`, url: document.url, sizeBytes: document.sizeBytes }));
  const youtube = await embeddableYoutubeVideos(icecat?.youtubeIds ?? []);
  const videoKinds = await classifyVideos(deps.ai, { title: written.content.title, brand, model, series: icecat?.series ?? null }, icecat?.videos ?? []);
  cost += videoKinds.costUsd ?? 0; usage.videos = videoKinds.usage;
  const preparedVideos = await prepareVideos(deps.config.icecat, icecat?.videos ?? [], videoKinds.kinds, { productBase: base, brand });
  warnings.push(...preparedVideos.errors);
  for (const [position, video] of preparedVideos.videos.entries()) media.push({ role: "video", position, filename: video.filename, contentType: video.contentType, width: 0, height: 0, bytes: video.bytes, meta: { kind: video.kind, reason: video.reason, description: video.description, hash: video.hash, sourceUrl: video.url } });
  const mp4 = preparedVideos.videos.map((video) => ({ url: video.url, description: video.description, kind: video.kind, reason: video.reason, filename: video.filename, sizeBytes: video.sizeBytes, hash: video.hash }));

  // Colocación en las colecciones actuales (hermanas por EAN) y datos de Shopify.
  const vendor = brandChoice.vendor;
  const distinction = productDistinction(profile, values);
  const classification = await classifyInStore(deps.config.shopify, { subfamilyEans: subfamilyEans.filter((ean) => ean !== listing.codigo_ean), distinction, distinctionNames: profile.product.distinctions.map((item) => item.name), vendor });
  warnings.push(...classification.notes);
    // Sin etiqueta buena no va «Energética»: con esa etiqueta y el metacampo vacío, el tema abriría la última foto.
  const tags = [...classification.tags, ...(label ? ["Energética"] : [])];
  const { data: previousRun } = await deps.db.from("mhd_importer_product_runs").select("shopify_product_id").eq("codigo", listing.codigo).not("shopify_product_id", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const handle = await freeHandle(deps.config, base, typeof applied.metafields["filtro.color"] === "string" ? applied.metafields["filtro.color"] as string : null, previousRun?.shopify_product_id ?? null);
  const sellWithoutStock = STORE_RULES.sellOutOfStockBrands.includes(vendor) && STORE_RULES.sellOutOfStockLines.includes(listing.cod_linea ?? "");
  // Opiniones que ya tenemos de este EAN (Trusted Shops) con el resumen de Elvi, para la sección «Opiniones».
  const technical = icecatMetafield(icecat, gathered.detail?.caracteristicas ?? [], youtube);
  const metafields: MetafieldInput[] = [
    { namespace: "custom", key: "referencia", type: "single_line_text_field", value: model },
    { namespace: "custom", key: "prioridad", type: "number_integer", value: String(STORE_RULES.priority) },
    { namespace: "custom", key: "disponibilidad_con_stock", type: "single_line_text_field", value: STORE_RULES.availabilityInStock },
    { namespace: "custom", key: "disponibilidad_sin_stock", type: "single_line_text_field", value: STORE_RULES.availabilityOutOfStock },
    { namespace: "custom", key: "descripcion_corta", type: "multi_line_text_field", value: written.content.short_description },
    ...(listing.opciones_entrega ? [{ namespace: "custom", key: "opciones_entrega", type: "json", value: json(listing.opciones_entrega) }] : []),
    ...(icecat?.eprelId ? [{ namespace: "custom", key: "eprel", type: "single_line_text_field", value: icecat.eprelId }] : []),
    ...(technical ? [{ namespace: "custom", key: "icecat", type: "json", value: json(technical) }] : []),
    ...(written.content.elvi_tip.text.trim() ? [{ namespace: "custom", key: "consejo_elvi", type: "multi_line_text_field", value: written.content.elvi_tip.text.trim() }] : []),
    ...Object.entries(applied.metafields).map(([key, value]) => { const [namespace, name] = key.split("."); return { namespace, key: name, type: LISTS.has(key) ? "list.single_line_text_field" : "single_line_text_field", value: Array.isArray(value) ? json(value) : value }; }),
  ];
  if (!icecat?.eprelId && (label || listing.letra_eficiencia)) warnings.push("Sin código EPREL en Icecat.");
  if (!label && (listing.letra_eficiencia || listing.img_ficha_eficiencia)) warnings.push("Producto con clase energética y sin etiqueta válida: se publica sin etiqueta.");

  // Cola de revisión (regla de David del 2026-10-24): el producto se monta igual, pero alguien tiene que mirarlo.
  const prices = await subfamilyPrices(deps.db, listing).catch((caught: Error) => { warnings.push(`Mediana de precios: ${caught.message}`); return null; });
  const review_reasons = [
    energyClassReason(listing.letra_eficiencia, icecat),
    ...sourceDisagreements(profile, values, listing.cod_subfamilia).map((item) => `${item.name}: MHD dice «${item.mhd}» e Icecat «${item.icecat}» (${Math.round(item.difference * 100)} % de diferencia).`),
    priceReason(listing.pvp, prices?.median ?? null, prices?.count ?? 0),
    modelChoice.needsReview ? `Modelo: ${modelChoice.reason}` : null,
    brandChoice.needsReview ? `Marca: ${brandChoice.reason}` : null,
  ].filter((reason): reason is string => Boolean(reason));
  warnings.push(...review_reasons.map((reason) => `Revisión: ${reason}`));

  return {
    status: "ok", warnings, review_reasons, costUsd: cost, usage, media,
    product: {
      codigo: listing.codigo, ean: listing.codigo_ean, model, brand, modelChoice, brandChoice, review_reasons,
      family: { code: listing.cod_familia, name: listing.nombre_familia, subfamilyCode: listing.cod_subfamilia, subfamilyName: listing.nombre_subfamilia, profileStatus: profileRow.status },
      content: written.content, elviReview: written.elviReview, contentBlocked: written.blocked,
      shopify: {
        title: written.content.title, handle, status: "DRAFT", vendor, productType: classification.productType, tags, category: classification.category,
        descriptionHtml: written.content.long_description_html, seo: { title: written.content.meta_title, description: written.content.meta_description },
        variant: { sku: listing.codigo, barcode: listing.codigo_ean, price: Number(listing.pvp ?? 0).toFixed(2), compareAtPrice: null, inventoryPolicy: sellWithoutStock ? "CONTINUE" : "DENY", weightKg: weightKg(values), tracked: true },
        inventory: [{ location: STORE_RULES.stockLocation, quantity: Math.max(0, Math.trunc(Number(listing.stock ?? 0))) }, ...STORE_RULES.zeroLocations.map((location) => ({ location, quantity: 0 }))],
        metafields, publications: ["Tienda online", "Shop"],
      },
      classification, filters: applied.metafields, origins: applied.origins, missingFilters: applied.missing,
      images, droppedImages: ordered.dropped.map((image) => ({ url: image.url, width: image.width, height: image.height, kind: image.kind, description: image.description, reason: image.reason })),
      energyLabel: { letter: listing.letra_eficiencia?.toUpperCase() ?? null, source: label?.source ?? null, filename: labelFilename, width: label?.width ?? null, height: label?.height ?? null, eprel: icecat?.eprelId ?? null },
      documents, videos: { youtube, mp4 },
      price: { pvp: listing.pvp, ignored: { pvpBefore: listing.pvp_antes, cost: listing.triple_neto ?? null }, vat: listing.iva, stock: listing.stock },
      sources: { mhdDetail: Boolean(gathered.detail), icecat: Boolean(icecat), icecatTitle: icecat?.title ?? null, technicalSheet: technical?._source ?? null },
    },
  };
}
