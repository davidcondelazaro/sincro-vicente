// Prueba un perfil de familia con su muestra (sin IA ni Shopify): aplica las reglas del perfil a cada producto de la
// muestra guardada (MHD + Icecat por producto) y enseña los filtros que salen, los que faltan y los datos clave del
// título que quedan en la hoja de datos. Sirve para repasar perfiles con muestras nuevas.
//   node scripts/probar-perfil.mjs G40 [perfil.json]
// Sin archivo, usa el perfil guardado en la base. Necesita SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY de la base local.
import { readFileSync } from "node:fs";
import { createJiti } from "jiti";
import { createClient } from "@supabase/supabase-js";

const jiti = createJiti(import.meta.url);
const { sourceValues, applyProfile } = await jiti.import("../src/lib/mhd-importer/rules.ts");
const { buildFactSheet } = await jiti.import("../src/lib/mhd-importer/facts.ts");
const [family, file] = process.argv.slice(2);
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data: row, error } = await db.from("mhd_importer_family_profiles").select("family_name,profile,analysis_input").eq("family_code", family).maybeSingle();
if (error) throw error;
if (!row?.analysis_input) throw new Error(`La familia ${family} no tiene muestra.`);
const profile = file ? JSON.parse(readFileSync(file, "utf8")) : row.profile;
if (!profile) throw new Error(`La familia ${family} no tiene perfil.`);

console.log(`${family} ${row.family_name}: ${row.analysis_input.sample.length} productos de muestra\n`);
for (const { listing, detail, icecat } of row.analysis_input.sample) {
  const values = sourceValues(detail, icecat, { ...listing, descripcion: detail?.descripcion ?? null });
  const applied = applyProfile(profile, values, listing.cod_subfamilia);
  const sheet = buildFactSheet(profile, values, listing.cod_subfamilia);
  const keyData = profile.title.key_data.map((item) => { const source = item.sources.find((key) => sheet.has(key.toLowerCase())); return `${item.name}=${source ? sheet.get(source.toLowerCase()) : "—"}`; });
  console.log(`· ${listing.codigo} · ${listing.pvp ?? "?"} € · ${listing.nombre_marca} ${listing.ref_proved ?? ""} · ${listing.nombre_subfamilia} · Icecat: ${icecat ? icecat.title : "no"}`);
  console.log(`  MHD: ${(listing.titulo ?? "").slice(0, 110)}`);
  console.log(`  filtros: ${JSON.stringify(applied.metafields)}`);
  if (applied.missing.length) console.log(`  sin dato: ${applied.missing.join(", ")}`);
  console.log(`  datos clave: ${keyData.join(" · ")}\n`);
}
