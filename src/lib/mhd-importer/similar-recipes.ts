// Similares por familia (David, 2026-11-15; docs/SINCRONIZACIONES_MHD.md). Funciones puras: reciben los productos de
// mhd_similar_source y devuelven, por producto, hasta 10 relacionados de su misma familia, lo más parecidos posible.
//
// Una regla común y, por familia, dos cosas: el «grupo» que no puede cambiar nunca (en lavadoras, carga e instalación)
// y el «dato principal» que tiene que parecerse (en lavadoras, los kilos). Después: precio parecido, como mucho 2 de la
// misma marca y solo lo que tiene stock. Si salen menos de 6, se amplía el margen por escalones.

export type SimilarProduct = { pid: string; t: string; title: string; pvp: number; stock: number; marca: string | null; f: Record<string, unknown> | null };

type Rule = {
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
const energyClass = (p: SimilarProduct) => {
  const match = text(p, "features.eficiencia_energ_tica").match(/([A-G])\s*$/);
  return match ? "ABCDEFG".indexOf(match[1]) : null;
};
const diff = (a: number | null, b: number | null, weight: number) => (a === null || b === null ? 0 : Math.abs(a - b) * weight);

const RULES: Record<string, Rule> = {
  Lavadoras: {
    group: (p) => {
      const carga = /carga superior/i.test(`${text(p, "filtro.caracteristicas")} ${p.title}`) ? "superior" : "frontal";
      const instalacion = text(p, "filtro.color") === "Integrable" || /integrable/i.test(p.title) ? "integrable" : "libre";
      return `${carga}/${instalacion}`;
    },
    // «Más de 10 kg» no da la cifra: entonces se lee del título.
    main: (p) => {
      const capacidad = text(p, "filtro.capacidad");
      const kg = /más de/i.test(capacidad) ? null : number(capacidad.replace(/\s*kg.*/i, ""));
      if (kg !== null) return kg;
      const fromTitle = p.title.match(/(\d+(?:[.,]\d)?)\s*kg/i);
      return fromTitle ? Number(fromTitle[1].replace(",", ".")) : null;
    },
    mainWeight: 12,
    steps: [[1, 0.3], [2, 0.45], [3, 0.7]],
    extra: (a, b) => diff(number(text(a, "filtro.centrifugado")), number(text(b, "filtro.centrifugado")), 0.03) + diff(energyClass(a), energyClass(b), 4),
  },
};

export const SIMILAR_TYPES = Object.keys(RULES);

export function computeSimilars(rows: SimilarProduct[]) {
  const result = new Map<string, string[]>();
  const byType = new Map<string, SimilarProduct[]>();
  for (const row of rows) if (RULES[row.t]) byType.set(row.t, [...(byType.get(row.t) ?? []), row]);
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
        list = [];
        for (const { q } of pool) {
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
