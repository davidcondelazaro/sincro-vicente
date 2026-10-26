// Aplica el último juicio de cada familia (scripts/juzgar-familias.mjs) con un solo juez, Claude (decidido por David el
// 2026-10-26: «hagamos caso en todo al juez»):
//   1. cierra en el registro las dudas que el juez resolvió (decided_by «juez (Claude)»);
//   2. pide a Claude las operaciones concretas sobre el perfil que corrigen los problemas señalados y aplican los
//      veredictos (sustituir, quitar o añadir reglas, o cambiar una sección), las valida, compara la cobertura antes y
//      después y guarda el perfil. Cada corrección queda en mhd_importer_judgements (purpose «correccion») con el perfil
//      anterior, para ver qué cambió y deshacerlo.
//   node scripts/aplicar-juicio.mjs G20,H40 [--guardar] [--a-la-vez 3]     |     --todas [--guardar]
// Sin --guardar solo enseña lo que haría (y gasta la llamada). Sin API (con subagentes de Claude Code, decidido el
// 2026-10-26 para no pagar por llamada): `--exportar carpeta` deja en carpeta/<familia>.json lo que recibiría el corrector
// y en carpeta/INSTRUCCIONES.md sus instrucciones; el subagente escribe carpeta/<familia>.ops.json ({ ops, notas }) y
// `--ops carpeta --guardar` lo valida y lo aplica igual que si viniera de la API. Necesita SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY de la
// base local; ANTHROPIC_API_KEY de .env.local.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createJiti } from "jiti";
import { createClient } from "@supabase/supabase-js";

try { process.loadEnvFile(new URL("../.env.local", import.meta.url)); } catch { /* sin .env.local: solo el entorno */ }
const jiti = createJiti(import.meta.url);
const { judgePayload, loadFamilyCatalog, coverageReport } = await jiti.import("../src/lib/mhd-importer/judges.ts");
const { JUDGE_MODEL, costUsd, anthropicKey } = await jiti.import("../src/lib/mhd-importer/ai.ts");
const { default: Anthropic } = await import("@anthropic-ai/sdk");

const args = process.argv.slice(2);
const option = (name) => { const at = args.indexOf(name); return at >= 0 ? args.splice(at, 2)[1] : null; };
const flag = (name) => { const at = args.indexOf(name); if (at >= 0) args.splice(at, 1); return at >= 0; };
const save = flag("--guardar"); const all = flag("--todas"); const parallel = Number(option("--a-la-vez") ?? 3);
const exportDir = option("--exportar"); const opsDir = option("--ops");
if (!all && !args.length) { console.error("Uso: node scripts/aplicar-juicio.mjs G20,H40 [--guardar] | --todas [--guardar]"); process.exit(1); }

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const ai = new Anthropic({ apiKey: anthropicKey(process.env) });
const [{ data: regulation, error: regError }, { data: cache, error: cacheError }] = await Promise.all([
  db.from("mhd_importer_decisions").select("key,decision,decided_at").eq("kind", "regla").eq("status", "cerrada").order("key"),
  db.from("mhd_importer_source_cache").select("payload").eq("source", "shopify_filters").eq("source_key", "vocabulary").maybeSingle(),
]);
if (regError) throw regError;
if (cacheError) throw cacheError;
const vocabulary = cache.payload;
const metafields = new Set(vocabulary.definitions.map((definition) => definition.key));
let families = args.flatMap((arg) => arg.split(",")).map((code) => code.trim()).filter(Boolean);
if (all) {
  const { data, error } = await db.from("mhd_importer_family_profiles").select("family_code").not("profile", "is", null).order("family_code");
  if (error) throw error;
  families = data.map((row) => row.family_code);
}

