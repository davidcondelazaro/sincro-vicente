// Jueces automáticos de los perfiles de familia (src/lib/mhd-importer/judges.ts): Claude y OpenAI revisan, cada uno por
// su lado, el perfil y las dudas abiertas de la familia que les tocan (mhd_importer_decisions, route = 'jueces') con el
// reglamento, la cobertura del perfil en todo el catálogo de MHD y el vocabulario de filtros de la tienda. Una llamada
// por juez y familia. Cada juicio se guarda en mhd_importer_judgements.
//   node scripts/juzgar-familias.mjs G20,H40 [--aplicar] [--a-la-vez 3] [--json salida.json]
//   node scripts/juzgar-familias.mjs --todas [--aplicar]
// Con --aplicar, la duda en la que los dos jueces coinciden (mismo veredicto, confianza suficiente y, si es «cambiar», el
// mismo cambio) se cierra en el registro; si discrepan, se queda abierta y en «reason» van las dos posturas. Nunca se
// cierra nada con un solo juez (sin OPENAI_API_KEY). No modifica los perfiles.
// Necesita SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY de la base local (npx supabase status -o env); ANTHROPIC_API_KEY,
// OPENAI_API_KEY y OPENAI_JUDGE_MODEL se leen de .env.local si no están en el entorno.
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createJiti } from "jiti";
import { createClient } from "@supabase/supabase-js";

try { process.loadEnvFile(new URL("../.env.local", import.meta.url)); } catch { /* sin .env.local: solo el entorno */ }
const jiti = createJiti(import.meta.url);
const { judgesFromEnv, runJudges, consensus, loadFamilyCatalog, coverageReport, SINGLE_JUDGE } = await jiti.import("../src/lib/mhd-importer/judges.ts");

const args = process.argv.slice(2);
const option = (name) => { const at = args.indexOf(name); return at >= 0 ? args.splice(at, 2)[1] : null; };
const flag = (name) => { const at = args.indexOf(name); if (at >= 0) args.splice(at, 1); return at >= 0; };
const apply = flag("--aplicar"); const all = flag("--todas");
const parallel = Number(option("--a-la-vez") ?? 3); const jsonOut = option("--json");
if (!all && !args.length) { console.error("Uso: node scripts/juzgar-familias.mjs G20,H40 [--aplicar] | --todas [--aplicar]"); process.exit(1); }

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const judges = judgesFromEnv(process.env);
const single = !judges.openai;
const [{ data: regulation, error: regError }, { data: cache, error: cacheError }] = await Promise.all([
  db.from("mhd_importer_decisions").select("key,decision,decided_at").eq("kind", "regla").eq("status", "cerrada").order("key"),
  db.from("mhd_importer_source_cache").select("payload").eq("source", "shopify_filters").eq("source_key", "vocabulary").maybeSingle(),
]);
if (regError) throw regError;
if (cacheError) throw cacheError;
if (!cache) throw new Error("No está el vocabulario de filtros en la caché (shopify_filters / vocabulary).");
let families = args.flatMap((arg) => arg.split(",")).map((code) => code.trim()).filter(Boolean);
if (all) {
  const { data, error } = await db.from("mhd_importer_family_profiles").select("family_code").not("profile", "is", null).order("family_code");
  if (error) throw error;
  families = data.map((row) => row.family_code);
}

const runId = randomUUID();
console.log(`${families.length} familias · reglamento de ${regulation.length} reglas · jueces: Claude${single ? ` (${SINGLE_JUDGE})` : ` y OpenAI (${judges.openai.model})`}${apply ? " · --aplicar" : " · sin --aplicar (no se cierra nada)"} · ejecución ${runId}\n`);
if (single && apply) console.log("Aviso: sin OPENAI_API_KEY no hay consenso posible; --aplicar no cerrará ninguna duda.\n");

