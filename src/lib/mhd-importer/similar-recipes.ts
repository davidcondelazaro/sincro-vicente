// Similares por familia (David, 2026-11-15; docs/SINCRONIZACIONES_MHD.md). Funciones puras: reciben los productos de
// mhd_similar_source y devuelven, por producto, hasta 10 relacionados de su misma familia, lo más parecidos posible.
//
// Una regla común y, por familia, dos cosas: el «grupo» que no puede cambiar nunca (en lavadoras, carga e instalación)
// y el «dato principal» que tiene que parecerse (en lavadoras, los kilos). Después: precio parecido, como mucho 2 de la
// misma marca y solo lo que tiene stock. Si salen menos de 6, se amplía el margen por escalones.

export type SimilarProduct = { pid: string; t: string; title: string; pvp: number; stock: number; marca: string | null; f: Record<string, unknown> | null };

type Rule = {
  live: boolean; // false: solo se calcula para revisarlo (muestra), no se escribe en la tienda
  group: (p: SimilarProduct) => string;
  main: (p: SimilarProduct) => number | null;
  mainWeight: number; // puntos por unidad de diferencia del dato principal
  steps: [mainTol: number, priceTol: number][];
  extra?: (a: SimilarProduct, b: SimilarProduct) => number;
};

export const SIMILAR = { maxList: 10, minList: 6, perBrand: 2, priceWeight: 80 };

