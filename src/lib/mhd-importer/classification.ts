// Pieza del importador: la variante del producto (integrable, carga superior…) y la forma de la colocación. Hasta el
// 2026-10-29 copiaba tipo, etiquetas y categoría de los productos de la tienda con el mismo EAN (classifyInStore, sobre
// el espejo); desde que la colocación sale del árbol de la tienda (processor.ts) eso no se usa y se quitó.
import type { FamilyProfile } from "./profile";
import type { SourceValues } from "./rules";

export type Classification = { productType: string | null; tags: string[]; category: { id: string; name: string } | null; siblings: number; distinction: string | null; brandCollection: { handle: string; title: string } | null; notes: string[] };

const norm = (text: string) => text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// La variante del producto según el perfil (p. ej. «Integrable» si mhd:Integrable = Sí).
export function productDistinction(profile: FamilyProfile, values: SourceValues) {
  for (const distinction of profile.product.distinctions) {
    for (const source of distinction.sources) {
      const value = values.get(source.toLowerCase());
      if (value && (/^s[ií]$/i.test(value.trim()) || norm(value).includes(norm(distinction.name)))) return distinction.name;
    }
  }
  return null;
}