const report = []; let totalCost = 0; let unpriced = false;
async function judgeFamily(family) {
  const started = Date.now();
  const { data: row, error } = await db.from("mhd_importer_family_profiles").select("family_name,profile,status").eq("family_code", family).maybeSingle();
  if (error) throw error;
  if (!row?.profile) throw new Error("no tiene perfil");
  const { data: doubts, error: doubtsError } = await db.from("mhd_importer_decisions").select("key,question,recommendation").eq("scope", family).eq("kind", "duda").eq("route", "jueces").eq("status", "abierta").order("key");
  if (doubtsError) throw doubtsError;
  const products = await loadFamilyCatalog(db, family);
  const input = { family: { code: family, name: row.family_name }, regulation, profile: row.profile, coverage: coverageReport(row.profile, products), vocabulary: cache.payload, doubts };
  const { results, errors } = await runJudges(judges, input);
  for (const item of errors) console.log(`  ✗ ${family} · juez ${item.judge}: ${item.message}`);
  if (!results.length) throw new Error("ningún juez respondió");

  const rows = results.flatMap((result) => [
    { run_id: runId, purpose: "juicio", decision_key: `perfil:${family}`, family_code: family, judge: result.judge, model: result.model, verdict: { problemas: result.output.problemas, resumen: result.output.resumen }, usage: result.usage, cost_usd: result.costUsd },
    ...result.output.dudas.map((item) => ({ run_id: runId, purpose: "juicio", decision_key: item.key, family_code: family, judge: result.judge, model: result.model, verdict: item })),
  ]);
  const { error: saveError } = await db.from("mhd_importer_judgements").insert(rows);
  if (saveError) throw saveError;

  const outcomes = [];
  for (const doubt of doubts) {
    const outcome = consensus(doubt.key, results);
    outcomes.push({ key: doubt.key, question: doubt.question, ...outcome, verdicts: results.map((result) => ({ judge: result.judge, ...result.output.dudas.find((item) => item.key === doubt.key) })) });
    if (!apply || single) continue;
    if (outcome.status === "cerrar") {
      const verdict = results[0].output.dudas.find((item) => item.key === doubt.key).verdict;
      const { error: closeError } = await db.from("mhd_importer_decisions").update({ status: "cerrada", decided_by: "jueces (Claude + OpenAI)", decision: outcome.decision, reason: outcome.reason, decided_at: new Date().toISOString(), contradicts_draft: verdict !== "aprobar" }).eq("key", doubt.key).eq("status", "abierta");
      if (closeError) throw closeError;
    } else if (outcome.status === "discrepan") {
      const { error: reasonError } = await db.from("mhd_importer_decisions").update({ reason: outcome.reason }).eq("key", doubt.key).eq("status", "abierta");
      if (reasonError) throw reasonError;
    }
  }
  const cost = results.reduce((sum, result) => sum + (result.costUsd ?? 0), 0);
  totalCost += cost; if (results.some((result) => result.costUsd === null)) unpriced = true;
  const entry = { family, name: row.family_name, profileStatus: row.status, products: products.length, seconds: Math.round((Date.now() - started) / 1000), cost, errors, outcomes, judges: results.map((result) => ({ judge: result.judge, model: result.model, costUsd: result.costUsd, usage: result.usage, resumen: result.output.resumen, problemas: result.output.problemas })) };
  report.push(entry);
  printFamily(entry);
}

function printFamily(entry) {
  const count = (status) => entry.outcomes.filter((item) => item.status === status).length;
  const lines = [`■ ${entry.family} ${entry.name} (${entry.profileStatus}, ${entry.products} productos) · ${entry.seconds} s · ${entry.cost.toFixed(3)} $`];
  lines.push(`  Dudas para los jueces: ${entry.outcomes.length}${single ? ` · ${SINGLE_JUDGE}` : ` · acuerdo: ${count("cerrar")}${apply ? " (cerradas)" : " (se cerrarían con --aplicar)"} · discrepan: ${count("discrepan")} · sin veredicto: ${count("sin-veredicto")}`}`);
  for (const item of entry.outcomes) {
    const verdicts = item.verdicts.map((v) => (v.verdict ? `${v.judge} ${v.verdict} ${Math.round(v.confidence * 100)} %` : `${v.judge} —`)).join(" · ");
    lines.push(`  · ${item.key} [${item.status}] ${verdicts}`);
    for (const v of item.verdicts) if (v.verdict) lines.push(`      ${v.judge}: ${v.decision}`);
  }
  for (const judge of entry.judges) {
    const bySeverity = ["alta", "media", "baja"].map((severity) => `${judge.problemas.filter((p) => p.severity === severity).length} ${severity}`).join(", ");
    lines.push(`  Problemas del perfil según ${judge.judge} (${judge.model}): ${judge.problemas.length} (${bySeverity})`);
    for (const problem of judge.problemas.filter((p) => p.severity === "alta")) lines.push(`      [alta] #${problem.filter_index ?? "—"} ${problem.problem} → ${problem.fix}`);
    lines.push(`  Resumen ${judge.judge}: ${judge.resumen}`);
  }
  console.log(`${lines.join("\n")}\n`);
}

const queue = [...families];
await Promise.all(Array.from({ length: Math.max(1, parallel) }, async () => {
  while (queue.length) {
    const family = queue.shift();
    try { await judgeFamily(family); } catch (caught) { console.log(`✗ ${family}: ${caught?.message ?? caught}\n`); }
  }
}));

const outcomes = report.flatMap((entry) => entry.outcomes);
console.log(`RESUMEN · ${report.length}/${families.length} familias juzgadas · ${outcomes.length} dudas · ${single ? SINGLE_JUDGE : `acuerdo ${outcomes.filter((o) => o.status === "cerrar").length}, discrepan ${outcomes.filter((o) => o.status === "discrepan").length}, sin veredicto ${outcomes.filter((o) => o.status === "sin-veredicto").length}`}`);
console.log(`Coste: ${totalCost.toFixed(3)} $${unpriced ? " (sin contar OpenAI: su modelo no tiene precio en ai.ts)" : ""}`);
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ runId, single, apply, report }, null, 1));
