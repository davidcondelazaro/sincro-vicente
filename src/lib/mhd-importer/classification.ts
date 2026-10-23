// Pieza del importador: colocación del producto en las colecciones actuales de la tienda (decidido 2026-10-23, solo
// mientras no esté el árbol nuevo). Las colecciones son automáticas (etiquetas, tipo, proveedor, metacampos), así que
// se copian el tipo de producto, las etiquetas y la categoría de Shopify de los productos de la tienda que coinciden
// por EAN con los de la misma subfamilia de MHD, eligiendo la variante (integrable, carga superior…) que toca.
import type { FamilyProfile } from "./profile";
import type { SourceValues } from "./rules";
import { shopifyGraphql, type ShopifyConfig } from "./store-filters";

export type Classification = { productType: string | null; tags: string[]; category: { id: string; name: string } | null; siblings: number; distinction: string | null; brandCollection: { handle: string; title: string } | null; notes: string[] };
type Sibling = { productType: string; tags: string[]; category: { id: string; fullName: string } | null };

// Etiquetas que dependen del producto y no se copian de sus hermanas.
const PER_PRODUCT_TAGS = new Set(["Energética", "Descatalogado", "Oferta", "Novedad", "Promociones"]);
const norm = (text: string) => text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const majority = <T,>(items: T[], key: (item: T) => string) => { const counts = new Map<string, { item: T; n: number }>(); for (const item of items) { const k = key(item); const entry = counts.get(k) ?? { item, n: 0 }; entry.n += 1; counts.set(k, entry); } return [...counts.values()].sort((a, b) => b.n - a.n)[0]?.item ?? null; };

async function siblingsByEan(config: ShopifyConfig, eans: string[]) {
  const found: Sibling[] = [];
  for (let i = 0; i < eans.length; i += 25) {
    const query = eans.slice(i, i + 25).map((ean) => `barcode:${ean}`).join(" OR ");
    const data = await shopifyGraphql<{ products: { nodes: Sibling[] } }>(config, `query($q: String!) { products(first: 50, query: $q) { nodes { productType tags category { id fullName } } } }`, { q: query });
    found.push(...data.products.nodes);
  }
  return found;
}

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

export async function classifyInStore(config: ShopifyConfig, input: { subfamilyEans: string[]; distinction: string | null; distinctionNames: string[]; vendor: string }): Promise<Classification> {
  const notes: string[] = [];
  const siblings = (await siblingsByEan(config, input.subfamilyEans)).filter((item) => item.productType);
  // Tipo: el de las hermanas que lleva el nombre de la variante; sin variante, el más común que no nombra ninguna.
  const words = (name: string) => norm(name).split(/\s+/).filter((word) => word.length > 3);
  const mentions = (type: string, name: string) => words(name).every((word) => norm(type).includes(word.slice(0, -1)));
  const candidates = input.distinction ? siblings.filter((item) => mentions(item.productType, input.distinction!)) : siblings.filter((item) => !input.distinctionNames.some((name) => mentions(item.productType, name)));
  const chosen = majority(candidates, (item) => item.productType);
  if (!siblings.length) notes.push("Ningún producto de la tienda coincide por EAN con esta subfamilia: sin colección.");
  else if (!chosen) notes.push(`Ninguna hermana de la tienda es de la variante «${input.distinction ?? "normal"}».`);
  const sameType = chosen ? siblings.filter((item) => item.productType === chosen.productType) : [];
  const tagSet = majority(sameType, (item) => item.tags.filter((tag) => !PER_PRODUCT_TAGS.has(tag)).sort().join("|"));
  const category = majority(sameType.filter((item) => item.category), (item) => item.category!.id)?.category ?? null;
  // Colección de marca: automática por proveedor.
  const brand = await shopifyGraphql<{ collections: { nodes: { handle: string; title: string; ruleSet: { rules: { column: string; condition: string }[] } | null }[] } }>(config, `query($q: String!) { collections(first: 10, query: $q) { nodes { handle title ruleSet { rules { column condition } } } } }`, { q: `title:${input.vendor}` });
  const brandCollection = brand.collections.nodes.find((collection) => collection.ruleSet?.rules.length === 1 && collection.ruleSet.rules[0].column === "VENDOR" && collection.ruleSet.rules[0].condition === input.vendor) ?? null;
  if (!brandCollection) notes.push(`No hay colección de marca para el proveedor «${input.vendor}».`);
  return {
    productType: chosen?.productType ?? null, tags: tagSet ? tagSet.tags.filter((tag) => !PER_PRODUCT_TAGS.has(tag)).sort() : [],
    category: category ? { id: category.id, name: category.fullName } : null, siblings: siblings.length, distinction: input.distinction,
    brandCollection: brandCollection ? { handle: brandCollection.handle, title: brandCollection.title } : null, notes,
  };
}
