// Pieza del importador: la hoja de datos única de un producto (decidida 2026-10-23). La redacción y los revisores solo
// ven esta hoja, no los datos en bruto: para cada dato que el perfil define con varias fuentes (centrifugado, capacidad,
// medidas…) se queda solo el valor de la primera fuente con dato, y el resto se quita. Así la IA nunca ve «1400 rpm» en
// MHD y «1351 rpm» en Icecat a la vez. Además, el código comprueba que cada cifra de los textos está en la hoja.
// Funciones puras, sin IA.
import type { FamilyProfile } from "./profile";
import type { SourceValues } from "./rules";

// Fuentes que compiten por el mismo dato: las de los datos clave del título y las de los filtros numéricos (no las
// características, que mezclan fuentes de distinto tipo, ni el texto libre).
// Medidas y peso: en todas las familias, Icecat (en mm y sin los errores de MHD como «845cm») y, si no, MHD.
const DEFAULT_GROUPS = [
  ["icecat:Peso y dimensiones|Altura", "mhd:Altura", "mhd:Alto"],
  ["icecat:Peso y dimensiones|Ancho", "mhd:Ancho", "mhd:Anchura"],
  ["icecat:Peso y dimensiones|Profundidad", "mhd:Profundidad", "mhd:Fondo"],
  ["icecat:Peso y dimensiones|Peso", "mhd:Peso"],
];
function competingGroups(profile: FamilyProfile) {
  const groups = [...DEFAULT_GROUPS, ...profile.title.key_data.map((item) => item.sources)];
  for (const rule of profile.filters) if (rule.metafield !== "filtro.caracteristicas" && (rule.method === "numero_exacto" || rule.method === "tramos")) groups.push(rule.sources);
  return groups.map((sources) => sources.map((source) => source.toLowerCase()).filter((source) => !source.startsWith("texto:")));
}

export function buildFactSheet(profile: FamilyProfile, values: SourceValues): SourceValues {
  const losers = new Set<string>();
  // Por orden (medidas primero, luego el perfil): una fuente que ya perdió en un grupo no puede ganar en otro, para que
  // dos grupos con el orden cambiado no se anulen entre sí (p. ej. el alto en H01).
  for (const group of competingGroups(profile)) {
    const winner = group.find((source) => values.has(source) && !losers.has(source));
    if (winner) for (const source of group) if (source !== winner) losers.add(source);
  }
  return new Map([...values].filter(([key]) => !losers.has(key) && key !== "texto:descripcion"));
}

// Cifras con unidad: «9 kg», «1400 rpm», «84,5 cm», «0,489 kWh», «80 a 200 °C». Se pasan a una unidad base para comparar
// («59 cm» = «590 mm»). Sin unidad conocida se compara solo el número.
const UNITS: Record<string, [string, number]> = {
  mm: ["m", 0.001], cm: ["m", 0.01], m: ["m", 1], g: ["kg", 0.001], kg: ["kg", 1], ml: ["l", 0.001], l: ["l", 1], litros: ["l", 1],
  w: ["w", 1], kw: ["w", 1000], kwh: ["kwh", 1], wh: ["kwh", 0.001], rpm: ["rpm", 1], db: ["db", 1], "°c": ["c", 1], "ºc": ["c", 1],
  min: ["min", 1], minutos: ["min", 1], h: ["min", 60], horas: ["min", 60], v: ["v", 1], hz: ["hz", 1], "%": ["%", 1], "\"": ["in", 1], pulgadas: ["in", 1],
};
const NUMBER = /(?<![\p{L}\d.,])(\d{1,3}(?:\.\d{3})+|\d+(?:[.,]\d+)?)\s*(mm|cm|m|g|kg|ml|l|litros|w|kw|kwh|wh|rpm|db|°c|ºc|min|minutos|h|horas|v|hz|%|"|pulgadas)?(?![\p{L}\d])/giu;

export function numbersIn(text: string) {
  const found: { raw: string; n: number; unit: string | null; base: number }[] = [];
  for (const match of text.matchAll(NUMBER)) {
    const raw = match[1]; const n = Number(/^\d{1,3}(\.\d{3})+$/.test(raw) ? raw.replaceAll(".", "") : raw.replace(",", "."));
    const unit = match[2]?.toLowerCase() ?? null; const known = unit ? UNITS[unit] : null;
    found.push({ raw: match[0].trim(), n, unit: known ? known[0] : null, base: known ? n * known[1] : n });
  }
  return found;
}

// Cada cifra de los textos tiene que estar en la hoja: con unidad, en la misma magnitud (con un margen de redondeo);
// sin unidad, como número en cualquier dato. Se ignoran los números de 1 a 4 sin unidad («2 o 3 cosas», «4 estantes»
// sí están en la hoja, pero «1» suele ser un artículo o un ordinal).
export function unsupportedNumbers(texts: Record<string, string>, sheet: SourceValues) {
  // Cifras de los valores y de los nombres de los datos («Consumo de energía por 100 ciclos»).
  const known = [...sheet].flatMap(([key, value]) => [...numbersIn(value), ...numbersIn(key.split(":").slice(1).join(":"))]);
  const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.011 * Math.abs(b), 0.0051);
  const problems: string[] = [];
  for (const [field, text] of Object.entries(texts)) {
    const plain = text.replace(/<[^>]+>/g, " ");
    for (const item of numbersIn(plain)) {
      if (!item.unit && item.n <= 4 && Number.isInteger(item.n)) continue;
      const ok = item.unit ? known.some((fact) => fact.unit === item.unit && close(item.base, fact.base)) || known.some((fact) => !fact.unit && close(item.n, fact.n))
        : known.some((fact) => close(item.n, fact.n));
      if (!ok) problems.push(`«${field}» dice «${item.raw}», que no está en la hoja de datos.`);
    }
  }
  return [...new Set(problems)];
}
