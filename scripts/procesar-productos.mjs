// Procesa productos de MHD con el importador (Icecat, IA, filtros, fotos) sin tocar Shopify y guarda cada prueba en
// mhd_importer_product_runs, como el botón «Procesar» de /importador-productos, pero desde la terminal y varios a la vez.
// Sirve para pasar el banco de prueba de una o varias familias tras cambiar sus perfiles.
//   node scripts/procesar-productos.mjs [--familias G01,H01 | código código…] [--a-la-vez 4]
// Sin códigos ni familias, procesa todo el banco (mhd_importer_bench_items). Necesita las variables de .env.local
// (MHD_*, ICECAT_*, SHOPIFY_*, ANTHROPIC_API_KEY) y SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_JWT_SECRET de la base
// local: las funciones del importador piden un usuario con sesión, así que el script firma una sesión del primer usuario
// local (solo en local; en producción no hay secreto a mano).
import { createHmac } from "node:crypto";
import { createJiti } from "jiti";
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";

const jiti = createJiti(import.meta.url);
const { processProduct } = await jiti.import("../src/lib/mhd-importer/processor.ts");
const { icecatConfigFromEnv, mhdConfigFromEnv } = await jiti.import("../src/lib/mhd-importer/sources.ts");
const { shopifyConfigFromEnv } = await jiti.import("../src/lib/mhd-importer/store-filters.ts");
const { anthropicKey } = await jiti.import("../src/lib/mhd-importer/ai.ts");

const args = process.argv.slice(2);
const option = (name) => { const at = args.indexOf(name); return at >= 0 ? args.splice(at, 2)[1] : null; };
const families = option("--familias")?.split(",");
const parallel = Number(option("--a-la-vez") ?? 4);
const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data: users, error: usersError } = await admin.auth.admin.listUsers({ perPage: 1 });
if (usersError || !users.users.length) throw new Error("No hay ningún usuario en la base local.");
const user = users.users[0];
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const unsigned = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: user.id, email: user.email, role: "authenticated", aud: "authenticated", iat: now, exp: now + 3600 })}`;
const token = `${unsigned}.${createHmac("sha256", process.env.SUPABASE_JWT_SECRET).update(unsigned).digest("base64url")}`;
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
const deps = { db, config: { mhd: mhdConfigFromEnv(process.env), icecat: icecatConfigFromEnv(process.env), shopify: shopifyConfigFromEnv(process.env) }, ai: new Anthropic({ apiKey: anthropicKey(process.env) }) };

let codes = args;
if (!codes.length) {
  let query = admin.from("mhd_importer_bench_items").select("codigo");
  if (families) query = query.in("family_code", families);
  const { data, error } = await query;
  if (error) throw error;
  codes = data.map((item) => item.codigo);
}
console.log(`${codes.length} productos, ${parallel} a la vez`);
const familyCache = new Map();
const started = Date.now(); let cost = 0;
const queue = [...codes];
await Promise.all(Array.from({ length: parallel }, async () => {
  while (queue.length) {
    const codigo = queue.shift(); const t = Date.now();
    try {
      const { data: listing, error } = await db.rpc("mhd_importer_product", { p_codigo: codigo });
      if (error) throw error;
      if (!listing) throw new Error("no está en MHD");
      if (!familyCache.has(listing.cod_familia)) familyCache.set(listing.cod_familia, Promise.all([
        db.from("mhd_importer_family_profiles").select("profile,status").eq("family_code", listing.cod_familia).maybeSingle(),
        db.rpc("mhd_importer_family_listing", { p_family_code: listing.cod_familia }),
      ]));
      const [{ data: profileRow }, { data: family }] = await familyCache.get(listing.cod_familia);
      const subfamilyEans = (family ?? []).filter((item) => item.cod_subfamilia === listing.cod_subfamilia && item.codigo_ean).map((item) => item.codigo_ean);
      const result = await processProduct(deps, listing, profileRow, subfamilyEans);
      const row = result.status === "ok"
        ? { codigo: listing.codigo, family_code: listing.cod_familia, status: "ok", result: result.product, warnings: result.warnings, model: "claude-haiku-5-5", usage: result.usage, cost_usd: result.costUsd, created_by: user.email }
        : { codigo: listing.codigo, family_code: listing.cod_familia, status: "discarded", discard_reason: result.reason, warnings: result.warnings, created_by: user.email };
      const { data: saved, error: saveError } = await db.from("mhd_importer_product_runs").insert(row).select("id").single();
      if (saveError) throw saveError;
      if (result.status === "ok" && result.media.length) {
        const { error: mediaError } = await db.from("mhd_importer_media").insert(result.media.map((file) => ({ run_id: saved.id, role: file.role, position: file.position, filename: file.filename, content_type: file.contentType, width: file.width, height: file.height, bytes: `\\x${Buffer.from(file.bytes).toString("hex")}`, meta: file.meta })));
        if (mediaError) throw mediaError;
      }
      cost += Number(result.costUsd ?? 0);
      console.log(`✓ ${codigo} ${listing.cod_familia} · ${result.status === "ok" ? result.product?.content?.title ?? "ok" : `descartado: ${result.reason}`} · ${Math.round((Date.now() - t) / 1000)} s`);
    } catch (caught) {
      console.log(`✗ ${codigo}: ${caught?.message ?? caught}`);
    }
  }
}));
console.log(`Fin en ${Math.round((Date.now() - started) / 1000)} s · ${cost.toFixed(3)} $`);
