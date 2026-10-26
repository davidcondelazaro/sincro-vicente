// Vuelca el diccionario común (src/lib/mhd-importer/common.ts: colores y clase energética) en los perfiles de familia
// de la base local. Sin --guardar solo enseña qué cambiaría; con --guardar escribe los perfiles. Un perfil revisado por
// David no se toca salvo con --incluir-revisados. Con --base copia.json, las tablas propias de cada familia salen de esa
// copia de los perfiles (p. ej. la de antes de aplicar el diccionario) en vez de la base, para rehacer el volcado.
//   node scripts/aplicar-diccionario.mjs [G01,H01…] [--guardar] [--incluir-revisados] [--base copia.json]
// Necesita SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY de la base local (npx supabase status -o env).
import { readFileSync } from "node:fs";
import { createJiti } from "jiti";
import { createClient } from "@supabase/supabase-js";

const jiti = createJiti(import.meta.url);
const { applyCommonTables } = await jiti.import("../src/lib/mhd-importer/common.ts");
const args = process.argv.slice(2);
const flag = (name) => { const at = args.indexOf(name); if (at < 0) return false; args.splice(at, 1); return true; };
const save = flag("--guardar"); const includeReviewed = flag("--incluir-revisados");
const baseAt = args.indexOf("--base"); const base = baseAt >= 0 ? JSON.parse(readFileSync(args.splice(baseAt, 2)[1], "utf8")) : null;
// Con copia: las tablas de color y energía de cada regla, de la copia (misma posición y mismo metacampo).
const fromBase = (family, profile) => {
  const old = base?.[family];
  if (!old) return profile;
  return { ...profile, filters: profile.filters.map((rule, index) => (["filtro.color", "features.eficiencia_energ_tica"].includes(rule.metafield) && old.filters[index]?.metafield === rule.metafield ? { ...rule, table: old.filters[index].table } : rule)) };
};
const only = args[0]?.split(",");
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
let query = db.from("mhd_importer_family_profiles").select("family_code,status,profile").not("profile", "is", null).order("family_code");
if (only) query = query.in("family_code", only);
const { data: rows, error } = await query;
if (error) throw error;

let touched = 0; let changedRows = 0;
for (const row of rows) {
  if (row.status === "reviewed" && !includeReviewed) continue;
  const { profile, changes } = applyCommonTables(fromBase(row.family_code, row.profile), row.family_code);
  if (JSON.stringify(profile) === JSON.stringify(row.profile)) continue;
  touched += 1; changedRows += changes.length;
  console.log(`${row.family_code}: ${changes.length ? changes.map((item) => `${item.source} ${item.before} → ${item.after}`).join("; ") : "solo filas nuevas de la tabla común"}`);
  if (save) {
    const { error: saveError } = await db.from("mhd_importer_family_profiles").update({ profile, updated_at: new Date().toISOString() }).eq("family_code", row.family_code);
    if (saveError) throw saveError;
  }
}
console.log(`${touched} perfiles ${save ? "actualizados" : "cambiarían"}; ${changedRows} filas cambian de valor.`);
