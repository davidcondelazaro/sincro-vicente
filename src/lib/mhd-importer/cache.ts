// Pieza del importador: copia local de lo leído de MHD, Icecat y Shopify (tabla mhd_importer_source_cache), para no
// repetir consultas cada vez que se repite una prueba. `maxAgeHours` decide cuándo se vuelve a pedir.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FetchResult } from "./sources";

export type CacheSource = "mhd_detail" | "icecat" | "shopify_filters";

export async function cached<T>(db: SupabaseClient, source: CacheSource, key: string, maxAgeHours: number, fetcher: () => Promise<FetchResult<T>>): Promise<FetchResult<T> & { fromCache: boolean; fetchedAt: string }> {
  const { data, error } = await db.from("mhd_importer_source_cache").select("http_status,payload,fetched_at").eq("source", source).eq("source_key", key).maybeSingle();
  if (error) throw new Error(`No se pudo leer la copia local (${error.message}).`);
  if (data && Date.now() - new Date(data.fetched_at).getTime() < maxAgeHours * 3_600_000) return { status: data.http_status, payload: data.payload as T | null, fromCache: true, fetchedAt: data.fetched_at };
  const fetched = await fetcher();
  // Alguna ficha trae el carácter nulo (\u0000), que jsonb no admite: sin quitarlo no se guardaba la copia y se perdía
  // la fuente entera del producto (visto en Icecat de un Samsung, 2026-10-26).
  const result = { ...fetched, payload: fetched.payload === null ? null : JSON.parse(JSON.stringify(fetched.payload).replace(/\\u0000/g, "")) as T };
  const fetchedAt = new Date().toISOString();
  const { error: saveError } = await db.from("mhd_importer_source_cache").upsert({ source, source_key: key, http_status: result.status, payload: result.payload, fetched_at: fetchedAt });
  if (saveError) throw new Error(`No se pudo guardar la copia local (${saveError.message}).`);
  return { ...result, fromCache: false, fetchedAt };
}
