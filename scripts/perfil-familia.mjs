// Herramienta para preparar y guardar perfiles de familia fuera de la web (p. ej. desde Claude Code con un modelo
// razonador): `exportar` deja en un archivo la misma entrada que recibe el analista (analystInput: resumen, muestra y
// filtros de la tienda) y `guardar` valida un perfil y lo guarda como borrador en la base local.
//   node scripts/perfil-familia.mjs exportar G40 salida.json
//   node scripts/perfil-familia.mjs guardar G40 perfil.json "claude-opus-5-5 (Claude Code)"
// Necesita SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY de la base local (npx supabase status -o env).
import { readFileSync, writeFileSync } from "node:fs";
import { createJiti } from "jiti";
import { createClient } from "@supabase/supabase-js";

const jiti = createJiti(import.meta.url);
const { analystInput } = await jiti.import("../src/lib/mhd-importer/analyst.ts");
const [action, family, file, model] = process.argv.slice(2);
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data: row, error } = await db.from("mhd_importer_family_profiles").select("family_name,analysis_input").eq("family_code", family).maybeSingle();
if (error) throw error;
if (!row?.analysis_input) throw new Error(`La familia ${family} no tiene muestra: prepárala antes (acción «sample»).`);
const { data: cache, error: cacheError } = await db.from("mhd_importer_source_cache").select("payload").eq("source", "shopify_filters").eq("source_key", "vocabulary").maybeSingle();
if (cacheError) throw cacheError;
const input = analystInput(row.analysis_input.summary, row.analysis_input.sample, cache.payload);

if (action === "exportar") {
  writeFileSync(file, JSON.stringify(input, null, 1));
  console.log(`${family} ${row.family_name}: ${input.muestra.length} productos de muestra, ${input.familia.subfamilias.length} subfamilias → ${file}`);
} else if (action === "guardar") {
  const profile = JSON.parse(readFileSync(file, "utf8"));
  const problems = []; const warnings = [];
  for (const key of ["product", "title", "meta_title", "filters", "descriptions", "subfamily_exceptions", "questions"]) if (!(key in profile)) problems.push(`falta «${key}»`);
  const known = new Set(input.filtros_tienda.map((definition) => definition.key));
  const subfamilies = new Set(input.familia.subfamilias.map((item) => item.code));
  const sources = new Set(["texto:descripcion", "mhd:subfamilia", "mhd:letra_eficiencia", ...(input.caracteristicas_mhd ?? []).map((item) => `mhd:${item.name}`), ...(input.caracteristicas_icecat ?? []).map((item) => `icecat:${item.group}|${item.name}`)].map((source) => source.toLowerCase()));
  for (const [index, rule] of (profile.filters ?? []).entries()) {
    const where = `filtro ${index + 1} (${rule.metafield}${rule.label ? ` · ${rule.label}` : ""})`;
    if (!known.has(rule.metafield)) problems.push(`${where}: el metacampo no existe en la tienda`);
    if (!["numero_exacto", "tramos", "tabla", "contiene", "texto"].includes(rule.method)) problems.push(`${where}: método desconocido`);
    for (const key of ["sources", "ranges", "table"]) if (!Array.isArray(rule[key])) problems.push(`${where}: «${key}» debe ser una lista`);
    for (const source of rule.sources ?? []) if (!sources.has(source.toLowerCase())) warnings.push(`${where}: la fuente «${source}» no aparece en la muestra (revisa que esté bien escrita)`);
    for (const code of rule.subfamilies ?? []) if (!subfamilies.has(code)) problems.push(`${where}: la subfamilia ${code} no es de esta familia`);
    if (rule.method === "numero_exacto" && !String(rule.format ?? "").includes("{n}")) problems.push(`${where}: numero_exacto sin {n} en «format»`);
  }
  if (warnings.length) console.warn(`Avisos:\n- ${warnings.join("\n- ")}`);
  if (problems.length) { console.error(`Perfil NO guardado:\n- ${problems.join("\n- ")}`); process.exit(1); }
  if (process.env.SOLO_VALIDAR) { console.log("Perfil válido (no guardado)."); process.exit(0); }
  const { error: saveError } = await db.from("mhd_importer_family_profiles").update({ profile, status: "draft", model: model ?? "claude-code", usage: null, cost_usd: null, analyzed_at: new Date().toISOString(), reviewed_at: null, reviewed_by: null, updated_at: new Date().toISOString() }).eq("family_code", family);
  if (saveError) throw saveError;
  console.log(`${family} guardado como borrador: ${profile.filters.length} reglas, ${profile.questions.length} dudas.`);
} else { console.error("Uso: exportar|guardar FAMILIA ARCHIVO [MODELO]"); process.exit(1); }
