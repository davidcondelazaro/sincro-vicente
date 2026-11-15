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
  // Tope por marca según el grupo, cuando un grupo es de una sola marca (Mac). Por defecto SIMILAR.perBrand.
  perBrand?: (group: string) => number;
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
  // Detrás de la unidad no puede ir una letra ni una cifra («375 L» sí, «375 LED» no); vale para «"» y «m³/h».
  const match = p.title.match(new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*${unit.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}(?![\\p{L}\\d])`, "iu"));
  return match ? Number(match[1].replace(",", ".")) : null;
};
const integrable = (p: SimilarProduct) => text(p, "filtro.color") === "Integrable" || /integrable/i.test(p.title);
// Posición de un rango de filtro en su escala («De 55 cm a 60 cm» → 1), para penalizar saltos de hueco.
const bucket = (p: SimilarProduct, key: string, scale: RegExp[]) => {
  const value = text(p, key);
  const index = scale.findIndex((re) => re.test(value));
  return index < 0 ? null : index;
};
// Escala de panel de televisores, de menos a más gama.
const panel = (p: SimilarProduct) => {
  const index = ["LED", "QLED", "Mini LED", "OLED"].indexOf(text(p, "filtro.tecnologia"));
  return index < 0 ? null : index;
};
// Gama de procesador de portátiles (de «Procesador …» en `filtro.mas_especificaciones`): 0 básico, 1 gama 3, 2 gama 5
// (también Snapdragon y Apple M), 3 gama 7 y 4 gama 9.
const cpuTier = (p: SimilarProduct) => {
  const cpu = text(p, "filtro.mas_especificaciones").match(/Procesador ([^|]+)/)?.[1]?.trim() ?? "";
  if (!cpu) return null;
  if (/celeron|intel n$|mediatek|pentium|athlon/i.test(cpu)) return 0;
  if (/snapdragon|apple/i.test(cpu)) return 2;
  const digit = cpu.match(/(\d)$/)?.[1];
  return digit ? ({ "3": 1, "5": 2, "7": 3, "9": 4 } as Record<string, number>)[digit] ?? null : null;
};
const has = (p: SimilarProduct, key: string, value: RegExp) => value.test(text(p, key));
const mismatch = (a: SimilarProduct, b: SimilarProduct, key: string, value: RegExp, weight: number) => (has(a, key, value) === has(b, key, value) ? 0 : weight);
// Diferencia en «duplicaciones» (8 frente a 16 GB = 1), para memorias, discos y hercios.
const log2diff = (a: number | null, b: number | null, weight: number) => (a === null || b === null || a <= 0 || b <= 0 ? 0 : Math.abs(Math.log2(a / b)) * weight);
const gb = (p: SimilarProduct, key: string) => {
  const value = text(p, key);
  if (/más de 1 tb/i.test(value)) return 2048;
  const n = number(value);
  return n === null ? null : /tb/i.test(value) ? n * 1024 : n;
};
const hz = (p: SimilarProduct) => number(text(p, "filtro.caracteristicas").match(/Pantalla (\d+) Hz/i)?.[1] ?? "") ?? 60;
const RESOLUTION = ["HD", "Full HD", "QHD", "4K"];
const resolution = (p: SimilarProduct) => {
  const index = RESOLUTION.indexOf(text(p, "filtro.resolucion"));
  return index < 0 ? null : index;
};
const WEIGHT_LAPTOP = [/hasta 1,3/i, /de 1,3/i, /más de 1,8/i];
const inches = (p: SimilarProduct) => number(text(p, "filtro.tamano_pantalla")) ?? fromTitle(p, '"');
const WIDTH_COMBI =[/menos de 55/i, /de 55/i, /de 61/i, /de 71/i, /de 91/i];
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
    live: true,
    group: (p) => `${integrable(p) ? "integrable" : "libre"}/${/c[ií]clico/i.test(text(p, "filtro.tecnologia")) && !/no ?frost/i.test(p.title) ? "ciclico" : "nofrost"}`,
    main: (p) => fromTitle(p, "L") ?? number(text(p, "filtro.capacidad")),
    mainWeight: 0.4,
    steps: [[30, 0.3], [50, 0.45], [80, 0.7]],
    extra: (a, b) => diff(fromTitle(a, "cm"), fromTitle(b, "cm"), 0.6) + diff(bucket(a, "filtro.ancho", WIDTH_COMBI), bucket(b, "filtro.ancho", WIDTH_COMBI), 25) + diff(energyClass(a), energyClass(b), 3),
  },
  // Lavavajillas: 45 o 60 cm y libre o integrable; servicios cercanos.
  Lavavajillas: {
    live: true,
    group: (p) => `${/45\s*cm/i.test(`${text(p, "filtro.ancho")} ${p.title}`) ? "45" : "60"}/${integrable(p) ? "integrable" : "libre"}`,
    main: (p) => fromTitle(p, "servicios") ?? number(text(p, "filtro.capacidad")),
    mainWeight: 10,
    steps: [[1, 0.3], [2, 0.45], [3, 0.7]],
    extra: (a, b) => diff(energyClass(a), energyClass(b), 4),
  },
  // Hornos: compacto (45 cm) o normal y pirolítico o no; litros cercanos.
  Hornos: {
    live: true,
    group: (p) => `${/45\s*cm/i.test(text(p, "filtro.alto")) ? "compacto" : "normal"}/${/pir[oó]l[ií]/i.test(`${text(p, "filtro.limpieza")} ${p.title}`) ? "pirolitico" : "otro"}`,
    main: (p) => fromTitle(p, "L") ?? number(text(p, "filtro.capacidad")),
    mainWeight: 1.5,
    steps: [[5, 0.3], [10, 0.45], [20, 0.7]],
    extra: (a, b) => diff(energyClass(a), energyClass(b), 4),
  },
  // Televisores: mismas pulgadas primero (luego ±8 y ±15); la tecnología de panel pesa en el orden.
  Televisores: {
    live: true,
    group: () => "tv",
    main: (p) => number(text(p, "filtro.tamano_pantalla")) ?? fromTitle(p, '"'),
    mainWeight: 3,
    steps: [[0, 0.3], [8, 0.45], [15, 0.7]],
    extra: (a, b) => diff(panel(a), panel(b), 12),
  },
  // Secadoras: bomba de calor o no; kilos cercanos.
  Secadoras: {
    live: true,
    group: (p) => (/bomba de calor/i.test(`${text(p, "filtro.caracteristicas")} ${p.title}`) ? "bomba" : "otra"),
    main: (p) => fromTitle(p, "kg") ?? number(text(p, "filtro.capacidad")),
    mainWeight: 12,
    steps: [[1, 0.3], [2, 0.45], [3, 0.7]],
    extra: (a, b) => diff(energyClass(a), energyClass(b), 4),
  },
  // Campanas: mismo tipo de montaje (las de isla aparte) y mismo ancho primero (luego ±10 y ±20 cm).
  "Campanas extractoras": {
    live: true,
    group: (p) => (/\bisla\b/i.test(p.title) ? "isla" : text(p, "filtro.tipo") || "sin tipo"),
    main: (p) => fromTitle(p, "cm") ?? number(text(p, "filtro.ancho")),
    mainWeight: 2,
    steps: [[0, 0.3], [10, 0.45], [20, 0.7]],
    extra: (a, b) => diff(fromTitle(a, "m³/h"), fromTitle(b, "m³/h"), 0.04) + diff(energyClass(a), energyClass(b), 3),
  },
  // Portátiles: Mac, Chromebook o PC, y con gráfica dedicada aparte; pulgadas cercanas y precio más ajustado que en
  // electrodomésticos, porque hay muchos. Pesan memoria, disco, gama de procesador, peso y convertible.
  Portátiles: {
    live: true,
    group: (p) => {
      if (/macos/i.test(text(p, "filtro.sistema_operativo")) || /apple/i.test(text(p, "filtro.mas_especificaciones")) || /macbook/i.test(p.title)) return "mac";
      if (/chrome/i.test(text(p, "filtro.sistema_operativo")) || /chromebook/i.test(p.title)) return "chrome";
      return has(p, "filtro.caracteristicas", /gráfica dedicada/i) ? "pc/grafica" : "pc";
    },
    // Los Mac son todos de Apple: sin tope por marca. Los monitores grandes (40" o más) son casi todos Sony.
    perBrand: (group) => (group === "mac" ? SIMILAR.maxList : SIMILAR.perBrand),
    main: inches,
    mainWeight: 8,
    steps: [[0.5, 0.2], [1.5, 0.3], [2.5, 0.45]],
    extra: (a, b) =>
      log2diff(gb(a, "filtro.memoria_ram"), gb(b, "filtro.memoria_ram"), 12) +
      log2diff(gb(a, "filtro.capacidad"), gb(b, "filtro.capacidad"), 8) +
      diff(cpuTier(a), cpuTier(b), 10) +
      diff(bucket(a, "filtro.mas_especificaciones", WEIGHT_LAPTOP), bucket(b, "filtro.mas_especificaciones", WEIGHT_LAPTOP), 6) +
      mismatch(a, b, "filtro.caracteristicas", /convertible/i, 20) +
      mismatch(a, b, "filtro.caracteristicas", /oled/i, 6),
  },
  // Monitores: los portátiles (menos de 18") y los ultrapanorámicos aparte; pulgadas cercanas. Pesan resolución, hercios,
  // curva, panel, altura regulable y USB-C con carga.
  Monitores: {
    live: true,
    group: (p) => {
      const size = inches(p) ?? 0;
      if (size < 18) return "portatil";
      if (has(p, "filtro.caracteristicas", /ultrapanor/i)) return "ultra";
      return size >= 40 ? "grande" : "normal";
    },
    perBrand: (group) => (group === "grande" ? SIMILAR.maxList : SIMILAR.perBrand),
    main: inches,
    mainWeight: 4,
    steps: [[0.5, 0.3], [3.5, 0.45], [5, 0.7]],
    extra: (a, b) =>
      diff(resolution(a), resolution(b), 15) +
      log2diff(hz(a), hz(b), 15) +
      mismatch(a, b, "filtro.caracteristicas", /curva/i, 10) +
      (text(a, "filtro.tecnologia") && text(b, "filtro.tecnologia") && text(a, "filtro.tecnologia") !== text(b, "filtro.tecnologia") ? 5 : 0) +
      mismatch(a, b, "filtro.caracteristicas", /altura regulable/i, 5) +
      mismatch(a, b, "filtro.caracteristicas", /usb-c/i, 8),
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
      const perBrand = rule.perBrand?.(me.group) ?? SIMILAR.perBrand;
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
          if ((brands.get(brand) ?? 0) >= perBrand) continue;
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
