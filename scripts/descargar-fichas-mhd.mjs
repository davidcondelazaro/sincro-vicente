// Descarga a la copia local (mhd_importer_source_cache, source «mhd_detail») la ficha de MHD de todos los productos del
// catálogo, de pocos en pocos, para montar el mapa de características por subfamilia. Solo lee de la API de MHD.
// Se puede cortar y relanzar: las fichas de menos de una semana no se vuelven a pedir.
//   node scripts/descargar-fichas-mhd.mjs [concurrencia=4]
// Necesita las variables MHD_* (de .env.local) y SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY de la base local.
import { createJiti } from "jiti";
import { createClient } from "@supabase/supabase-js";

const jiti = createJiti(import.meta.url);
const { mhdConfigFromEnv, fetchMhdProductDetail } = await jiti.import("../src/lib/mhd-importer/sources.ts");
const { cached } = await jiti.import("../src/lib/mhd-importer/cache.ts");
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const config = mhdConfigFromEnv(process.env);
const concurrency = Number(process.argv[2] ?? 4);

let codes = []; for (let from = 0; ; from += 1000) { const { data, error } = await db.from("mhd_catalog_products").select("codigo,cod_familia").range(from, from + 999); if (error) throw error; codes = codes.concat(data.filter((row) => !["S95", "S93"].includes(row.cod_familia)).map((row) => row.codigo)); if (data.length < 1000) break; }
console.log(`${codes.length} productos`);
let done = 0, fetched = 0, errors = 0; const started = Date.now(); const reasons = new Map();
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (codes.length) {
    const codigo = codes.shift();
    try { const result = await cached(db, "mhd_detail", codigo, 24 * 7, () => fetchMhdProductDetail(config, codigo)); if (!result.fromCache) fetched += 1; }
    catch (caught) { errors += 1; const reason = caught.message.replace(/\d{8}/g, "…"); reasons.set(reason, (reasons.get(reason) ?? 0) + 1); }
    done += 1;
    if (done % 500 === 0) console.log(`${done} hechas (${fetched} descargadas, ${errors} errores) · ${Math.round((Date.now() - started) / 1000)} s`);
  }
}));
console.log(`Fin: ${done} (${fetched} descargadas, ${errors} errores) en ${Math.round((Date.now() - started) / 60000)} min`);
for (const [reason, count] of [...reasons].sort((a, b) => b[1] - a[1])) console.log(`  ${count} × ${reason}`);