const SYSTEM = `Corriges el PERFIL de una familia de productos de una tienda online de electrodomésticos (Shopify) que importa su catálogo del mayorista MHD. Un juez independiente ya ha revisado el perfil con el reglamento de la tienda: te paso sus problemas («problemas_del_juez») y sus veredictos sobre las dudas («veredictos_del_juez»). Tu trabajo es aplicarlos TODOS, de forma literal y mínima, como operaciones sobre el perfil:
- «aprobar» un veredicto: el perfil tiene que hacer lo que dice su «decision» (a menudo ya lo hace: entonces no hay operación).
- «rechazar»: el perfil NO tiene que hacer lo que proponía la duda (quita o deshaz esa regla o fila).
- «cambiar»: aplica exactamente lo que dice la «decision».
- Cada problema: aplica su «fix». Si un fix ofrece alternativas o pide decidir al dueño, elige la opción más prudente (filtro vacío antes que valor equivocado; valores que la tienda ya usa antes que nuevos) y dilo en «why».
No cambies nada que no pidan el juez o sus veredictos. Respeta el formato del perfil y el reglamento.
Operaciones (los índices son los del perfil que te paso, «indice» de cada regla de filters):
- replace_filter: index = regla a sustituir; value_json = la regla completa nueva (JSON con metafield, label, sources, method, format, ranges, table, note, subfamilies, min, max).
- delete_filter: index = regla a quitar; value_json = "".
- add_filter: index = regla tras la que va la nueva (null = al final); value_json = la regla completa.
- set_section: section = product | title | meta_title | descriptions | subfamily_exceptions | review; value_json = la sección completa nueva, con la misma forma que la actual (review: lista de reglas de revisión, ver ReviewRule en src/lib/mhd-importer/profile.ts).
Cada regla nueva o cambiada lleva en «note» el motivo con la fecha «(juez, 2026-10-26)». En «why» de cada operación, el problema o la duda que resuelve. En «notas», lo que no se haya podido aplicar y por qué.`;
const str = { type: "string" };
const obj = (properties) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const schema = obj({
  ops: { type: "array", items: obj({ op: { type: "string", enum: ["replace_filter", "delete_filter", "add_filter", "set_section"] }, index: { anyOf: [{ type: "integer" }, { type: "null" }] }, section: { type: "string", enum: ["", "product", "title", "meta_title", "descriptions", "subfamily_exceptions", "review"] }, value_json: str, why: str }) },
  notas: str,
});

// Valida una regla de filtro con lo mismo que exige scripts/perfil-familia.mjs.
function filterProblems(rule, subfamilies) {
  const problems = [];
  if (!metafields.has(rule.metafield)) problems.push(`el metacampo ${rule.metafield} no existe`);
  if (!["numero_exacto", "tramos", "tabla", "contiene", "texto"].includes(rule.method)) problems.push(`método ${rule.method} desconocido`);
  for (const key of ["sources", "ranges", "table"]) if (!Array.isArray(rule[key])) problems.push(`«${key}» no es una lista`);
  if (rule.method === "numero_exacto" && !String(rule.format ?? "").includes("{n}")) problems.push("numero_exacto sin {n}");
  for (const code of rule.subfamilies ?? []) if (!subfamilies.has(code)) problems.push(`subfamilia ${code} ajena`);
  return problems;
}
const normalizeFilter = (rule) => ({ label: "", format: "", ranges: [], table: [], note: "", subfamilies: [], min: "", max: "", ...rule });

