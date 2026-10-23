// Pieza del importador: el procesador. Monta la ficha de un producto de MHD con el perfil de su familia y todas las
// decisiones del 2026-10-23 (docs/IMPORTADOR_PRODUCTOS_MHD.md), sin escribir en Shopify: devuelve el producto tal como
// se crearía (textos, colecciones, variante, stock, metacampos), las fotos ya tratadas y la etiqueta en PNG.
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { classifyInStore, productDistinction, type Classification } from "./classification";
import { brandAsWritten, writeContent, type ProductContent } from "./content";
import type { ListingProduct } from "./family";
import { cached } from "./cache";
import { gatherProduct, type SourcesConfig } from "./gather";
import { embeddableYoutubeVideos, icecatMetafield, summarizeIcecat, type IcecatSummary } from "./icecat";
import { checkIcecatIdentity, labelMatches, labelText } from "./identity";
import { classifyImages, imageFilenames, KIND_ALT, normalizeEnergyLabel, orderImages, pdfFirstPageToPng, prepareImages, processImage, slugify, type ClassifiedImage, type ImageKind } from "./images";
import type { FamilyProfile } from "./profile";
import { classifyVideos, prepareVideos, type VideoKind } from "./videos";
import { reviewsMetafield } from "./reviews";
import { applyProfile, discardReason, firstNumber, sourceValues, type AppliedRules } from "./rules";
import { fetchIcecatByModel, fetchIcecatDocument, fetchMhdMedia } from "./sources";
import { shopifyGraphql } from "./store-filters";

