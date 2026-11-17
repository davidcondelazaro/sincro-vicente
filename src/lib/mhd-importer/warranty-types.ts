// Garantías de Garantía3 de cada aparato, según MHD (David, 2026-11-14; docs/GARANTIAS_DESDE_MHD.md). Sustituye a las
// familias y reglas por título (custom.admite_garantia). MHD manda en la ficha de detalle (`/products/:codigo`, no en el
// listado) el bloque `garantia3`: la lista de garantías que admite el aparato. El importador guarda los TIPOS en
// `custom.garantias_tipos` (ampliacion_2, ampliacion_3, combi, cover, display); el tramo lo calcula el tema con el
// precio, así que un cambio de precio no obliga a releer nada.
// Sin dependencias en tiempo de ejecución: lo prueban las pruebas de node (tests/warranty-types.test.mjs).
import type { SupabaseClient } from "@supabase/supabase-js";

export const WARRANTY_TYPES = ["ampliacion_2", "ampliacion_3", "combi", "cover", "display"] as const;
export type WarrantyType = (typeof WARRANTY_TYPES)[number];

// Las 22 garantías de la tienda, por su código de MHD (= SKU en Shopify). Son productos que se llevan a mano (textos,
// reglamentos, precios de la tarifa): el importador no las procesa ni las sube nunca (locks.ts).
export const GARANTIA3_PRODUCTS = new Map<string, WarrantyType>([
  ["10040604", "ampliacion_2"], ["10040586", "ampliacion_2"], ["10040587", "ampliacion_2"], ["10040588", "ampliacion_2"], ["10040589", "ampliacion_2"],
  ["10040613", "ampliacion_3"], ["10040614", "ampliacion_3"], ["10040611", "ampliacion_3"], ["10040612", "ampliacion_3"],
  ["10040590", "cover"], ["10040591", "cover"], ["10040592", "cover"], ["10040633", "cover"],
  ["10052432", "combi"], ["10040607", "combi"], ["10052433", "combi"], ["10052434", "combi"],
  ["10040600", "display"], ["10040628", "display"], ["10040601", "display"], ["10040602", "display"], ["10040603", "display"],
]);

// Por la referencia de Garantía3 (`ref_proved`); el orden importa: G3PD3ES antes que G3PDES.
const BY_REFERENCE: [RegExp, WarrantyType][] = [
  [/^G3PD3ES/i, "ampliacion_3"], [/^G3PDES/i, "ampliacion_2"], [/^G3CPDES/i, "cover"], [/^G3DPDES/i, "display"], [/^G3E12/i, "combi"],
];

type BlockEntry = { codigo?: unknown; ref_proved?: unknown; titulo?: unknown };

/** Tipo de una entrada del bloque `garantia3`: por su referencia de Garantía3 y, si no, por su código de MHD. */
export function warrantyTypeOf(entry: BlockEntry): WarrantyType | null {
  const reference = typeof entry.ref_proved === "string" ? entry.ref_proved.trim() : "";
  for (const [pattern, type] of BY_REFERENCE) if (pattern.test(reference)) return type;
  return GARANTIA3_PRODUCTS.get(String(entry.codigo ?? "")) ?? null;
}

export type WarrantyTypesDecision = {
  /** null = la ficha no dice nada (fichas leídas antes del 12-11, sin el bloque): no se toca lo que haya en Shopify. */
  types: WarrantyType[] | null;
  reason: string;
  /** Entradas del bloque que no se reconocen (garantía nueva de MHD): se avisa y no se ofrecen. */
  unknown: string[];
};

/**
 * Tipos de garantía de un aparato a partir del bloque `garantia3` de su ficha. Lista vacía = sin garantía (se borra el
 * metacampo). Los reacondicionados nunca llevan (como en la carga a mano del 2026-11-14). No se filtra por precio: el
 * mínimo de 60 € lo aplica el tema.
 */
export function warrantyTypesFromBlock(block: unknown, options: { refurbished?: boolean } = {}): WarrantyTypesDecision {
  if (options.refurbished) return { types: [], reason: "reacondicionado: sin garantía", unknown: [] };
  if (!Array.isArray(block)) return { types: null, reason: "la ficha de MHD no trae el bloque de garantías: no se toca", unknown: [] };
  const found = new Set<WarrantyType>();
  const unknown: string[] = [];
  for (const entry of block as BlockEntry[]) {
    const type = entry && typeof entry === "object" ? warrantyTypeOf(entry) : null;
    if (type) found.add(type);
    else unknown.push([entry?.codigo, entry?.ref_proved, entry?.titulo].filter(Boolean).join(" · ") || JSON.stringify(entry));
  }
  const types = WARRANTY_TYPES.filter((type) => found.has(type));
  return { types, reason: types.length ? `MHD: ${types.join(", ")}` : "MHD no le asigna garantía", unknown };
}

/** Reacondicionado para las garantías: «reacondicionad» en la familia o la subfamilia (refurbished.ts) o «REAC.» en el título. */
export function refurbishedTitle(title: string | null | undefined) {
  return /\breac\./i.test(title ?? "");
}

/**
 * Bloque `garantia3` de la ficha más reciente que lo tenga: primero la caché de fichas pedidas por el importador
 * (mhd_importer_source_cache, que lo trae desde el 12-11) y después la lectura completa del catálogo
 * (mhd_catalog_product_details, del 26-10 y 29-10, todavía sin él). null si ninguna lo trae.
 */
export async function readWarrantyBlock(db: SupabaseClient, codigo: string): Promise<unknown[] | null> {
  const [{ data: cached, error: cacheError }, { data: stored, error: storedError }] = await Promise.all([
    db.from("mhd_importer_source_cache").select("block:payload->garantia3").eq("source", "mhd_detail").eq("source_key", codigo).maybeSingle(),
    db.from("mhd_catalog_product_details").select("block:source_payload->garantia3").eq("codigo", codigo).maybeSingle(),
  ]);
  if (cacheError) throw cacheError;
  if (storedError) throw storedError;
  const block = (cached as { block?: unknown } | null)?.block ?? (stored as { block?: unknown } | null)?.block;
  return Array.isArray(block) ? block : null;
}