function applyOps(profile, ops, subfamilies) {
  const errors = []; const replaced = new Map(); const deleted = new Set(); const added = new Map(); const sections = {};
  for (const op of ops) {
    try {
      if (op.op === "delete_filter") { if (!Number.isInteger(op.index) || !profile.filters[op.index]) throw new Error("índice inexistente"); deleted.add(op.index); continue; }
      const value = JSON.parse(op.value_json);
      if (op.op === "set_section") {
        if (!(op.section in profile) && op.section !== "review") throw new Error(`sección ${op.section} desconocida`);
        if (op.section === "review") for (const rule of value) { if (!rule.label || !Array.isArray(rule.sources) || !["contiene", "tabla", "tramos", "fuera_de_lista"].includes(rule.method) || !Array.isArray(rule.table) || !Array.isArray(rule.ranges)) throw new Error(`regla de revisión mal formada: ${JSON.stringify(rule).slice(0, 120)}`); for (const code of rule.subfamilies ?? []) if (!subfamilies.has(code)) throw new Error(`subfamilia ${code} ajena`); }
        sections[op.section] = value; continue;
      }
      const rule = normalizeFilter(value); const problems = filterProblems(rule, subfamilies);
      if (problems.length) throw new Error(problems.join("; "));
      if (op.op === "replace_filter") { if (!Number.isInteger(op.index) || !profile.filters[op.index]) throw new Error("índice inexistente"); replaced.set(op.index, rule); }
      else { const at = Number.isInteger(op.index) ? op.index : profile.filters.length - 1; (added.get(at) ?? added.set(at, []).get(at)).push(rule); }
    } catch (caught) { errors.push(`${op.op}${op.index !== null ? ` #${op.index}` : ""}${op.section ? ` ${op.section}` : ""}: ${caught.message}`); }
  }
  const filters = [];
  if (added.has(-1)) filters.push(...added.get(-1));
  profile.filters.forEach((rule, index) => {
    if (!deleted.has(index)) filters.push(replaced.get(index) ?? rule);
    if (added.has(index)) filters.push(...added.get(index));
  });
  return { profile: { ...profile, ...sections, filters }, errors };
}

const reach = (coverage) => new Map(coverage.filtros.map((item) => [item.clave, item.productos]));
const runId = randomUUID(); let totalCost = 0; const summary = [];
async function applyFamily(family) {
  const { data: last, error: lastError } = await db.from("mhd_importer_judgements").select("run_id,verdict,created_at").eq("purpose", "juicio").eq("judge", "claude").eq("decision_key", `perfil:${family}`).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (lastError) throw lastError;
  if (!last) throw new Error("no tiene juicio");
  const { data: verdictRows, error: verdictError } = await db.from("mhd_importer_judgements").select("decision_key,verdict").eq("run_id", last.run_id).eq("family_code", family).like("decision_key", "duda:%");
  if (verdictError) throw verdictError;
  const verdicts = verdictRows.map((row) => row.verdict);
  const problems = last.verdict.problemas ?? [];

  // 1. Dudas: se cierran con el veredicto del juez.
  let closed = 0;
  if (save && !exportDir) for (const verdict of verdicts) {
    const { data, error } = await db.from("mhd_importer_decisions").update({ status: "cerrada", decided_by: "juez (Claude)", decision: verdict.decision, reason: `${verdict.verdict} (confianza ${Math.round(verdict.confidence * 100)} %): ${verdict.reason}`, rule_key: verdict.rules?.[0] ?? null, contradicts_draft: verdict.verdict !== "aprobar", decided_at: new Date().toISOString() }).eq("key", verdict.key).eq("status", "abierta").select("key");
    if (error) throw error;
    closed += data.length;
  }
  if (!problems.length && !verdicts.some((verdict) => verdict.verdict !== "aprobar")) { summary.push({ family, closed, ops: 0, cost: 0 }); console.log(`■ ${family}: ${closed} dudas cerradas · sin cambios en el perfil\n`); return; }

  // 2. Perfil: operaciones del corrector, validadas.
  const { data: row, error } = await db.from("mhd_importer_family_profiles").select("family_name,profile,status").eq("family_code", family).single();
  if (error) throw error;
  const products = await loadFamilyCatalog(db, family);
  const subfamilies = new Set(products.map((product) => product.listing.cod_subfamilia).filter(Boolean));
  const before = coverageReport(row.profile, products);
  const payload = { ...judgePayload({ family: { code: family, name: row.family_name }, regulation, profile: row.profile, coverage: before, vocabulary, doubts: [] }), problemas_del_juez: problems, veredictos_del_juez: verdicts };
  if (exportDir) {
    writeFileSync(`${exportDir}/${family}.json`, JSON.stringify(payload, null, 1));
    summary.push({ family, closed, ops: 0, cost: 0 }); console.log(`■ ${family}: exportado (${problems.length} problemas, ${verdicts.length} veredictos)`); return;
  }
  let output; let cost = 0; let usage = null; let model = "claude-code (subagente)";
  if (opsDir) {
    const file = `${opsDir}/${family}.ops.json`;
    if (!existsSync(file)) throw new Error(`falta ${file}`);
    output = JSON.parse(readFileSync(file, "utf8"));
  } else {
  const message = await ai.messages.stream({ model: JUDGE_MODEL, max_tokens: 32000, thinking: { type: "adaptive" }, output_config: { effort: "medium", format: { type: "json_schema", schema } }, system: SYSTEM, messages: [{ role: "user", content: `Perfil, juicio y datos de la familia (JSON):\n\n${JSON.stringify(payload)}\n\nDevuelve las operaciones.` }] }).finalMessage();
  if (message.stop_reason !== "end_turn") throw new Error(`el corrector terminó con ${message.stop_reason}`);
  output = JSON.parse(message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join(""));
  cost = costUsd(message.model, message.usage) ?? 0; totalCost += cost; usage = message.usage; model = message.model;
  }
  const { profile, errors } = applyOps(row.profile, output.ops, subfamilies);

  // 3. Cobertura antes y después: avisa de los filtros que pierden más de un 30 % de productos o desaparecen.
  const after = coverageReport(profile, products); const was = reach(before); const now = reach(after);
  const drops = [...was].filter(([key, count]) => count >= 5 && (now.get(key) ?? 0) < count * 0.7).map(([key, count]) => `${key} ${count} → ${now.get(key) ?? 0}`);
  const gains = [...now].filter(([key, count]) => count >= 5 && count > (was.get(key) ?? 0) * 1.3).map(([key, count]) => `${key} ${was.get(key) ?? 0} → ${count}`);
  if (save) {
    const { error: logError } = await db.from("mhd_importer_judgements").insert({ run_id: runId, purpose: "correccion", decision_key: `perfil:${family}`, family_code: family, judge: "claude", model, verdict: { juicio: last.run_id, ops: output.ops, notas: output.notas, errores: errors, bajan: drops, suben: gains, antes: row.profile }, usage, cost_usd: cost });
    if (logError) throw logError;
    const { error: saveError } = await db.from("mhd_importer_family_profiles").update({ profile, updated_at: new Date().toISOString() }).eq("family_code", family);
    if (saveError) throw saveError;
  }
  summary.push({ family, closed, ops: output.ops.length, errors: errors.length, drops: drops.length, cost });
  console.log([`■ ${family} ${row.family_name}: ${closed} dudas cerradas · ${output.ops.length} operaciones${errors.length ? ` (${errors.length} rechazadas)` : ""} · ${cost.toFixed(3)} $${save ? "" : " · sin guardar"}`,
    ...output.ops.map((op) => `  · ${op.op}${op.index !== null ? ` #${op.index}` : ""}${op.section ? ` ${op.section}` : ""}: ${op.why}`),
    ...errors.map((item) => `  ✗ ${item}`), ...(drops.length ? [`  ↓ ${drops.join(" · ")}`] : []), ...(gains.length ? [`  ↑ ${gains.join(" · ")}`] : []),
    ...(output.notas ? [`  Notas: ${output.notas}`] : [])].join("\n") + "\n");
}

if (exportDir) { mkdirSync(exportDir, { recursive: true }); writeFileSync(`${exportDir}/INSTRUCCIONES.md`, `${SYSTEM}\n\nFormato de salida (<familia>.ops.json): { "ops": [{ "op": "replace_filter" | "delete_filter" | "add_filter" | "set_section", "index": número o null, "section": "" | "product" | "title" | "meta_title" | "descriptions" | "subfamily_exceptions", "value_json": "<JSON en texto>", "why": "…" }], "notas": "…" }\n`); }
const queue = [...families];
await Promise.all(Array.from({ length: Math.max(1, parallel) }, async () => {
  while (queue.length) { const family = queue.shift(); try { await applyFamily(family); } catch (caught) { console.log(`✗ ${family}: ${caught?.message ?? caught}\n`); } }
}));
const sum = (key) => summary.reduce((total, item) => total + (item[key] ?? 0), 0);
console.log(`RESUMEN · ${summary.length}/${families.length} familias · ${sum("closed")} dudas cerradas · ${sum("ops")} operaciones (${sum("errors")} rechazadas) · ${sum("drops")} filtros que bajan · ${totalCost.toFixed(3)} $${save ? "" : " · sin guardar"}`);
