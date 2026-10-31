// Pieza del importador: la hoja de datos única de un producto (decidida 2026-10-23). La redacción y los revisores solo
// ven esta hoja, no los datos en bruto: para cada dato que el perfil define con varias fuentes (centrifugado, capacidad,
// medidas…) se queda solo el valor de la primera fuente con dato, y el resto se quita. Así la IA nunca ve «1400 rpm» en
// MHD y «1351 rpm» en Icecat a la vez. Además, el código comprueba que cada cifra de los textos está en la hoja.
// Funciones puras, sin IA.
import type { FamilyProfile } from "./profile";
import { firstNumber, type SourceValues } from "./rules";

// Fuentes que compiten por el mismo dato: las de los datos clave del título y las de los filtros numéricos (no las
// características, que mezclan fuentes de distinto tipo, ni el texto libre).
// Medidas y peso: en todas las familias, Icecat (en mm y sin los errores de MHD como «845cm») y, si no, MHD.
const DEFAULT_GROUPS = [
  ["icecat:Peso y dimensiones|Altura", "mhd:Altura", "mhd:Alto"],
  ["icecat:Peso y dimensiones|Ancho", "mhd:Ancho", "mhd:Anchura"],
  ["icecat:Peso y dimensiones|Profundidad", "mhd:Profundidad", "mhd:Fondo"],
  ["icecat:Peso y dimensiones|Peso", "mhd:Peso"],
];
type Group = { sources: string[]; min: number | null; max: number | null };
const bound = (text?: string) => (text?.trim() ? Number(text.replace(",", ".")) : null);
// Las reglas de otras subfamilias no cuentan (su min/max no debe quitar datos de este producto).
function competingGroups(profile: FamilyProfile, subfamily?: string | null): Group[] {
  const groups: Group[] = [...DEFAULT_GROUPS, ...profile.title.key_data.map((item) => item.sources)].map((sources) => ({ sources, min: null, max: null }));
  for (const rule of profile.filters) {
    if (rule.subfamilies?.length && !(subfamily && rule.subfamilies.includes(subfamily))) continue;
    if (rule.metafield !== "filtro.caracteristicas" && (rule.method === "numero_exacto" || rule.method === "tramos")) groups.push({ sources: rule.sources, min: bound(rule.min), max: bound(rule.max) });
  }
  return groups.map((group) => ({ ...group, sources: group.sources.map((source) => source.toLowerCase()).filter((source) => !source.startsWith("texto:")) }));
}

