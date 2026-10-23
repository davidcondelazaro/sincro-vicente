// Pieza del importador: aplica las reglas deterministas del perfil (filtros, características, más especificaciones)
// a los datos de un producto, y decide los descartes. Funciones puras, sin IA. Ver profile.ts.
import type { IcecatSummary } from "./icecat";
import type { ListingProduct } from "./family";
import type { FamilyProfile, FilterRule, ValueRule } from "./profile";
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
export function sourceValues(detail: MhdProductDetail | null, icecat: IcecatSummary | null, listing?: { descripcion?: string | null; descripcion_ampliada?: string | null; nombre_subfamilia?: string | null }): SourceValues {
  const values: SourceValues = new Map();
  if (listing?.nombre_subfamilia) values.set("mhd:subfamilia", listing.nombre_subfamilia.trim());
  const text = [listing?.descripcion, listing?.descripcion_ampliada, icecat?.longSummary, ...(icecat?.bulletPoints ?? [])].filter(Boolean).join(" ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (text) values.set("texto:descripcion", text);
  for (const feature of detail?.caracteristicas ?? []) if (feature.nombre && feature.valor) values.set(`mhd:${feature.nombre}`.toLowerCase(), feature.valor.trim());
  for (const [group, features] of Object.entries(icecat?.specifications ?? {})) for (const [name, value] of Object.entries(features)) values.set(`icecat:${group}|${name}`.toLowerCase(), value.trim());
  return values;
}

// Primer número del texto: «8Kg» → 8, «84,5cm» → 84.5, «1.200 rpm» → 1200, «0,461 kWh» → 0.461.
export function firstNumber(text: string) {
  const match = text.match(/\d{1,3}(?:\.\d{3})+(?!\d)|\d+(?:[.,]\d+)?/);
  if (!match) return null;
  const raw = match[0];
  return Number(/^\d{1,3}(\.\d{3})+$/.test(raw) ? raw.replaceAll(".", "") : raw.replace(",", "."));
}
const formatNumber = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");
const normalize = (text: string) => text.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

export function applyValueRule(rule: Pick<ValueRule, "sources" | "method" | "ranges" | "table"> & { format?: string; min?: string; max?: string }, values: SourceValues): AppliedValue | null {
  const bound = (text?: string) => (text?.trim() ? Number(text.replace(",", ".")) : null);
  const min = bound(rule.min); const max = bound(rule.max);
  for (const source of rule.sources) {
    const raw = values.get(source.toLowerCase());
    if (!raw) continue;
    if (rule.method === "texto") return { value: raw, source };
    if (rule.method === "tabla" || rule.method === "contiene") {
      const row = rule.table.find((item) => (rule.method === "tabla" ? normalize(raw) === normalize(item.source) : normalize(raw).includes(normalize(item.source))));
      if (row) return { value: row.value, source };
      continue;
    }
    const n = firstNumber(raw);
    if (n === null || (min !== null && n < min) || (max !== null && n > max)) continue;
    if (rule.method === "numero_exacto") return { value: (rule.format ?? "{n}").replace("{n}", formatNumber(n)), source };
    const limit = (text: string) => (text.trim() === "" ? null : Number(text.replace(",", ".")));
    const range = rule.ranges.find((item) => { const from = limit(item.from); const to = limit(item.to); return (from === null || n >= from) && (to === null || n < to); });
    if (range) return { value: range.value, source };
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
  for (const rule of profile.filters) {
    if (rule.subfamilies?.length && !(subfamily && rule.subfamilies.includes(subfamily))) continue;
    // Características: la primera fuente con dato decide (así MHD manda sobre Icecat); un valor vacío = no se pone.
    if (rule.metafield === "filtro.caracteristicas") {
      const first = rule.sources.find((source) => values.has(source.toLowerCase()));
      const applied = first ? applyValueRule({ ...rule, sources: [first] }, values) : null;
      if (applied?.value) add(rule.metafield, applied);
      continue;
    }
    const applied = rule.metafield === "filtro.color" ? combinedColor(rule, values) : applyValueRule(rule, values);
    if (!applied) { missing.push(rule.label ? `${rule.metafield} (${rule.label})` : rule.metafield); continue; }
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
  const first = applyValueRule(rule, values);
  if (!first) return null;
  const base = normalize(values.get(first.source.toLowerCase()) ?? "");
  for (const source of rule.sources.slice(rule.sources.indexOf(first.source) + 1)) {
    const raw = values.get(source.toLowerCase());
    if (!raw || !raw.includes(",") || !raw.split(",").some((part) => normalize(part) === base)) continue;
    const combined = applyValueRule({ ...rule, sources: [source] }, values);
    if (combined) return combined;
  }
  return first;
}
const COMBINED_FEATURES: [string, string[]][] = [["Dispensador de agua y hielo", ["Dispensador de agua", "Dispensador de hielo"]]];

// Descartes (decididos 2026-10-22): sin imagen, se descarta; sin información suficiente ni en MHD ni en Icecat, también.
export function discardReason(listing: ListingProduct & { descripcion?: string | null }, detail: MhdProductDetail | null, icecat: IcecatSummary | null): string | null {
  const photos = detail?.fotos?.length ? detail.fotos : listing.imagen ? [listing.imagen] : [];
  if (!photos.length) return "Sin imagen";
  const mhdText = `${listing.descripcion ?? ""} ${listing.descripcion_ampliada ?? ""}`.replace(/<[^>]+>/g, " ").trim();
  const mhdFeatures = detail?.caracteristicas?.length ?? 0;
  const icecatFeatures = Object.values(icecat?.specifications ?? {}).reduce((total, group) => total + Object.keys(group).length, 0);
  if (mhdText.length < 80 && mhdFeatures < 3 && icecatFeatures < 5) return "Sin información suficiente (ni en MHD ni en Icecat)";
  return null;
}