// Decisiones de David (2026-10-23), provisionales donde se indica.
export const STORE_RULES = {
  stockLocation: "Almacén MHD",                 // principal; Electrónica Vicente y Yois a 0
  zeroLocations: ["Electrónica Vicente", "Yois"],
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
  family: { code: string | null; name: string | null; subfamilyCode: string | null; subfamilyName: string | null; profileStatus: string };
  content: ProductContent; elviReview: { ok: boolean; reason: string } | null;
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
export type ProcessResult = { status: "ok"; product: ProcessedProduct; media: MediaFile[]; warnings: string[]; costUsd: number; usage: Record<string, unknown> } | { status: "discarded"; reason: string; warnings: string[] };

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
  if (listing.ref_proved && listing.nombre_marca) {
    const byModel = await cached(deps.db, "icecat", `modelo:${listing.nombre_marca}:${listing.ref_proved}`.toUpperCase(), 24 * 7, () => fetchIcecatByModel(deps.config.icecat, listing.nombre_marca!, listing.ref_proved!)).catch(() => null);
    const found = summarizeIcecat(byModel?.payload ?? null, deps.config.icecat.language);
    if (found) {
      const recheck = await checkIcecatIdentity(deps.ai, product, found);
      if (recheck.same) { warnings.push(`Icecat encontrado por marca y modelo: «${found.title}».`); return { icecat: found, costUsd: check.costUsd + recheck.costUsd, check: recheck }; }
    }
  }
  warnings.push("Icecat no tiene nuestro modelo: ficha técnica solo con MHD y sin etiqueta de Icecat.");
  return { icecat: null, costUsd: check.costUsd, check };
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
  if (!applied.metafields["features.eficiencia_energ_tica"] && listing.letra_eficiencia) {
    applied.metafields["features.eficiencia_energ_tica"] = `Nueva ${listing.letra_eficiencia.toUpperCase()}`;
    applied.origins["features.eficiencia_energ_tica"] = [{ value: applied.metafields["features.eficiencia_energ_tica"] as string, source: "mhd:letra_eficiencia" }];
  }
  if (applied.missing.length) warnings.push(`Filtros sin dato en MHD ni Icecat: ${[...new Set(applied.missing)].join(", ")}.`);

  const written = await writeContent(deps.ai, { profile, listing, detail: gathered.detail, icecat, metafields: applied.metafields, values });
  warnings.push(...written.errors.map((error) => `Validación del texto: ${error}`));
  if (written.elviReview && !written.elviReview.ok) warnings.push(`Consejo de Elvi descartado: ${written.elviReview.reason}`);
  cost += written.costUsd ?? 0; usage.content = written.usage; usage.contentAttempts = written.attempts;

  // Fotos: la IA dice qué vista es cada una; el código calcula el fondo, ordena y trata.
  const photoUrls = gathered.detail?.fotos?.length ? gathered.detail.fotos : listing.imagen ? [listing.imagen] : [];
  const prepared = await prepareImages(photoUrls);
  warnings.push(...prepared.errors);
  const classified = prepared.images.length ? await classifyImages(deps.ai, written.content.title, prepared.images, listing.imagen) : { classified: [] as ClassifiedImage[], costUsd: 0, usage: null };
  cost += classified.costUsd ?? 0; usage.images = classified.usage;
  const ordered = orderImages(classified.classified);
  if (!ordered.keep.length) return { status: "discarded", reason: "Sin imagen válida (todas descartadas al revisarlas)", warnings };
  const brand = brandAsWritten(listing, icecat);
  // Tipo para la dirección y los archivos: lo que va delante de la marca en el título («Freidora de aire»), porque en
  // familias amplias el nombre del perfil es genérico («pequeño electrodoméstico de preparación de alimentos»).
  const brandAt = written.content.title.toLowerCase().indexOf(brand.toLowerCase());
  const productType = (brandAt > 0 ? written.content.title.slice(0, brandAt).trim() : "") || profile.product.singular;
  const base = slugify(`${productType} ${brand} ${listing.ref_proved ?? listing.codigo}`);
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
  const label = await energyLabelFile(deps.config, listing, icecat, [listing.ref_proved, ...(identity.check?.same ? [icecat?.partCode ?? null, icecat?.modelName ?? null] : [])], warnings).catch((caught: Error) => { warnings.push(`Etiqueta energética: ${caught.message}`); return null; });
  const labelFilename = label ? `${slugify(`${brand} ${listing.ref_proved ?? listing.codigo}`)}-etiqueta-energetica.png` : null;
  if (label && labelFilename) media.push({ role: "energy_label", position: 0, filename: labelFilename, contentType: "image/png", width: label.width, height: label.height, bytes: label.bytes, meta: { source: label.source } });

  // Documentos: ficha UE y manual (decidido 2026-10-23), con nombre normalizado. Vídeos: YouTube en español
  // comprobados; MP4 del producto o de la marca (provisional: es «de producto» si su descripción nombra el modelo).
  const docBase = slugify(`${brand} ${listing.ref_proved ?? listing.codigo}`);
  const documents = (icecat?.documents ?? []).filter((document) => STORE_RULES.documentTypes[document.type]).map((document) => ({ type: document.type, filename: `${docBase}-${STORE_RULES.documentTypes[document.type]}.pdf`, url: document.url, sizeBytes: document.sizeBytes }));
  const youtube = await embeddableYoutubeVideos(icecat?.youtubeIds ?? []);
  const videoKinds = await classifyVideos(deps.ai, { title: written.content.title, brand, model: listing.ref_proved ?? "", series: icecat?.series ?? null }, icecat?.videos ?? []);
  cost += videoKinds.costUsd ?? 0; usage.videos = videoKinds.usage;
  const preparedVideos = await prepareVideos(deps.config.icecat, icecat?.videos ?? [], videoKinds.kinds, { productBase: base, brand });
  warnings.push(...preparedVideos.errors);
  for (const [position, video] of preparedVideos.videos.entries()) media.push({ role: "video", position, filename: video.filename, contentType: video.contentType, width: 0, height: 0, bytes: video.bytes, meta: { kind: video.kind, reason: video.reason, description: video.description, hash: video.hash, sourceUrl: video.url } });
  const mp4 = preparedVideos.videos.map((video) => ({ url: video.url, description: video.description, kind: video.kind, reason: video.reason, filename: video.filename, sizeBytes: video.sizeBytes, hash: video.hash }));

  // Colocación en las colecciones actuales (hermanas por EAN) y datos de Shopify.
  const vendor = (listing.nombre_marca ?? "").toUpperCase();
  const distinction = productDistinction(profile, values);
  const classification = await classifyInStore(deps.config.shopify, { subfamilyEans: subfamilyEans.filter((ean) => ean !== listing.codigo_ean), distinction, distinctionNames: profile.product.distinctions.map((item) => item.name), vendor });
  warnings.push(...classification.notes);
    // Sin etiqueta buena no va «Energética»: con esa etiqueta y el metacampo vacío, el tema abriría la última foto.
  const tags = [...classification.tags, ...(label ? ["Energética"] : [])];
  const { data: previousRun } = await deps.db.from("mhd_importer_product_runs").select("shopify_product_id").eq("codigo", listing.codigo).not("shopify_product_id", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const handle = await freeHandle(deps.config, base, typeof applied.metafields["filtro.color"] === "string" ? applied.metafields["filtro.color"] as string : null, previousRun?.shopify_product_id ?? null);
  const sellWithoutStock = STORE_RULES.sellOutOfStockBrands.includes(vendor) && STORE_RULES.sellOutOfStockLines.includes(listing.cod_linea ?? "");
  // Opiniones que ya tenemos de este EAN (Trusted Shops) con el resumen de Elvi, para la sección «Opiniones».
  const opinions = await reviewsMetafield(deps.db, deps.ai, listing.codigo_ean, written.content.title).catch((caught: Error) => { warnings.push(`Opiniones: ${caught.message}`); return { metafield: null, costUsd: 0 }; });
  cost += opinions.costUsd;
  const technical = icecatMetafield(icecat, gathered.detail?.caracteristicas ?? [], youtube);
  const metafields: MetafieldInput[] = [
    { namespace: "custom", key: "referencia", type: "single_line_text_field", value: listing.ref_proved ?? "" },
    { namespace: "custom", key: "prioridad", type: "number_integer", value: String(STORE_RULES.priority) },
    { namespace: "custom", key: "disponibilidad_con_stock", type: "single_line_text_field", value: STORE_RULES.availabilityInStock },
    { namespace: "custom", key: "disponibilidad_sin_stock", type: "single_line_text_field", value: STORE_RULES.availabilityOutOfStock },
    { namespace: "custom", key: "descripcion_corta", type: "multi_line_text_field", value: written.content.short_description },
    ...(listing.opciones_entrega ? [{ namespace: "custom", key: "opciones_entrega", type: "json", value: json(listing.opciones_entrega) }] : []),
    ...(icecat?.eprelId ? [{ namespace: "custom", key: "eprel", type: "single_line_text_field", value: icecat.eprelId }] : []),
    ...(technical ? [{ namespace: "custom", key: "icecat", type: "json", value: json(technical) }] : []),
    ...(opinions.metafield ? [{ namespace: "custom", key: "opiniones", type: "json", value: json(opinions.metafield) }] : []),
    ...(written.content.elvi_tip.text.trim() ? [{ namespace: "custom", key: "consejo_elvi", type: "multi_line_text_field", value: written.content.elvi_tip.text.trim() }] : []),
    ...Object.entries(applied.metafields).map(([key, value]) => { const [namespace, name] = key.split("."); return { namespace, key: name, type: LISTS.has(key) ? "list.single_line_text_field" : "single_line_text_field", value: Array.isArray(value) ? json(value) : value }; }),
  ];
  if (!icecat?.eprelId && (label || listing.letra_eficiencia)) warnings.push("Sin código EPREL en Icecat.");
  if (!label && (listing.letra_eficiencia || listing.img_ficha_eficiencia)) warnings.push("Producto con clase energética y sin etiqueta válida: se publica sin etiqueta.");

  return {
    status: "ok", warnings, costUsd: cost, usage, media,
    product: {
      codigo: listing.codigo, ean: listing.codigo_ean, model: listing.ref_proved, brand,
      family: { code: listing.cod_familia, name: listing.nombre_familia, subfamilyCode: listing.cod_subfamilia, subfamilyName: listing.nombre_subfamilia, profileStatus: profileRow.status },
      content: written.content, elviReview: written.elviReview,
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