export function buildFactSheet(profile: FamilyProfile, values: SourceValues, subfamily?: string | null): SourceValues {
  const losers = new Set<string>();
  // Por orden (medidas primero, luego el perfil): una fuente que ya perdió en un grupo no puede ganar en otro, para que
  // dos grupos con el orden cambiado no se anulen entre sí (p. ej. el alto en H01). Una fuente con una cifra fuera de los
  // límites de la regla (`min`/`max`, p. ej. «2W» de MHD por 2000 W) no gana y sale de la hoja.
  const groups = competingGroups(profile, subfamily);
  // Primero se quitan las fuentes con cifras fuera de límites en cualquier grupo; después se eligen las ganadoras (si no,
  // una fuente podía ganar en un grupo, caer luego por el límite de otro y dejar el dato sin ninguna fuente).
  // Una fuente cae si tiene límites en alguna regla y no cumple los de ninguna: dos reglas que parten la misma fuente
  // por rangos (p. ej. GB por un lado y TB por otro) no la anulan entre sí.
  const bounded = new Map<string, boolean>(); // fuente → ¿cumple alguna regla con límites?
  for (const group of groups) {
    if (group.min === null && group.max === null) continue;
    for (const source of group.sources) {
      const n = firstNumber(values.get(source) ?? "");
      if (!values.has(source) || n === null) continue;
      const ok = (group.min === null || n >= group.min) && (group.max === null || n <= group.max);
      bounded.set(source, (bounded.get(source) ?? false) || ok);
    }
  }
  for (const [source, ok] of bounded) if (!ok) losers.add(source);
  if (values.has(MHD_WEIGHT) && readWeightKg(values.get(MHD_WEIGHT)!, MHD_RANGE) === null) losers.add(MHD_WEIGHT);
  // Medidas y peso (regla de David del 2026-10-24: si MHD e Icecat no cuadran, manda MHD): Icecat va primero por sus mm,
  // pero si su cifra no cuadra con la de MHD y la de MHD es razonable, gana MHD. Una cifra absurda («845cm» de alto en
  // MHD, «209 kg» en Icecat) no gana nunca si la otra es razonable.
  for (const group of groups.slice(0, DEFAULT_GROUPS.length)) {
    const icecat = group.sources.find((source) => source.startsWith("icecat:") && values.has(source) && !losers.has(source));
    const mhd = group.sources.find((source) => source.startsWith("mhd:") && values.has(source) && !losers.has(source));
    if (!icecat || !mhd) continue;
    const a = measure(values.get(mhd)!); const b = measure(values.get(icecat)!);
    if (!a || !b || a.unit !== b.unit) continue;
    if (!sane(b)) losers.add(icecat);
    else if (!sane(a)) losers.add(mhd);
    else if ((relativeDifference(values.get(mhd)!, values.get(icecat)!) ?? 0) > MAX_DIFFERENCE) losers.add(icecat);
  }
  for (const group of groups) {
    const winner = group.sources.find((source) => values.has(source) && !losers.has(source));
    if (winner) for (const source of group.sources) if (source !== winner) losers.add(source);
  }
  return new Map([...values].filter(([key]) => !losers.has(key) && key !== "texto:descripcion"));
}

// Peso de la variante (corregido 2026-10-31). En «Peso» MHD mezcla gramos escritos como kilos («980Kg» son 980 g, ninguna
// ficha llega de verdad a 100 kg) y la carga máxima de los soportes («Soporta hasta 75 kg»). Manda MHD (David, 2026-10-31);
// Icecat solo entra si MHD no da un peso. De 200 «kg» en adelante son gramos; entre 100 y 200 no se sabe y no se usan.
const MHD_WEIGHT = "mhd:peso";
const ICECAT_WEIGHT = "icecat:peso y dimensiones|peso";
const MHD_RANGE: [number, number] = [0.01, 100]; // «1.12 g» de un proyector son 1,12 kg
const MHD_GRAMS_FROM = 200;
const ICECAT_RANGE: [number, number] = [0.00001, 200]; // Icecat falla poco («209 kg» de un patinete) y hay tarjetas de 0,25 g y frigoríficos de más de 100 kg
const NOT_PRODUCT_WEIGHT = /soporta|capacidad|carga|m[aá]x|hasta|balda/i;

export function readWeightKg(raw: string, [min, max]: [number, number]) {
  if (NOT_PRODUCT_WEIGHT.test(raw)) return null;
  const n = firstNumber(raw);
  if (n === null) return null;
  const kg = /^\D*[\d.,]+\s*(?:g|gr|gramos?)(?![\p{L}])/iu.test(raw) ? n / 1000 : n;
  return kg >= min && kg < max ? Math.round(kg * 10000) / 10000 : null;
}

function mhdWeightKg(raw: string) {
  const kg = readWeightKg(raw, [MHD_RANGE[0], Infinity]);
  return kg !== null && kg >= MHD_GRAMS_FROM ? kg / 1000 : kg !== null && kg < MHD_RANGE[1] ? kg : null;
}

export function productWeightKg(values: SourceValues) {
  const icecat = values.get(ICECAT_WEIGHT); const mhd = values.get(MHD_WEIGHT);
  return (mhd ? mhdWeightKg(mhd) : null) ?? (icecat ? readWeightKg(icecat, ICECAT_RANGE) : null);
}

