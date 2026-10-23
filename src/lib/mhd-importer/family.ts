// Pieza del importador: muestra y resumen de una familia de MHD para el analista.
// Funciones puras: reciben el listado de la familia (de mhd_catalog_products) y las fichas ya leídas.
import type { IcecatSummary } from "./icecat";
import type { MhdProductDetail } from "./sources";

export type ListingProduct = {
  codigo: string; codigo_ean: string | null; ref_proved: string | null; titulo: string | null; nombre_marca: string | null;
  cod_subfamilia: string | null; nombre_subfamilia: string | null; pvp: number | null; stock: number | null;
  descripcion_ampliada: string | null; imagen: string | null; letra_eficiencia: string | null; img_ficha_eficiencia: string | null;
};
export type SampleProduct = { listing: ListingProduct; detail: MhdProductDetail | null; icecat: IcecatSummary | null };
export type ValueCount = { value: string; count: number };
export type FamilySummary = {
  familyCode: string; familyName: string; products: number; withImage: number; withEan: number; withEnergyLabel: number;
  subfamilies: { code: string; name: string; products: number }[];
  brands: ValueCount[];
  price: { min: number | null; median: number | null; max: number | null };
  // Características de la ficha de MHD en la muestra: nombre → nº de productos que la traen y valores más repetidos.
  mhdFeatures: { name: string; products: number; values: ValueCount[] }[];
  // Características de Icecat en la muestra, agrupadas por sección.
  icecatFeatures: { group: string; name: string; products: number; values: ValueCount[] }[];
  icecatCategories: ValueCount[];
  sample: { codigo: string; withDetail: boolean; withIcecat: boolean }[];
};

const MAX_VALUES = 12;
function count(values: Iterable<string>) { const counts = new Map<string, number>(); for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1); return counts; }
function top(counts: Map<string, number>, limit = MAX_VALUES): ValueCount[] { return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([value, n]) => ({ value, count: n })); }
const median = (values: number[]) => { if (!values.length) return null; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; };

// Muestra variada: solo productos importables (con imagen y EAN), repartida por subfamilias y marcas y con precios
// de todo el rango; primero los que tienen stock. `include` fuerza productos concretos (p. ej. el del experimento).
export function selectSample(listing: ListingProduct[], size: number, include: string[] = []): ListingProduct[] {
  const eligible = listing.filter((product) => product.imagen && product.codigo_ean);
  const chosen = new Map<string, ListingProduct>();
  for (const codigo of include) { const product = listing.find((item) => item.codigo === codigo); if (product) chosen.set(codigo, product); }
  const sorted = [...eligible].sort((a, b) => Number((b.stock ?? 0) > 0) - Number((a.stock ?? 0) > 0) || (a.pvp ?? 0) - (b.pvp ?? 0));
  const seen = (key: (item: ListingProduct) => string | null, product: ListingProduct) => [...chosen.values()].some((item) => key(item) === key(product));
  // 1) una por subfamilia, 2) una por marca, 3) el resto repartido por precio.
  for (const product of sorted) if (chosen.size < size && !seen((item) => item.cod_subfamilia, product)) chosen.set(product.codigo, product);
  for (const product of sorted) if (chosen.size < size && !seen((item) => item.nombre_marca, product)) chosen.set(product.codigo, product);
  const rest = sorted.filter((product) => !chosen.has(product.codigo));
  const step = rest.length / Math.max(1, size - chosen.size);
  for (let index = 0; chosen.size < size && index < rest.length; index += Math.max(1, step)) chosen.set(rest[Math.floor(index)].codigo, rest[Math.floor(index)]);
  return [...chosen.values()];
}

export function summarizeFamily(familyCode: string, familyName: string, listing: ListingProduct[], sample: SampleProduct[]): FamilySummary {
  const subfamilies = new Map<string, { code: string; name: string; products: number }>();
  for (const product of listing) { const code = product.cod_subfamilia ?? "?"; const item = subfamilies.get(code) ?? { code, name: product.nombre_subfamilia ?? "", products: 0 }; item.products += 1; subfamilies.set(code, item); }
  const prices = listing.map((product) => product.pvp).filter((price): price is number => typeof price === "number" && price > 0);
  const mhdFeatures = new Map<string, string[]>(); const icecatFeatures = new Map<string, { group: string; name: string; values: string[] }>();
  for (const item of sample) {
    for (const feature of item.detail?.caracteristicas ?? []) if (feature.nombre && feature.valor) (mhdFeatures.get(feature.nombre) ?? mhdFeatures.set(feature.nombre, []).get(feature.nombre)!).push(feature.valor);
    for (const [group, features] of Object.entries(item.icecat?.specifications ?? {})) for (const [name, value] of Object.entries(features)) {
      const key = `${group}|${name}`; const entry = icecatFeatures.get(key) ?? { group, name, values: [] }; entry.values.push(value); icecatFeatures.set(key, entry);
    }
  }
  return {
    familyCode, familyName, products: listing.length,
    withImage: listing.filter((product) => product.imagen).length, withEan: listing.filter((product) => product.codigo_ean).length,
    withEnergyLabel: listing.filter((product) => product.img_ficha_eficiencia).length,
    subfamilies: [...subfamilies.values()].sort((a, b) => b.products - a.products),
    brands: top(count(listing.map((product) => product.nombre_marca ?? "(sin marca)")), 30),
    price: { min: prices.length ? Math.min(...prices) : null, median: median(prices), max: prices.length ? Math.max(...prices) : null },
    mhdFeatures: [...mhdFeatures].map(([name, values]) => ({ name, products: values.length, values: top(count(values)) })).sort((a, b) => b.products - a.products),
    icecatFeatures: [...icecatFeatures.values()].map((entry) => ({ group: entry.group, name: entry.name, products: entry.values.length, values: top(count(entry.values), 6) })).sort((a, b) => b.products - a.products),
    icecatCategories: top(count(sample.map((item) => item.icecat?.category).filter((value): value is string => Boolean(value)))),
    sample: sample.map((item) => ({ codigo: item.listing.codigo, withDetail: Boolean(item.detail), withIcecat: Boolean(item.icecat) })),
  };
}
