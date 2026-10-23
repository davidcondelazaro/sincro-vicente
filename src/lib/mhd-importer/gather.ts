// Pieza del importador: reúne lo que hay de un producto en las fuentes (listado de MHD, ficha de detalle e Icecat),
// pasando por la copia local. La usan el analista (muestra de una familia) y el procesador (un producto).
import type { SupabaseClient } from "@supabase/supabase-js";
import { cached } from "./cache";
import type { ListingProduct, SampleProduct } from "./family";
import { summarizeIcecat } from "./icecat";
import { fetchIcecatByEan, fetchMhdProductDetail, type IcecatConfig, type MhdConfig } from "./sources";
import { readFilterVocabulary, type FilterVocabulary, type ShopifyConfig } from "./store-filters";

export type SourcesConfig = { mhd: MhdConfig; icecat: IcecatConfig; shopify: ShopifyConfig };
const WEEK = 24 * 7;

export async function gatherProduct(db: SupabaseClient, config: SourcesConfig, listing: ListingProduct): Promise<SampleProduct & { errors: string[] }> {
  const errors: string[] = [];
  const detail = await cached(db, "mhd_detail", listing.codigo, WEEK, () => fetchMhdProductDetail(config.mhd, listing.codigo)).catch((error: Error) => { errors.push(error.message); return null; });
  const icecat = listing.codigo_ean ? await cached(db, "icecat", listing.codigo_ean, WEEK, () => fetchIcecatByEan(config.icecat, listing.codigo_ean!)).catch((error: Error) => { errors.push(error.message); return null; }) : null;
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