// Cifras con unidad: «9 kg», «1400 rpm», «84,5 cm», «0,489 kWh», «80 a 200 °C». Se pasan a una unidad base para comparar
// («59 cm» = «590 mm»). Sin unidad conocida se compara solo el número.
const UNITS: Record<string, [string, number]> = {
  mm: ["m", 0.001], cm: ["m", 0.01], m: ["m", 1], km: ["m", 1000], g: ["kg", 0.001], kg: ["kg", 1], ml: ["l", 0.001], l: ["l", 1], litros: ["l", 1],
  w: ["w", 1], kw: ["w", 1000], kwh: ["kwh", 1], wh: ["kwh", 0.001], rpm: ["rpm", 1], db: ["db", 1], "°c": ["c", 1], "ºc": ["c", 1],
  min: ["min", 1], minutos: ["min", 1], h: ["min", 60], horas: ["min", 60], v: ["v", 1], hz: ["hz", 1], "%": ["%", 1], "\"": ["m", 0.0254], "”": ["m", 0.0254], "''": ["m", 0.0254], pulgadas: ["m", 0.0254], pulg: ["m", 0.0254],
  mb: ["gb", 0.001], gb: ["gb", 1], tb: ["gb", 1000], "mb/s": ["mb/s", 1], "gb/s": ["mb/s", 1000], mbps: ["mbps", 1], gbps: ["mbps", 1000], "mbit/s": ["mbps", 1], "gbit/s": ["mbps", 1000],
  mp: ["mp", 1], mah: ["mah", 1], dpi: ["dpi", 1], ppp: ["dpi", 1], va: ["va", 1], kva: ["va", 1000], lm: ["lm", 1], "lúmenes": ["lm", 1],
  // Cola de revisión, 2026-10-27: «12 meses» = «1 año»; licencias, dispositivos y rebanadas no se comparan con otra cosa.
  mes: ["mes", 1], meses: ["mes", 1], "año": ["mes", 12], "años": ["mes", 12], licencia: ["licencia", 1], licencias: ["licencia", 1],
  dispositivo: ["dispositivo", 1], dispositivos: ["dispositivo", 1], usuarios: ["dispositivo", 1], rebanadas: ["rebanada", 1],
  bar: ["bar", 1], "l/min": ["l/min", 1], "l/h": ["l/h", 1], "m³/h": ["m3/h", 1], "m3/h": ["m3/h", 1], "m²": ["m2", 1], m2: ["m2", 1], "l/día": ["l/dia", 1], hojas: ["hojas", 1],
};
// Las unidades largas primero, para que «kwh» no se quede en «kw» ni «mb/s» en «mb».
const UNIT_PATTERN = Object.keys(UNITS).sort((a, b) => b.length - a.length).map((unit) => unit.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")).join("|");
const NUMBER = new RegExp(`(?<![\\p{L}\\d.,])(\\d{1,3}(?:\\.\\d{3})+|\\d+(?:[.,]\\d+)?)\\s*(${UNIT_PATTERN})?(?![\\p{L}\\d])`, "giu");

// Cifras razonables de medidas (en metros) y peso (en kg): fuera de esto, el dato es un error de la fuente.
const SANE: Record<string, [number, number]> = { m: [0.001, 5], kg: [0.001, 500] };
const measure = (text: string) => numbersIn(text).find((item) => item.unit && SANE[item.unit]) ?? null;
const sane = (item: { unit: string | null; base: number }) => { const range = item.unit ? SANE[item.unit] : null; return !range || (item.base >= range[0] && item.base <= range[1]); };

export function numbersIn(text: string) {
  const found: { raw: string; n: number; unit: string | null; base: number }[] = [];
  for (const match of text.matchAll(NUMBER)) {
    const raw = match[1]; const n = firstNumber(match[0]) ?? Number(raw.replace(",", "."));
    const unit = match[2]?.toLowerCase() ?? null; const known = unit ? UNITS[unit] : null;
    found.push({ raw: match[0].trim(), n, unit: known ? known[0] : null, base: known ? n * known[1] : n });
  }
  return found;
}

// Cada cifra de los textos tiene que estar en la hoja: con unidad, en la misma magnitud (con un margen de redondeo);
// sin unidad, como número en cualquier dato. Se ignoran los números de 1 a 4 sin unidad («2 o 3 cosas», «4 estantes»
// sí están en la hoja, pero «1» suele ser un artículo o un ordinal).
// Lo que no son datos y no se comprueba: la marca, el modelo y el nombre comercial (traen cifras: «DH 1655», «Televés
// 435501», «Gran Turismo 7») y las versiones de normas y sistemas («USB 3.2», «HDMI 2.1», «Bluetooth 5.3», «Wi-Fi 6»).
const STANDARDS = /(?<![\p{L}\d])(usb|hdmi|bluetooth|wi-?fi|cat|ddr|lpddr|pcie|pci-e|dvb-t|dvb-s|android|ios|windows|gen|generaci[oó]n|serie|series|ps|xbox|switch|displayport|dp|thunderbolt|sata|nvme|m\.2|lte|[345]g|ip|ipx|vesa|qi)\s*[-.]?\s*\d+(?:[.,]\d+)*(?:\s*(?:x|×)\s*\d+)*/giu;
// Los nombres no se quitan de dentro de una cifra: el «20» de un modelo no puede dejar «20.000 Hz» en «.000 Hz».
export function stripNonData(text: string, names: (string | null | undefined)[]) {
  let plain = text.replace(/<[^>]+>/g, " ");
  const tokens = names.filter((name): name is string => Boolean(name?.trim())).flatMap((name) => [name.trim(), ...name.split(/[\s/,()]+/).filter((token) => /\d/.test(token) && token.length >= 2)]);
  for (const token of [...new Set(tokens)].sort((a, b) => b.length - a.length)) plain = plain.replace(new RegExp(`(?<![\\p{L}\\d])(?<!\\d[.,])${token.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}(?![\\p{L}\\d])(?![.,]\\d)`, "giu"), " ");
  return plain.replace(STANDARDS, " ");
}

export function unsupportedNumbers(texts: Record<string, string>, sheet: SourceValues, names: (string | null | undefined)[] = [], references: (string | null | undefined)[] = []) {
  // Cifras de los valores y de los nombres de los datos («Consumo de energía por 100 ciclos»), y de los textos de MHD e
  // Icecat (2026-10-26, David: el masivo rechazaba «3840 x 2160», «desde 1,9 m» o «154 % DCI-P3» porque solo estaban en
  // la descripción de MHD; 4 de cada 5 rechazos de cifras eran así). El revisor con IA sigue mirando que se usen bien.
  const known = [...[...sheet].flatMap(([key, value]) => [...numbersIn(value), ...numbersIn(key.split(":").slice(1).join(":"))]),
    ...references.flatMap((text) => (text ? numbersIn(text.replace(/<[^>]+>/g, " ")) : []))];
  const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.011 * Math.abs(b), 0.0051);
  const problems: string[] = [];
  for (const [field, text] of Object.entries(texts)) {
    const plain = stripNonData(text, names);
    for (const item of numbersIn(plain)) {
      if (!item.unit && item.n <= 4 && Number.isInteger(item.n)) continue;
      // Misma magnitud; o la misma cifra si la hoja no trae unidad o trae una más corta («16L» para «16 L/día»).
      const ok = item.unit ? known.some((fact) => fact.unit === item.unit && close(item.base, fact.base)) || known.some((fact) => (!fact.unit || item.unit!.startsWith(`${fact.unit}/`)) && close(item.n, fact.n))
        : known.some((fact) => close(item.n, fact.n));
      if (!ok) problems.push(`«${field}» dice «${item.raw}», que no está en la hoja de datos.`);
    }
  }
  return [...new Set(problems)];
}

