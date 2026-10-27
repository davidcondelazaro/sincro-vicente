// Pieza del importador: aplica las reglas deterministas del perfil (filtros, características, más especificaciones)
// a los datos de un producto, y decide los descartes. Funciones puras, sin IA. Ver profile.ts.
import type { IcecatSummary } from "./icecat";
import type { ListingProduct } from "./family";
import type { FamilyProfile, FilterRule, ReviewRule, ValueRule } from "./profile";
import type { MhdProductDetail } from "./sources";

export type SourceValues = Map<string, string>;
export type AppliedValue = { value: string; source: string };
export type AppliedRules = {
  metafields: Record<string, string | string[]>;      // «filtro.capacidad» → «8 kg»; listas → string[]
  origins: Record<string, AppliedValue[]>;           // de dónde sale cada valor
  missing: string[];                                 // reglas sin dato en ninguna fuente
};

// Claves de las fuentes: «mhd:<característica>» e «icecat:<sección>|<característica>», en minúsculas para comparar.
// «texto:descripcion» junta la descripción de MHD y el resumen y destacados de Icecat, para reglas «contiene» que
// buscan nombres comerciales (p. ej. «i-DOS» → Autodosificador).
export function sourceValues(detail: MhdProductDetail | null, icecat: IcecatSummary | null, listing?: { descripcion?: string | null; descripcion_ampliada?: string | null; nombre_subfamilia?: string | null; titulo?: string | null; nombre_marca?: string | null }): SourceValues {
  const values: SourceValues = new Map();
  if (listing?.nombre_subfamilia) values.set("mhd:subfamilia", listing.nombre_subfamilia.trim());
  const text = [listing?.descripcion, listing?.descripcion_ampliada, icecat?.longSummary, ...(icecat?.bulletPoints ?? [])].filter(Boolean).join(" ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (text) values.set("texto:descripcion", text);
  // MHD repite a veces una característica («Color» ×2, «Compatible» ×5): se juntan los valores en vez de quedarse el último.
  for (const feature of detail?.caracteristicas ?? []) {
    if (!feature.nombre || !feature.valor) continue;
    const key = `mhd:${feature.nombre}`.toLowerCase(); const value = feature.valor.trim(); const current = values.get(key);
    values.set(key, !current ? value : current.split(", ").includes(value) ? current : `${current}, ${value}`);
  }
  for (const [group, features] of Object.entries(icecat?.specifications ?? {})) for (const [name, value] of Object.entries(features)) values.set(`icecat:${group}|${name}`.toLowerCase(), value.trim());
  // Categoría y título de Icecat (2026-10-26): para nombrar y para mandar a revisión los productos mal clasificados.
  if (icecat?.category) values.set("icecat:categoria", icecat.category.trim());
  if (icecat?.title) values.set("icecat:titulo", icecat.title.trim());
  if (listing?.titulo?.trim()) values.set("mhd:titulo", listing.titulo.trim());
  if (listing?.nombre_marca?.trim()) values.set("mhd:marca", listing.nombre_marca.trim());
  return values;
}

// Primer número del texto: «8Kg» → 8, «84,5cm» → 84.5, «1.200 rpm» → 1200, «0,461 kWh» → 0.461.
export function firstNumber(text: string) {
  const match = text.match(/\d{1,3}(?:\.\d{3})+(?!\d)|\d+(?:[.,]\d+)?/);
  if (!match) return null;
  const raw = match[0];
  // Coma de miles de MHD («1,600W», «4,000 lúmenes», «2,000 VA»): coma + 3 cifras, sin 0 delante, y una unidad que no
  // se escribe con decimales así. «0,489 kWh» o «1,5 L» siguen siendo decimales.
  const after = text.slice((match.index ?? 0) + raw.length);
  if (/^[1-9]\d{0,2},\d{3}$/.test(raw) && THOUSANDS_UNITS.test(after)) return Number(raw.replace(",", ""));
  return Number(/^\d{1,3}(\.\d{3})+$/.test(raw) ? raw.replaceAll(".", "") : raw.replace(",", "."));
}
const THOUSANDS_UNITS = /^\s*(w|va|lm|l[uú]menes|mah|dpi|ppp|rpm|mbps|tazas|horas|h)(?![\p{L}])/iu;
const formatNumber = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");
const normalize = (text: string) => text.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// «contiene» (decidido 2026-10-23, tras los perfiles de todas las familias): el texto de MHD dice a menudo lo que el
// producto NO tiene («sin grill», «no incluye convección», «Pantalla táctil: No», «prescinde de autoenfoque»). Una
// coincidencia solo cuenta si empieza palabra («ipl» no casa con «múltiples»), no lleva una negación delante en
// la misma frase y no va seguida de «: no».
// «No Frost» no es una negación.
const NEGATION_BEFORE = /(?:^|[^\p{L}])(no(?![\s-]*frost)|sin|ni|carece de|prescinde de|prescindir de|ausencia de|excepto|salvo)(?:[^\p{L}].{0,40})?$/u;
const NEGATION_AFTER = /^\s*(?:[:=-]\s*)?(?:no|n\/a)(?![\p{L}])/u;
export function containsPositive(text: string, needle: string) {
  const haystack = normalize(text); const target = normalize(needle);
  if (!target) return false;
  // Solo se exige el comienzo de palabra: así «ipl» no casa con «múltiples» ni «iones» con «posiciones», y las raíces de
  // los perfiles («inalámbric», «interactiv», «térmic») siguen casando con sus terminaciones.
  const left = /^[\p{L}\d]/u.test(target) ? "(?<![\\p{L}\\d])" : "";
  for (const match of haystack.matchAll(new RegExp(`${left}${escape(target)}`, "gu"))) {
    const start = match.index ?? 0;
    const sentence = haystack.slice(Math.max(0, start - 60), start).split(/[.;!?\n]|\s-\s/).pop() ?? "";
    if (NEGATION_BEFORE.test(sentence)) continue;
    if (NEGATION_AFTER.test(haystack.slice(start + match[0].length, start + match[0].length + 12))) continue;
    return true;
  }
  return false;
}

// `emptyIsSkip`: en los filtros que no son características, una fila o tramo con valor vacío («»: «valor que no vale»)
// no escribe nada y deja paso a la siguiente fuente. En características, «» significa «no se pone» y decide.
// El valor «-» significa «no y se acabó»: no escribe nada y tampoco deja que otra fuente ni otra regla del mismo filtro lo
// rellene (p. ej. WiFi «No» de Icecat que corta el «Sí» erróneo de MHD). En filtros de lista solo corta los valores que esa
// misma regla podía dar («WiFi»), no los demás («Bluetooth»).
export function applyValueRule(rule: Pick<ValueRule, "sources" | "method" | "ranges" | "table"> & { format?: string; min?: string; max?: string }, values: SourceValues, emptyIsSkip = false): AppliedValue | null {
  const bound = (text?: string) => (text?.trim() ? Number(text.replace(",", ".")) : null);
  const min = bound(rule.min); const max = bound(rule.max);
  for (const source of rule.sources) {
    const raw = values.get(source.toLowerCase());
    if (!raw) continue;
    if (rule.method === "texto") return { value: raw, source };
    if (rule.method === "tabla" || rule.method === "contiene") {
      const row = rule.table.find((item) => (rule.method === "tabla" ? normalize(raw) === normalize(item.source) : containsPositive(raw, item.source)));
      if (row && !(emptyIsSkip && !row.value.trim())) return { value: row.value, source };
      continue;
    }
    const n = firstNumber(raw);
    if (n === null || (min !== null && n < min) || (max !== null && n > max)) continue;
    if (rule.method === "numero_exacto") return { value: (rule.format ?? "{n}").replace("{n}", formatNumber(n)), source };
    const limit = (text: string) => (text.trim() === "" ? null : Number(text.replace(",", ".")));
    const range = rule.ranges.find((item) => { const from = limit(item.from); const to = limit(item.to); return (from === null || n >= from) && (to === null || n < to); });
    if (range && !(emptyIsSkip && !range.value.trim())) return { value: range.value, source };
  }
  return null;
}

export function applyProfile(profile: FamilyProfile, values: SourceValues, subfamily?: string | null): AppliedRules {
  const metafields: AppliedRules["metafields"] = {}; const origins: AppliedRules["origins"] = {}; const missing: string[] = [];
  const LISTS = new Set(["filtro.conectividad", "filtro.caracteristicas", "filtro.mas_especificaciones"]);
  const add = (key: string, applied: AppliedValue) => {
    (origins[key] ??= []).push(applied);
    if (LISTS.has(key)) { const list = (metafields[key] ??= []) as string[]; if (!list.includes(applied.value)) list.push(applied.value); }
    else metafields[key] ??= applied.value;
  };
  const applies = (rule: FilterRule) => !rule.subfamilies?.length || Boolean(subfamily && rule.subfamilies.includes(subfamily));
  // El texto solo es respaldo: si una regla de la misma característica tiene dato en MHD o Icecat (aunque sea «No»),
  // la regla que solo mira la descripción no se aplica.
  const textOnly = (rule: FilterRule) => rule.sources.length > 0 && rule.sources.every((source) => source.toLowerCase().startsWith("texto:"));
  // Solo en características: en los demás filtros manda el orden de las reglas (la primera que da valor).
  // Decide la regla estructurada solo si su dato tiene respuesta en la tabla (también una fila «No» → «»): un campo que
  // siempre viene relleno pero no responde a la pregunta («Tipo», «Tipo de quemador») no anula el texto.
  const structured = (rule: FilterRule) => ({ ...rule, sources: rule.sources.filter((source) => !source.toLowerCase().startsWith("texto:")) });
  const decided = new Set(profile.filters.filter((rule) => rule.metafield === "filtro.caracteristicas" && applies(rule) && !textOnly(rule) && applyValueRule(structured(rule), values) !== null).map((rule) => `${rule.metafield}|${rule.label}`));
  const closed = new Set<string>(); // metacampos de un valor cerrados, o «metacampo|valor» en listas
  const isClosed = (key: string, value?: string) => closed.has(key) || (value !== undefined && closed.has(`${key}|${value}`));
  const close = (rule: FilterRule) => {
    if (!LISTS.has(rule.metafield)) { closed.add(rule.metafield); return; }
    const outputs = [...rule.table.map((item) => item.value), ...rule.ranges.map((item) => item.value)].map((value) => value.trim()).filter((value) => value && value !== "-");
    for (const value of rule.metafield === "filtro.caracteristicas" ? [rule.label] : outputs) closed.add(`${rule.metafield}|${value}`);
  };
  for (const rule of profile.filters) {
    if (!applies(rule)) continue;
    if (!LISTS.has(rule.metafield) && isClosed(rule.metafield)) continue;
    if (textOnly(rule) && decided.has(`${rule.metafield}|${rule.label}`)) continue;
    // Características: la primera fuente con dato decide (así MHD manda sobre Icecat); un valor vacío = no se pone.
    if (rule.metafield === "filtro.caracteristicas") {
      const first = rule.sources.find((source) => values.has(source.toLowerCase()));
      const applied = first ? applyValueRule({ ...rule, sources: [first] }, values) : null;
      if (applied?.value.trim() === "-") close(rule);
      else if (applied?.value && !isClosed(rule.metafield, applied.value) && !isClosed(rule.metafield, rule.label)) add(rule.metafield, applied);
      continue;
    }
    const applied = rule.metafield === "filtro.color" ? combinedColor(rule, values) : applyValueRule(rule, values, true);
    // Los filtros de lista (conectividad, características, más especificaciones) no cuentan como «sin dato»: no tener WiFi
    // no es un dato que falte (decidido 2026-10-26). Solo avisan los de un valor.
    if (!applied) { if (!LISTS.has(rule.metafield)) missing.push(rule.label ? `${rule.metafield} (${rule.label})` : rule.metafield); continue; }
    if (applied.value.trim() === "-") { close(rule); continue; }
    if (LISTS.has(rule.metafield) && isClosed(rule.metafield, applied.value)) continue;
    // Más especificaciones: siempre «Dato valor».
    add(rule.metafield, rule.label && !applied.value.toLowerCase().startsWith(rule.label.toLowerCase()) ? { ...applied, value: `${rule.label} ${applied.value}` } : applied);
  }
  // Características combinadas: si sale «Dispensador de agua y hielo», sobran las dos sueltas (decidido 2026-10-23).
  const features = metafields["filtro.caracteristicas"];
  if (Array.isArray(features)) for (const [combined, parts] of COMBINED_FEATURES) if (features.includes(combined)) metafields["filtro.caracteristicas"] = (metafields["filtro.caracteristicas"] as string[]).filter((value) => !parts.includes(value));
  return { metafields, origins, missing };
}
// Color (decidido 2026-10-23): si una fuente posterior trae dos colores y uno es el de la primera («Negro» en MHD,
// «Negro, Acero inoxidable» en Icecat), manda la combinada («Acero inoxidable y negro»); si no, la primera, como siempre.
function combinedColor(rule: FilterRule, values: SourceValues): AppliedValue | null {
  const first = applyValueRule(rule, values, true);
  if (!first) return null;
  const base = normalize(values.get(first.source.toLowerCase()) ?? "");
  for (const source of rule.sources.slice(rule.sources.indexOf(first.source) + 1)) {
    const raw = values.get(source.toLowerCase());
    if (!raw || !raw.includes(",") || !raw.split(",").some((part) => normalize(part) === base)) continue;
    const combined = applyValueRule({ ...rule, sources: [source] }, values, true);
    if (combined) return combined;
  }
  return first;
}
const COMBINED_FEATURES: [string, string[]][] = [["Dispensador de agua y hielo", ["Dispensador de agua", "Dispensador de hielo"]]];

// Cola de revisión del perfil (2026-10-26): un motivo por cada regla que se cumple.
export function reviewReasons(profile: FamilyProfile, values: SourceValues, subfamily?: string | null): string[] {
  const reasons: string[] = [];
  for (const rule of profile.review ?? []) {
    if (rule.subfamilies?.length && !(subfamily && rule.subfamilies.includes(subfamily))) continue;
    if (rule.method === "fuera_de_lista") {
      const source = rule.sources.find((key) => values.has(key.toLowerCase()));
      const value = source ? values.get(source.toLowerCase())! : null;
      if (value && !rule.table.some((row) => containsPositive(value, row.source))) reasons.push(`${rule.label} (${source}: «${value}»)`);
      continue;
    }
    if (rule.method === "distinto") {
      const [first, second] = rule.sources;
      const translate = (source?: string) => { const value = source ? values.get(source.toLowerCase()) : undefined; const row = value ? rule.table.find((item) => containsPositive(value, item.source)) : undefined; return row?.value.trim() ? { value: value!, as: row.value.trim() } : null; };
      const a = translate(first); const b = translate(second);
      if (a && b && a.as !== b.as) reasons.push(`${rule.label} (${first}: «${a.value}»; ${second}: «${b.value}»)`);
      continue;
    }
    const applied = applyValueRule(rule as ReviewRule & { method: "contiene" | "tabla" | "tramos" }, values);
    if (applied && applied.value.trim() && applied.value.trim() !== "-") reasons.push(`${rule.label} (${applied.source}: ${applied.value})`);
  }
  return [...new Set(reasons)];
}

// Descartes (decididos 2026-10-22): sin imagen, se descarta; sin información suficiente ni en MHD ni en Icecat, también.
// Regla de David del 2026-10-24 (docs/FILTROS_DESDE_MHD.md §7.5): tampoco se importan las maquetas, las unidades sueltas de
// aire acondicionado ni los productos de salud sexual.
export function discardReason(listing: ListingProduct & { descripcion?: string | null; cod_familia?: string | null }, detail: MhdProductDetail | null, icecat: IcecatSummary | null): string | null {
  const excluded = exclusionReason(listing);
  if (excluded) return excluded;
  // Sin precio no se publica (David, 2026-10-27: «solo hay que descartar si algo llega con precio 0»).
  if (!(Number(listing.pvp) > 0)) return "Sin precio o con precio 0";
  const photos = detail?.fotos?.length ? detail.fotos : listing.imagen ? [listing.imagen] : [];
  // Sin fotos en MHD pero con galería en Icecat (comprobado que es el mismo modelo), se usan las de Icecat (2026-10-27:
  // se descartaban 223 productos que Icecat tenía con galería completa).
  if (!photos.length && !icecat?.gallery?.length) return "Sin imagen";
  const mhdText = `${listing.descripcion ?? ""} ${listing.descripcion_ampliada ?? ""}`.replace(/<[^>]+>/g, " ").trim();
  const mhdFeatures = detail?.caracteristicas?.length ?? 0;
  const icecatFeatures = Object.values(icecat?.specifications ?? {}).reduce((total, group) => total + Object.keys(group).length, 0);
  if (mhdText.length < 80 && mhdFeatures < 3 && icecatFeatures < 5) return "Sin información suficiente (ni en MHD ni en Icecat)";
  return null;
}

// Exclusiones por tipo de producto (regla de David del 2026-10-24). Maquetas: «DUMMY» o «MAQUETA» en el modelo o el título
// (Samsung «DUMMY S26 MAQUETA»). Salud sexual: subfamilia B1528. Aire acondicionado (familia K01): la unidad exterior o
// interior sola, que el título dice («Unidad exterior») o la descripción nombra como el propio producto con su modelo
// exacto («La unidad interior Daikin XX35…», no uno que solo empiece igual). Los equipos completos también hablan de su
// unidad interior («su unidad interior mide…», «con unidad interior HB35XU0AG», «la unidad exterior completa el
// conjunto») o se venden como «Split 1x1», y esos sí se importan. Ante la duda, no se descarta.
const MOCKUP = /(?<![\p{L}\d])(dummy|maqueta)(?![\p{L}\d])/iu;
const SPLIT_SET = /\b[1-5]\s*x\s*[1-5]\b|conjunto|kit completo|interior y exterior|interior \+ exterior|exterior e interior/i;
export function exclusionReason(listing: { ref_proved: string | null; titulo: string | null; cod_subfamilia: string | null; cod_familia?: string | null; descripcion?: string | null; descripcion_ampliada?: string | null }): string | null {
  if (MOCKUP.test(listing.ref_proved ?? "") || MOCKUP.test(listing.titulo ?? "")) return "Maqueta (DUMMY): no se importa";
  if (listing.cod_subfamilia === "B1528") return "Salud sexual: no se importa";
  if (listing.cod_familia === "K01" || listing.cod_subfamilia?.startsWith("K01")) {
    const title = normalize(listing.titulo ?? "");
    if (/unidad (interior|exterior)/.test(title) && !/interior y exterior|exterior e interior/.test(title)) return "Unidad suelta de aire acondicionado: no se importa";
    // La descripción ampliada de MHD que empieza por «UNIDAD INTERIOR …» o «UNIDAD EXTERIOR …» es la de una unidad sola
    // (Daikin ATXF35F, Daitsu DS-12KTP-6; 2026-10-26): en K01 ningún equipo completo empieza así.
    if (/^unidad (interior|exterior)\b/.test(normalize((listing.descripcion_ampliada ?? "").replace(/<[^>]+>/g, " ")).trim())) return "Unidad suelta de aire acondicionado: no se importa";
    const text = normalize(`${listing.descripcion ?? ""} ${listing.descripcion_ampliada ?? ""}`.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
    const ref = normalize(listing.ref_proved ?? "");
    const self = ref.length >= 4 ? text.match(new RegExp(`(?:^|[.!?]\\s*|\\b(?:la|esta|una|nueva)\\s+)unidad (interior|exterior)\\s+(?:modelo\\s+)?(?:[\\p{L}.-]+\\s+){0,2}${escape(ref)}(?![\\p{L}\\d])`, "u")) : null;
    // Si la descripción habla también de la otra unidad («la unidad exterior completa el conjunto»), es el equipo completo.
    const other = self?.[1] === "interior" ? "exterior" : "interior";
    if (self && !SPLIT_SET.test(title) && !SPLIT_SET.test(text) && !new RegExp(`\\b${other}\\b`).test(text)) return "Unidad suelta de aire acondicionado: no se importa";
  }
  return null;
}
