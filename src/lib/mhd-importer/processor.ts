// Pieza del importador: el procesador. Monta la ficha de un producto de MHD con el perfil de su familia, sin escribir
// en Shopify: devuelve todo lo que se subiría (textos, filtros, fotos en orden, etiqueta, documentos) y los avisos.
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { writeContent, type ProductContent } from "./content";
import type { ListingProduct } from "./family";
import { gatherProduct, type SourcesConfig } from "./gather";
import type { IcecatDocument } from "./icecat";
import { classifyImages, orderImages, prepareImages, slugify, type ClassifiedImage } from "./images";
import type { FamilyProfile } from "./profile";
import { applyProfile, discardReason, sourceValues, type AppliedRules } from "./rules";

export type ProcessedImage = Pick<ClassifiedImage, "url" | "width" | "height" | "kind" | "background" | "quality" | "description"> & { filename: string; alt: string };
export type ProcessedProduct = {
  codigo: string; ean: string | null; model: string | null; brand: string | null; vendor: string;
  family: { code: string | null; name: string | null; subfamilyCode: string | null; subfamilyName: string | null; profileStatus: string };
  content: ProductContent;
  metafields: AppliedRules["metafields"]; origins: AppliedRules["origins"]; missingFilters: string[];
  images: ProcessedImage[]; droppedImages: (Pick<ClassifiedImage, "url" | "width" | "height" | "kind" | "description"> & { reason: string })[];
  energyLabel: { letter: string | null; svgUrl: string | null; iconUrl: string | null };
  documents: (IcecatDocument & { filename: string })[]; youtubeIds: string[];
  price: { pvp: number | null; pvpBefore: number | null; cost: number | null; vat: number | null; stock: number | null };
  sources: { mhdDetail: boolean; icecat: boolean; icecatTitle: string | null };
};
export type ProcessResult = { status: "ok"; product: ProcessedProduct; warnings: string[]; costUsd: number; usage: Record<string, unknown> } | { status: "discarded"; reason: string; warnings: string[] };

type Listing = ListingProduct & { cod_familia: string | null; nombre_familia: string | null; descripcion: string | null; pvp_antes: number | null; iva: number | null; triple_neto?: number | null; img_eficiencia: string | null };

const DOCUMENT_NAMES: Record<string, string> = { leaflet: "folleto", "manual pdf": "manual-de-usuario", "EU Product Fiche": "ficha-de-producto-ue", "EU Energy Label": "etiqueta-energetica-ue" };

export async function processProduct(deps: { db: SupabaseClient; config: SourcesConfig; ai: Anthropic }, listing: Listing, profileRow: { profile: FamilyProfile | null; status: string } | null): Promise<ProcessResult> {
  const warnings: string[] = [];
  const gathered = await gatherProduct(deps.db, deps.config, listing);
  warnings.push(...gathered.errors);
  const reason = discardReason(listing, gathered.detail, gathered.icecat);
  if (reason) return { status: "discarded", reason, warnings };
  if (!profileRow?.profile) throw new Error(`La familia ${listing.nombre_familia ?? listing.cod_familia} todavía no tiene perfil: analízala primero.`);
  if (profileRow.status !== "reviewed") warnings.push("El perfil de la familia aún no está revisado.");
  const profile = profileRow.profile;

  // Filtros por reglas (sin IA). La letra energética del listado de MHD completa la eficiencia si el perfil no la sacó.
  const applied = applyProfile(profile, sourceValues(gathered.detail, gathered.icecat, listing));
  if (!applied.metafields["features.eficiencia_energ_tica"] && listing.letra_eficiencia) {
    applied.metafields["features.eficiencia_energ_tica"] = `Nueva ${listing.letra_eficiencia.toUpperCase()}`;
    applied.origins["features.eficiencia_energ_tica"] = [{ value: applied.metafields["features.eficiencia_energ_tica"] as string, source: "mhd:letra_eficiencia" }];
  }
  if (applied.missing.length) warnings.push(`Filtros sin dato en MHD ni Icecat: ${[...new Set(applied.missing)].join(", ")}.`);

  const written = await writeContent(deps.ai, { profile, listing, detail: gathered.detail, icecat: gathered.icecat, metafields: applied.metafields });
  warnings.push(...written.errors.map((error) => `Validación del texto: ${error}`));

  const photoUrls = gathered.detail?.fotos?.length ? gathered.detail.fotos : listing.imagen ? [listing.imagen] : [];
  const prepared = await prepareImages(photoUrls);
  warnings.push(...prepared.errors);
  const classified = prepared.images.length ? await classifyImages(deps.ai, written.content.title, prepared.images) : { classified: [], costUsd: 0, usage: null };
  const ordered = orderImages(classified.classified);
  const base = slugify(`${listing.nombre_marca ?? ""} ${listing.ref_proved ?? listing.codigo} ${profile.product.singular}`);
  const images: ProcessedImage[] = ordered.keep.map((image, index) => ({ url: image.url, width: image.width, height: image.height, kind: image.kind, background: image.background, quality: image.quality, description: image.description, filename: `${base}-${index + 1}.${image.contentType.includes("png") ? "png" : image.contentType.includes("webp") ? "webp" : "jpg"}`, alt: index === 0 ? written.content.title : `${written.content.title}: ${image.description}` }));
  if (!images.length) return { status: "discarded", reason: "Sin imagen válida (todas descartadas al revisarlas)", warnings };

  const docBase = slugify(`${listing.nombre_marca ?? ""} ${listing.ref_proved ?? listing.codigo}`);
  const documents = (gathered.icecat?.documents ?? []).map((document) => ({ ...document, filename: `${docBase}-${DOCUMENT_NAMES[document.type] ?? slugify(document.description || document.type)}.pdf` }));
  const totalCost = (written.costUsd ?? 0) + (classified.costUsd ?? 0);
  return {
    status: "ok", warnings, costUsd: totalCost, usage: { content: written.usage, contentAttempts: written.attempts, images: classified.usage },
    product: {
      codigo: listing.codigo, ean: listing.codigo_ean, model: listing.ref_proved, brand: gathered.icecat?.brand ?? listing.nombre_marca,
      // Las colecciones de marca actuales filtran por proveedor en mayúsculas (BOSCH, LG…).
      vendor: (listing.nombre_marca ?? "").toUpperCase(),
      family: { code: listing.cod_familia, name: listing.nombre_familia, subfamilyCode: listing.cod_subfamilia, subfamilyName: listing.nombre_subfamilia, profileStatus: profileRow.status },
      content: written.content, metafields: applied.metafields, origins: applied.origins, missingFilters: applied.missing,
      images, droppedImages: ordered.dropped.map((image) => ({ url: image.url, width: image.width, height: image.height, kind: image.kind, description: image.description, reason: image.reason })),
      energyLabel: { letter: listing.letra_eficiencia?.toUpperCase() ?? null, svgUrl: listing.img_ficha_eficiencia, iconUrl: listing.img_eficiencia },
      documents, youtubeIds: gathered.icecat?.youtubeIds ?? [],
      price: { pvp: listing.pvp, pvpBefore: listing.pvp_antes, cost: listing.triple_neto ?? null, vat: listing.iva, stock: listing.stock },
      sources: { mhdDetail: Boolean(gathered.detail), icecat: Boolean(gathered.icecat), icecatTitle: gathered.icecat?.title ?? null },
    },
  };
}
