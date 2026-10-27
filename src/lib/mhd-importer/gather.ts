// Pieza del importador: reúne lo que hay de un producto en las fuentes (listado de MHD, ficha de detalle e Icecat),
// pasando por la copia local. La usan el analista (muestra de una familia) y el procesador (un producto).
import type { SupabaseClient } from "@supabase/supabase-js";
import { cached } from "./cache";
import type { ListingProduct, SampleProduct } from "./family";
import { summarizeIcecat } from "./icecat";
import { fetchIcecatByEan, fetchMhdProductDetail, ICECAT_TEMPORARY, type IcecatConfig, type MhdConfig, type MhdProductDetail } from "./sources";
import { readFilterVocabulary, type FilterVocabulary, type ShopifyConfig } from "./store-filters";

export type SourcesConfig = { mhd: MhdConfig; icecat: IcecatConfig; shopify: ShopifyConfig };
const WEEK = 24 * 7;

// Ficha de MHD: primero la que guarda la importación del catálogo (mhd_catalog_product_details) y, si no está, la de
// la API. MHD no contesta a las fichas pedidas desde Vercel (HTTP 500, 2026-10-26): en producción tienen que estar
// importadas antes (tipo «details_codes» para una tanda).
async function storedDetail(db: SupabaseClient, codigo: string) {
  const { data, error } = await db.from("mhd_catalog_product_details").select("source_payload").eq("codigo", codigo).not("source_payload", "is", null).maybeSingle();
  return error || !data ? null : { status: 200, payload: data.source_payload as MhdProductDetail };
}

export async function gatherProduct(db: SupabaseClient, config: SourcesConfig, listing: ListingProduct): Promise<SampleProduct & { errors: string[] }> {
  const errors: string[] = [];
  const detail = await storedDetail(db, listing.codigo) ?? await cached(db, "mhd_detail", listing.codigo, WEEK, () => fetchMhdProductDetail(config.mhd, listing.codigo)).catch((error: Error) => { errors.push(error.message); return null; });
  // Si Icecat no responde (límite de llamadas o caída), el producto falla y se reintenta más tarde: seguir sin Icecat le
  // quitaría especificaciones, fotos y documentos sin que nadie se enterase (2026-10-27).
  const icecat = listing.codigo_ean ? await cached(db, "icecat", listing.codigo_ean, WEEK, () => fetchIcecatByEan(config.icecat, listing.codigo_ean!)).catch((error: Error) => { if (error.message.startsWith(ICECAT_TEMPORARY) || /fetch failed|timeout|aborted/i.test(error.message)) throw error; errors.push(error.message); return null; }) : null;
  return { listing, detail: detail?.payload ?? null, icecat: summarizeIcecat(icecat?.payload ?? null, config.icecat.language), errors };
}

// De pocos en pocos para no saturar MHD ni Icecat.
export async function gatherProducts(db: SupabaseClient, config: SourcesConfig, listing: ListingProduct[], concurrency = 4) {
  const results: (SampleProduct & { errors: string[] })[] = new Array(listing.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, listing.length) }, async () => { while (next < listing.length) { const index = next++; results[index] = await gatherProduct(db, config, listing[index]); } }));
  return results;
}

export async function filterVocabulary(db: SupabaseClient, config: ShopifyConfig, maxAgeHours = 24): Promise<FilterVocabulary> {
  const result = await cached(db, "shopify_filters", "vocabulary", maxAgeHours, async () => ({ status: 200, payload: await readFilterVocabulary(config) }));
  return result.payload!;
}
