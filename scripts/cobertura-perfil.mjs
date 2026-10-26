// Cobertura de un perfil con TODO el catálogo de su familia y solo los datos de MHD (sin Icecat ni IA): aplica las
// reglas a cada producto con ficha descargada (mhd_catalog_product_details) y enseña, por filtro, a cuántos productos
// llega, cuántos valores distintos salen y cuáles; y qué campos de MHD de la familia no usa ninguna regla.
// Sirve para rehacer los perfiles como tablas de traducción desde MHD (docs/FILTROS_DESDE_MHD.md).
//   node scripts/cobertura-perfil.mjs G01 [perfil.json] [--json salida.json]
// Sin archivo, usa el perfil guardado en la base. Necesita SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY de la base local.
import { readFileSync, writeFileSync } from "node:fs";
import { createJiti } from "jiti";
import { createClient } from "@supabase/supabase-js";

const jiti = createJiti(import.meta.url);
const { sourceValues, applyProfile } = await jiti.import("../src/lib/mhd-importer/rules.ts");
const args = process.argv.slice(2);
const jsonAt = args.indexOf("--json"); const jsonOut = jsonAt >= 0 ? args.splice(jsonAt, 2)[1] : null;
const [family, file] = args;
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data: row, error } = await db.from("mhd_importer_family_profiles").select("family_name,profile").eq("family_code", family).maybeSingle();
if (error) throw error;
const profile = file ? JSON.parse(readFileSync(file, "utf8")) : row?.profile;
if (!profile) throw new Error(`La familia ${family} no tiene perfil.`);

let products = [];
for (let from = 0; ; from += 500) {
  const { data, error: listError } = await db.from("mhd_catalog_products").select("codigo,source_payload").eq("cod_familia", family).eq("presence_status", "present").order("codigo").range(from, from + 499);
  if (listError) throw listError;
  products = products.concat(data);
  if (data.length < 500) break;
}
const details = new Map();
for (let i = 0; i < products.length; i += 200) {
  const { data, error: detailError } = await db.from("mhd_catalog_product_details").select("codigo,source_payload").in("codigo", products.slice(i, i + 200).map((p) => p.codigo)).not("source_payload", "is", null);
  if (detailError) throw detailError;
  for (const item of data) details.set(item.codigo, item.source_payload);
}

const used = new Set(profile.filters.flatMap((rule) => rule.sources.map((source) => source.toLowerCase())));
for (const item of profile.title?.key_data ?? []) for (const source of item.sources) used.add(source.toLowerCase());
const filters = new Map(); const fields = new Map(); const bySub = new Map(); let total = 0;
for (const { codigo, source_payload: listing } of products) {
  const detail = details.get(codigo);
  if (!detail) continue;
  total += 1;
  bySub.set(listing.cod_subfamilia, (bySub.get(listing.cod_subfamilia) ?? 0) + 1);
  const values = sourceValues(detail, null, { ...listing, descripcion: detail.descripcion ?? null });
  for (const [key, value] of values) {
    if (!key.startsWith("mhd:") || key === "mhd:subfamilia") continue;
    const field = fields.get(key) ?? { n: 0, values: new Map() };
    field.n += 1; field.values.set(value, (field.values.get(value) ?? 0) + 1); fields.set(key, field);
  }
  const applied = applyProfile(profile, values, listing.cod_subfamilia);
  for (const rule of profile.filters) {
    const key = rule.label ? `${rule.metafield} · ${rule.label}` : rule.metafield;
    if (!filters.has(key)) filters.set(key, { n: 0, eligible: 0, values: new Map() });
  }
  for (const [metafield, value] of Object.entries(applied.metafields)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      const rule = profile.filters.find((r) => r.metafield === metafield && (metafield !== "filtro.caracteristicas" || r.label === item) && (!r.label || metafield === "filtro.caracteristicas" || item.startsWith(r.label)));
      const key = rule?.label ? `${metafield} · ${rule.label}` : metafield;
      const entry = filters.get(key) ?? { n: 0, values: new Map() };
      entry.n += 1; entry.values.set(item, (entry.values.get(item) ?? 0) + 1); filters.set(key, entry);
    }
  }
}

const pct = (n) => `${Math.round((n * 100) / Math.max(total, 1))} %`;
const top = (map, k = 12) => [...map].sort((a, b) => b[1] - a[1]).slice(0, k).map(([v, c]) => `${v} (${c})`).join(" | ");
const report = { family, name: row?.family_name, total, subfamilies: Object.fromEntries(bySub), filters: [], unused: [] };
console.log(`${family} ${row?.family_name ?? ""}: ${total} productos con ficha · ${[...bySub].map(([s, n]) => `${s}:${n}`).join(" ")}\n`);
console.log("FILTROS (solo MHD)");
for (const [key, entry] of filters) {
  report.filters.push({ key, n: entry.n, distinct: entry.values.size, values: [...entry.values].sort((a, b) => b[1] - a[1]) });
  console.log(`· ${key}: ${entry.n} (${pct(entry.n)}) · ${entry.values.size} valores${entry.values.size > 100 ? " ⚠ más de 100" : ""}\n    ${top(entry.values)}`);
}
console.log("\nCAMPOS DE MHD QUE NO USA NINGUNA REGLA (≥ 10 % de los productos)");
for (const [key, field] of [...fields].sort((a, b) => b[1].n - a[1].n)) {
  if (used.has(key) || field.n < total * 0.1) continue;
  report.unused.push({ key, n: field.n, distinct: field.values.size, values: [...field.values].sort((a, b) => b[1] - a[1]).slice(0, 15) });
  console.log(`· ${key}: ${field.n} (${pct(field.n)}) · ${field.values.size} valores · ${top(field.values, 8)}`);
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(report, null, 1));