// Diferencia relativa entre la cifra de MHD y la de Icecat (sobre la de MHD), en la misma magnitud («60cm» frente a
// «598 mm» = 0,3 %). Las cifras enteras de MHD son redondeos («1Kg» frente a «0,25 kg»): menos de una unidad de
// diferencia no cuenta. Sin cifras comparables (distinta magnitud, o una con unidad y otra sin ella): null.
export const MAX_DIFFERENCE = 0.2; // regla de David del 2026-10-24: más de un 20 % va a revisión
// Con varias cifras («800 / 1200 / 1600 PPP», «750W / 1250W / 2000W») vale la que más se acerque. Un 0 es que la
// fuente no tiene el dato (Icecat «0 GB», «0 W»): no se compara (2026-10-27).
export function relativeDifference(mhdText: string, icecatText: string) {
  const all = numbersIn(mhdText); const others = numbersIn(icecatText);
  const b = others[0]; if (!b || !b.n) return null;
  const candidates = all.filter((item) => item.n && item.unit === b.unit);
  if (!candidates.length) return null;
  const differences = candidates.map((a) => singleDifference(a, b));
  return Math.min(...differences);
}
function singleDifference(a: ReturnType<typeof numbersIn>[number], b: ReturnType<typeof numbersIn>[number]) {
  const factor = a.n ? a.base / a.n : 1; // de la unidad de MHD a la base
  const other = b.base / (factor || 1);
  if (Number.isInteger(a.n) && Math.abs(a.n - other) < 1) return 0;
  if (!a.n) return other ? 1 : 0;
  return Math.abs(a.n - other) / Math.abs(a.n);
}

