// Cuenta cuántos productos de una familia mandaría a revisión cada regla del apartado `review` de un perfil, con los
// datos de MHD y el Icecat que haya en la copia local (sin red ni IA). Sirve para no escribir reglas que marquen a media
// familia. Con un archivo, usa su `review` (un perfil entero o solo la lista); sin él, el perfil guardado.
//   node scripts/contar-revision.mjs G01 [reglas.json] [--ejemplos 5]
// Necesita SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY de la base local (npx supabase status -o env).
import { readFileSync } from "node:fs";
import { createJiti } from "jiti";
import { createClient } from "@supabase/supabase-js";

const jiti = createJiti(import.meta.url);
const { loadFamilyCatalog } = await jiti.import("../src/lib/mhd-importer/judges.ts");
const { sourceValues, reviewReasons } = await jiti.import("../src/lib/mhd-importer/rules.ts");
const { summarizeIcecat } = await jiti.import("../src/lib/mhd-importer/icecat.ts");
const args = process.argv.slice(2);
const at = args.indexOf("--ejemplos"); const examples = at >= 0 ? Number(args.splice(at, 2)[1]) : 3;
const [family, file] = args;
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data: row, error } = await db.from("mhd_importer_family_profiles").select("profile").eq("family_code", family).single();
if (error) throw error;
const given = file ? JSON.parse(readFileSync(file, "utf8")) : null;
const review = Array.isArray(given) ? given : given?.review ?? row.profile.review ?? [];
const products = await loadFamilyCatalog(db, family);
const eans = products.map((product) => product.listing.codigo_ean).filter(Boolean);
const icecat = new Map();
for (let i = 0; i < eans.length; i += 200) {
  const { data, error: cacheError } = await db.from("mhd_importer_source_cache").select("source_key,payload").eq("source", "icecat").in("source_key", eans.slice(i, i + 200));
  if (cacheError) throw cacheError;
  for (const item of data) icecat.set(item.source_key, summarizeIcecat(item.payload, "es"));
}
const counts = review.map(() => ({ n: 0, examples: [] }));
for (const product of products) {
  const summary = icecat.get(product.listing.codigo_ean) ?? null;
  const values = sourceValues(product.detail, summary, product.listing);
  review.forEach((rule, index) => {
    const reasons = reviewReasons({ filters: [], review: [rule] }, values, product.listing.cod_subfamilia);
    if (!reasons.length) return;
    counts[index].n += 1;
    if (counts[index].examples.length < examples) counts[index].examples.push(`${product.codigo} ${String(product.listing.titulo ?? "").slice(0, 70)} → ${reasons[0]}`);
  });
}
console.log(`${family}: ${products.length} productos, ${icecat.size} con Icecat en la copia local, ${review.length} reglas de revisión`);
review.forEach((rule, index) => {
  console.log(`· [${index}] ${rule.label}: ${counts[index].n} (${products.length ? Math.round((counts[index].n / products.length) * 100) : 0} %)`);
  for (const line of counts[index].examples) console.log(`    ${line}`);
});