const text = (p: SimilarProduct, key: string) => {
  const value = p.f?.[key];
  return Array.isArray(value) ? value.join(" | ") : typeof value === "string" ? value : "";
};
const number = (value: string) => {
  const match = value.match(/(\d+(?:[.,]\d+)?)/);
  return match ? Number(match[1].replace(",", ".")) : null;
};
const ENERGY = ["A+++", "A++", "A+", "A", "B", "C", "D", "E", "F", "G"];
const energyClass = (p: SimilarProduct) => {
  const index = ENERGY.indexOf(text(p, "features.eficiencia_energ_tica").replace(/nueva/i, "").trim());
  return index < 0 ? null : index;
};
// Cifra del título delante de una unidad («375 L», «186 cm», «14 servicios»).
const fromTitle = (p: SimilarProduct, unit: string) => {
  const match = p.title.match(new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*${unit}\\b`, "i"));
  return match ? Number(match[1].replace(",", ".")) : null;
};
const integrable = (p: SimilarProduct) => text(p, "filtro.color") === "Integrable" || /integrable/i.test(p.title);
// Posición de un rango de filtro en su escala («De 55 cm a 60 cm» → 1), para penalizar saltos de hueco.
const bucket = (p: SimilarProduct, key: string, scale: RegExp[]) => {
  const value = text(p, key);
  const index = scale.findIndex((re) => re.test(value));
  return index < 0 ? null : index;
};
const WIDTH_COMBI = [/menos de 55/i, /de 55/i, /de 61/i, /de 71/i, /de 91/i];
const diff = (a: number | null, b: number | null, weight: number) => (a === null || b === null ? 0 : Math.abs(a - b) * weight);

const RULES: Record<string, Rule> = {
  Lavadoras: {
    live: true,
    group: (p) => {
      const carga = /carga superior/i.test(`${text(p, "filtro.caracteristicas")} ${p.title}`) ? "superior" : "frontal";
      const instalacion = integrable(p) ? "integrable" : "libre";
      return `${carga}/${instalacion}`;
    },
    // «Más de 10 kg» no da la cifra: entonces se lee del título.
    main: (p) => {
      const capacidad = text(p, "filtro.capacidad");
      const kg = /más de/i.test(capacidad) ? null : number(capacidad.replace(/\s*kg.*/i, ""));
      if (kg !== null) return kg;
      return fromTitle(p, "kg");
    },
    mainWeight: 12,
    steps: [[1, 0.3], [2, 0.45], [3, 0.7]],
    extra: (a, b) => diff(number(text(a, "filtro.centrifugado")), number(text(b, "filtro.centrifugado")), 0.03) + diff(energyClass(a), energyClass(b), 4),
  },
  // Combis: libre o integrable y No Frost o cíclico; litros cercanos. La altura (del título) y el ancho (rango del
  // filtro) pesan porque deciden si cabe en el hueco.
  "Frigoríficos combi": {
    live: false,
    group: (p) => `${integrable(p) ? "integrable" : "libre"}/${/c[ií]clico/i.test(text(p, "filtro.tecnologia")) && !/no ?frost/i.test(p.title) ? "ciclico" : "nofrost"}`,
    main: (p) => fromTitle(p, "L") ?? number(text(p, "filtro.capacidad")),
    mainWeight: 0.4,
    steps: [[30, 0.3], [50, 0.45], [80, 0.7]],
    extra: (a, b) => diff(fromTitle(a, "cm"), fromTitle(b, "cm"), 0.6) + diff(bucket(a, "filtro.ancho", WIDTH_COMBI), bucket(b, "filtro.ancho", WIDTH_COMBI), 25) + diff(energyClass(a), energyClass(b), 3),
  },
  // Lavavajillas: 45 o 60 cm y libre o integrable; servicios cercanos.
  Lavavajillas: {
    live: false,
    group: (p) => `${/45\s*cm/i.test(`${text(p, "filtro.ancho")} ${p.title}`) ? "45" : "60"}/${integrable(p) ? "integrable" : "libre"}`,
    main: (p) => fromTitle(p, "servicios") ?? number(text(p, "filtro.capacidad")),
    mainWeight: 10,
    steps: [[1, 0.3], [2, 0.45], [3, 0.7]],
    extra: (a, b) => diff(energyClass(a), energyClass(b), 4),
  },
  // Hornos: compacto (45 cm) o normal y pirolítico o no; litros cercanos.
  Hornos: {
    live: false,
    group: (p) => `${/45\s*cm/i.test(text(p, "filtro.alto")) ? "compacto" : "normal"}/${/pir[oó]l[ií]/i.test(`${text(p, "filtro.limpieza")} ${p.title}`) ? "pirolitico" : "otro"}`,
    main: (p) => fromTitle(p, "L") ?? number(text(p, "filtro.capacidad")),
    mainWeight: 1.5,
    steps: [[5, 0.3], [10, 0.45], [20, 0.7]],
    extra: (a, b) => diff(energyClass(a), energyClass(b), 4),
  },
};

export const SIMILAR_TYPES = Object.keys(RULES);

// `preview`: calcula también las familias aún no publicadas, para preparar la muestra que revisa David.
export function computeSimilars(rows: SimilarProduct[], options: { preview?: boolean } = {}) {
  const result = new Map<string, string[]>();
  const byType = new Map<string, SimilarProduct[]>();
  for (const row of rows) if (RULES[row.t] && (RULES[row.t].live || options.preview)) byType.set(row.t, [...(byType.get(row.t) ?? []), row]);
  for (const [type, products] of byType) {
    const rule = RULES[type];
    const info = new Map(products.map((p) => [p.pid, { group: rule.group(p), main: rule.main(p) }]));
    for (const p of products) {
      const me = info.get(p.pid)!;
      if (me.main === null || !(p.pvp > 0)) continue;
      const candidates = products.filter((q) => q.pid !== p.pid && q.stock > 0 && q.pvp > 0 && info.get(q.pid)!.group === me.group && info.get(q.pid)!.main !== null);
      const score = (q: SimilarProduct) => Math.abs(info.get(q.pid)!.main! - me.main!) * rule.mainWeight + (Math.abs(q.pvp - p.pvp) / p.pvp) * SIMILAR.priceWeight + (rule.extra?.(p, q) ?? 0);
      let list: string[] = [];
      for (const [mainTol, priceTol] of rule.steps) {
        const pool = candidates
          .filter((q) => Math.abs(info.get(q.pid)!.main! - me.main!) <= mainTol && Math.abs(q.pvp - p.pvp) / p.pvp <= priceTol)
          .map((q) => ({ q, s: score(q) }))
          .sort((a, b) => a.s - b.s || a.q.pid.localeCompare(b.q.pid));
        const brands = new Map<string, number>();
        // Hay productos duplicados en la tienda (mismo título, dos fichas): ni el propio ni repetidos.
        const titles = new Set([p.title.toLowerCase()]);
        list = [];
        for (const { q } of pool) {
          if (titles.has(q.title.toLowerCase())) continue;
          titles.add(q.title.toLowerCase());
          const brand = (q.marca ?? "").toUpperCase();
          if ((brands.get(brand) ?? 0) >= SIMILAR.perBrand) continue;
          brands.set(brand, (brands.get(brand) ?? 0) + 1);
          list.push(q.pid);
          if (list.length === SIMILAR.maxList) break;
        }
        if (list.length >= SIMILAR.minList) break;
      }
      if (list.length) result.set(p.pid, list);
    }
  }
  return result;
}