// Datos clave del título y filtros numéricos en los que MHD e Icecat difieren más de un 20 % (para la cola de revisión).
// Solo cuentan los valores dentro de los límites de la regla (`min`/`max`): los absurdos ya se descartan en la hoja.
export function sourceDisagreements(profile: FamilyProfile, values: SourceValues, subfamily?: string | null) {
  const found: { name: string; mhd: string; icecat: string; difference: number }[] = []; const seen = new Set<string>();
  const items = [
    ...profile.title.key_data.map((item) => ({ name: item.name, sources: item.sources, min: null, max: null })),
    ...profile.filters.filter((rule) => rule.metafield !== "filtro.caracteristicas" && (rule.method === "numero_exacto" || rule.method === "tramos") && (!rule.subfamilies?.length || Boolean(subfamily && rule.subfamilies.includes(subfamily))))
      .map((rule) => ({ name: rule.label || rule.metafield, sources: rule.sources, min: bound(rule.min), max: bound(rule.max) })),
  ];
  for (const item of items) {
    const within = (source: string) => { const raw = values.get(source.toLowerCase()); const n = raw ? firstNumber(raw) : null; return n !== null && (item.min === null || n >= item.min) && (item.max === null || n <= item.max); };
    const mhd = item.sources.find((source) => source.toLowerCase().startsWith("mhd:") && within(source));
    const icecat = item.sources.find((source) => source.toLowerCase().startsWith("icecat:") && within(source));
    if (!mhd || !icecat || seen.has(`${mhd}|${icecat}`.toLowerCase())) continue;
    seen.add(`${mhd}|${icecat}`.toLowerCase());
    const a = values.get(mhd.toLowerCase())!; const b = values.get(icecat.toLowerCase())!;
    const difference = relativeDifference(a, b);
    // Misma cifra en otra unidad (MHD escribe «1,45W» por 1,45 kW, o mm por cm): no es una discrepancia del dato, sino del
    // formato de MHD (va en el informe al proveedor); la hoja de datos ya se queda con la cifra que cuadra (2026-10-26).
    const x = firstNumber(a); const y = firstNumber(b);
    const scaled = x && y ? Math.max(x, y) / Math.min(x, y) : 0;
    if ([10, 100, 1000].some((factor) => Math.abs(scaled - factor) <= factor * 0.02)) continue;
    if (difference !== null && difference > MAX_DIFFERENCE) found.push({ name: item.name, mhd: a, icecat: b, difference });
  }
  return found;
}
