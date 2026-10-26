// Calibración de los jueces automáticos (src/lib/mhd-importer/judges.ts) con las revisiones de David. A cada juez se le
// pasa el perfil de antes de la revisión y el reglamento SOLO con las reglas anteriores al 2026-10-24 (las del 24-10
// salieron en parte de esa misma revisión: así no se les da la respuesta), y se comparan los problemas que señalan con
// lo que cambió David (diff regla a regla entre el perfil de antes y el revisado de la base). Una llamada barata
// (MATCHER_MODEL) empareja cada propuesta con los cambios a los que apunta. Escribe el informe en docs/CALIBRACION_JUECES.md.
//   node scripts/calibrar-jueces.mjs --antes <carpeta con antes-revisado-G01.json…> [G01,H01] [--json salida.json]
// Necesita SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY de la base local; las claves de IA se leen de .env.local.
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createJiti } from "jiti";
import { createClient } from "@supabase/supabase-js";

try { process.loadEnvFile(new URL("../.env.local", import.meta.url)); } catch { /* sin .env.local: solo el entorno */ }
const jiti = createJiti(import.meta.url);
const { judgesFromEnv, runJudges, loadFamilyCatalog, coverageReport, SINGLE_JUDGE } = await jiti.import("../src/lib/mhd-importer/judges.ts");
const { MATCHER_MODEL, costUsd } = await jiti.import("../src/lib/mhd-importer/ai.ts");

const CUTOFF = "2026-10-24";
const args = process.argv.slice(2);
const option = (name) => { const at = args.indexOf(name); return at >= 0 ? args.splice(at, 2)[1] : null; };
const beforeDir = option("--antes"); const jsonOut = option("--json");
if (!beforeDir) { console.error("Uso: node scripts/calibrar-jueces.mjs --antes <carpeta> [G01,H01]"); process.exit(1); }
const families = (args[0] ?? "G01,H01").split(",").map((code) => code.trim()).filter(Boolean);

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const judges = judgesFromEnv(process.env);
const single = !judges.openai;
const [{ data: allRules, error: regError }, { data: cache, error: cacheError }] = await Promise.all([
  db.from("mhd_importer_decisions").select("key,decision,decided_at").eq("kind", "regla").eq("status", "cerrada").order("key"),
  db.from("mhd_importer_source_cache").select("payload").eq("source", "shopify_filters").eq("source_key", "vocabulary").maybeSingle(),
]);
if (regError) throw regError;
if (cacheError) throw cacheError;
const regulation = allRules.filter((rule) => rule.decided_at && rule.decided_at.slice(0, 10) < CUTOFF);
console.log(`Calibración · ${families.join(", ")} · reglamento recortado: ${regulation.length} de ${allRules.length} reglas (anteriores al ${CUTOFF}) · ${single ? `Claude (${SINGLE_JUDGE})` : `Claude y OpenAI (${judges.openai.model})`}\n`);

// --- Diff regla a regla ---------------------------------------------------------------------------------------------
// Clave de una regla: metacampo, label y si es de datos o respaldo de texto; con número de aparición si se repite
// (H01 tiene dos reglas de alto y dos de ancho). Los cambios solo en «note» no cuentan (son para la persona que revisa).
const ruleName = (rule) => `${rule.metafield}${rule.label ? ` · ${rule.label}` : ""}${rule.sources.every((source) => source.startsWith("texto:")) ? " (texto)" : ""}`;
function keyed(filters) {
  const seen = new Map();
  return new Map(filters.map((rule, index) => { const name = ruleName(rule); const n = (seen.get(name) ?? 0) + 1; seen.set(name, n); return [n > 1 ? `${name} #${n}` : name, { rule, index }]; }));
}
const row = (item) => `«${item.source}» → «${item.value}»`;
const range = (item) => `[${item.from || "…"}, ${item.to || "…"}) → «${item.value}»`;
const listDiff = (before = [], after = [], show) => {
  const a = before.map(show); const b = after.map(show);
  return { added: b.filter((x) => !a.includes(x)), removed: a.filter((x) => !b.includes(x)) };
};
const short = (rule) => `${rule.method}, fuentes ${rule.sources.join(" / ")}${rule.table.length ? `, tabla ${rule.table.slice(0, 12).map(row).join("; ")}${rule.table.length > 12 ? "…" : ""}` : ""}${rule.ranges.length ? `, tramos ${rule.ranges.map(range).join("; ")}` : ""}${rule.subfamilies?.length ? `, subfamilias ${rule.subfamilies.join(", ")}` : ""}${rule.min || rule.max ? `, min ${rule.min || "—"} max ${rule.max || "—"}` : ""}`;
function diffProfiles(before, after) {
  const changes = []; const a = keyed(before.filters); const b = keyed(after.filters);
  for (const [name, { rule }] of b) {
    const old = a.get(name)?.rule;
    if (!old) { changes.push({ type: "añadida", rule: name, detail: `Regla nueva: ${short(rule)}. Nota de David: ${rule.note}` }); continue; }
    const parts = [];
    for (const [field, show] of [["sources", (x) => x], ["table", row], ["ranges", range], ["subfamilies", (x) => x]]) {
      const { added, removed } = listDiff(old[field] ?? [], rule[field] ?? [], show);
      if (added.length) parts.push(`${field} + ${added.join("; ")}`);
      if (removed.length) parts.push(`${field} − ${removed.join("; ")}`);
    }
    for (const field of ["method", "format", "min", "max"]) if ((old[field] ?? "") !== (rule[field] ?? "")) parts.push(`${field}: «${old[field] ?? ""}» → «${rule[field] ?? ""}»`);
    if (parts.length) changes.push({ type: "cambiada", rule: name, index: a.get(name).index, detail: `${parts.join(" · ")}. Nota de David: ${rule.note}` });
  }
  for (const [name, { rule, index }] of a) if (!b.has(name)) changes.push({ type: "quitada", rule: name, index, detail: `Regla quitada: ${short(rule)}` });
  for (const field of ["product", "title", "meta_title", "descriptions", "subfamily_exceptions"]) {
    if (JSON.stringify(before[field]) !== JSON.stringify(after[field])) changes.push({ type: "cambiada", rule: `perfil.${field}`, detail: `Antes: ${JSON.stringify(before[field]).slice(0, 600)} · Después: ${JSON.stringify(after[field]).slice(0, 600)}` });
  }
  return changes.map((change, i) => ({ id: `c${i + 1}`, ...change }));
}

// --- Emparejar propuestas y cambios (una llamada barata por familia) -------------------------------------------------
const matchSchema = { type: "object", additionalProperties: false, required: ["emparejamientos"], properties: { emparejamientos: { type: "array", items: { type: "object", additionalProperties: false, required: ["propuesta", "cambios", "motivo"], properties: { propuesta: { type: "string" }, cambios: { type: "array", items: { type: "string" } }, motivo: { type: "string" } } } } } };
async function matchProposals(client, family, changes, proposals) {
  if (!changes.length || !proposals.length) return { matches: new Map(), costUsd: 0 };
  const message = await client.messages.create({
    model: MATCHER_MODEL, max_tokens: 8000, output_config: { effort: "medium", format: { type: "json_schema", schema: matchSchema } },
    messages: [{ role: "user", content: `Calibración de jueces automáticos de reglas de filtros de una tienda (familia ${family}). El dueño revisó un perfil de reglas y cambió algunas («cambios»). Unos jueces automáticos, sin ver su revisión, propusieron arreglos al mismo perfil («propuestas»).\n\nPara CADA propuesta, di a qué cambios del dueño corresponde: una propuesta corresponde a un cambio si señala el mismo problema en la misma regla (o la regla que falta) y su arreglo va en la misma dirección que lo que hizo el dueño, aunque no sea idéntico (p. ej. «añadir el color X a la tabla» corresponde a un cambio que añade ese color y otros). No basta con tocar la misma regla si el problema es otro. Una propuesta puede corresponder a varios cambios o a ninguno (lista vacía). En «motivo», una frase en español.\n\nCambios del dueño (JSON):\n${JSON.stringify(changes.map(({ id, rule, type, detail }) => ({ id, regla: rule, tipo: type, detalle: detail })))}\n\nPropuestas de los jueces (JSON):\n${JSON.stringify(proposals.map(({ id, rule, problem, fix }) => ({ id, regla: rule, problema: problem, arreglo: fix })))}` }],
  });
  if (message.stop_reason === "max_tokens") throw new Error("El emparejamiento se cortó (max_tokens).");
  const parsed = JSON.parse(message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join(""));
  const ids = new Set(changes.map((change) => change.id));
  const matches = new Map(parsed.emparejamientos.map((item) => [item.propuesta, { changes: item.cambios.filter((id) => ids.has(id)), reason: item.motivo }]));
  return { matches, costUsd: costUsd(message.model, message.usage) ?? 0 };
}

// --- Calibración ---------------------------------------------------------------------------------------------------
const runId = randomUUID(); const results = []; let totalCost = 0; let unpriced = false;
for (const family of families) {
  const before = JSON.parse(readFileSync(join(beforeDir, `antes-revisado-${family}.json`), "utf8"));
  const { data: row, error } = await db.from("mhd_importer_family_profiles").select("family_name,profile,status,reviewed_by,reviewed_at").eq("family_code", family).maybeSingle();
  if (error) throw error;
  if (row?.status !== "reviewed") throw new Error(`${family}: el perfil de la base no está revisado (status ${row?.status}).`);
  const changes = diffProfiles(before, row.profile);
  const products = await loadFamilyCatalog(db, family);
  const input = { family: { code: family, name: row.family_name }, regulation, profile: before, coverage: coverageReport(before, products), vocabulary: cache.payload, doubts: [] };
  const started = Date.now();
  const { results: verdicts, errors } = await runJudges(judges, input);
  for (const item of errors) console.log(`✗ ${family} · juez ${item.judge}: ${item.message}`);
  const { error: saveError } = await db.from("mhd_importer_judgements").insert(verdicts.map((result) => ({ run_id: runId, purpose: "calibracion", decision_key: `perfil:${family}`, family_code: family, judge: result.judge, model: result.model, verdict: { problemas: result.output.problemas, resumen: result.output.resumen }, usage: result.usage, cost_usd: result.costUsd })));
  if (saveError) throw saveError;
  const proposals = verdicts.flatMap((result) => result.output.problemas.map((problem, i) => ({ id: `${result.judge}-${i + 1}`, judge: result.judge, rule: problem.filter_index === null ? "(general o regla que falta)" : `#${problem.filter_index} ${ruleName(before.filters[problem.filter_index])}`, ...problem })));
  const { matches, costUsd: matchCost } = await matchProposals(judges.anthropic, family, changes, proposals);
  for (const proposal of proposals) Object.assign(proposal, matches.get(proposal.id) ?? { changes: [], reason: "Sin emparejar" });
  const cost = verdicts.reduce((sum, result) => sum + (result.costUsd ?? 0), 0) + matchCost;
  totalCost += cost; if (verdicts.some((result) => result.costUsd === null)) unpriced = true;
  const detectedBy = (judge) => new Set(proposals.filter((p) => p.judge === judge).flatMap((p) => p.changes));
  const claude = detectedBy("claude"); const openai = detectedBy("openai");
  for (const change of changes) change.detected = { claude: claude.has(change.id), openai: openai.has(change.id) };
  results.push({ family, name: row.family_name, reviewedBy: row.reviewed_by, changes, proposals, errors, cost, seconds: Math.round((Date.now() - started) / 1000), judges: verdicts.map((result) => ({ judge: result.judge, model: result.model, costUsd: result.costUsd, usage: result.usage, resumen: result.output.resumen })) });
  const line = (judge, set) => `${judge}: ${set.size}/${changes.length} cambios detectados · ${proposals.filter((p) => p.judge === judge).length} propuestas, ${proposals.filter((p) => p.judge === judge && !p.changes.length).length} sin cambio que les corresponda`;
  console.log(`■ ${family} ${row.family_name}: ${changes.length} cambios de David · ${line("claude", claude)}${single ? "" : ` · ${line("openai", openai)} · los dos: ${changes.filter((c) => c.detected.claude && c.detected.openai).length}`} · ${cost.toFixed(3)} $`);
}

// --- Informe -------------------------------------------------------------------------------------------------------
const judgeNames = single ? ["claude"] : ["claude", "openai"];
const cell = (ok) => (ok ? "sí" : "no");
const md = [];
md.push("# Calibración de los jueces automáticos", "");
md.push(`_Generado por \`scripts/calibrar-jueces.mjs\` el ${new Date().toISOString().slice(0, 10)} (ejecución \`${runId}\`). Se puede repetir: los juicios quedan en \`mhd_importer_judgements\` con \`purpose = 'calibracion'\`._`, "");
md.push("## Cómo se mide", "");
md.push(`- Familias: ${results.map((item) => `${item.family} (${item.name})`).join(", ")}, las que David revisó a mano.`);
md.push(`- Cada juez recibe el perfil **de antes** de la revisión, la cobertura de ese perfil en todo el catálogo de MHD de la familia, el vocabulario de filtros de la tienda y el reglamento **solo con las ${regulation.length} reglas anteriores al ${CUTOFF}** (${regulation.map((rule) => `\`${rule.key}\``).join(", ")}). Las del 24-10 en adelante salieron en parte de esa misma revisión y darían la respuesta.`);
md.push("- Los cambios de David son el diff regla a regla entre el perfil de antes y el revisado (reglas añadidas, quitadas o con cambios en fuentes, tablas, tramos, método, formato, min, max o subfamilias). No cuentan los cambios solo en las notas ni en el orden, ni las dudas (`questions`).");
md.push(`- Una llamada barata (\`${MATCHER_MODEL}\`) empareja cada problema que señala un juez con los cambios de David a los que apunta (mismo problema y arreglo en la misma dirección).`);
md.push(`- Jueces: ${single ? `**solo Claude** (\`${results[0]?.judges[0]?.model ?? "—"}\`): no hay \`OPENAI_API_KEY\` en \`.env.local\`, así que es **${SINGLE_JUDGE}**. Las columnas de OpenAI y de «los dos» quedan pendientes.` : `Claude (\`${results[0]?.judges.find((j) => j.judge === "claude")?.model}\`) y OpenAI (\`${judges.openai.model}\`).`}`, "");
md.push("## Resultado", "");
md.push(`| Familia | Cambios de David | ${judgeNames.map((j) => `Detectados por ${j === "claude" ? "Claude" : "OpenAI"}`).join(" | ")}${single ? "" : " | Por los dos"} | ${judgeNames.map((j) => `Propuestas de ${j === "claude" ? "Claude" : "OpenAI"} (sin cambio que les corresponda)`).join(" | ")} |`);
md.push(`| --- | --- | ${judgeNames.map(() => "---").join(" | ")}${single ? "" : " | ---"} | ${judgeNames.map(() => "---").join(" | ")} |`);
const rowFor = (label, changes, proposals) => `| ${label} | ${changes.length} | ${judgeNames.map((j) => `${changes.filter((c) => c.detected[j]).length}`).join(" | ")}${single ? "" : ` | ${changes.filter((c) => c.detected.claude && c.detected.openai).length}`} | ${judgeNames.map((j) => `${proposals.filter((p) => p.judge === j).length} (${proposals.filter((p) => p.judge === j && !p.changes.length).length})`).join(" | ")} |`;
for (const item of results) md.push(rowFor(item.family, item.changes, item.proposals));
md.push(rowFor("**Total**", results.flatMap((item) => item.changes), results.flatMap((item) => item.proposals)), "");
md.push(`Coste de la calibración: ${totalCost.toFixed(3)} $${unpriced ? " (sin OpenAI: su modelo no tiene precio en `ai.ts`)" : ""}.`, "");
for (const item of results) {
  md.push(`## ${item.family} · ${item.name}`, "");
  md.push("### Cambios de David", "");
  md.push(`| Id | Regla | Tipo | Qué cambió | ${judgeNames.map((j) => (j === "claude" ? "Claude" : "OpenAI")).join(" | ")} |`);
  md.push(`| --- | --- | --- | --- | ${judgeNames.map(() => "---").join(" | ")} |`);
  for (const change of item.changes) md.push(`| ${change.id} | ${change.rule} | ${change.type} | ${change.detail.replace(/\|/g, "/").slice(0, 400)} | ${judgeNames.map((j) => cell(change.detected[j])).join(" | ")} |`);
  md.push("");
  for (const judge of item.judges) {
    md.push(`### Propuestas de ${judge.judge === "claude" ? "Claude" : "OpenAI"} (\`${judge.model}\`, ${judge.costUsd === null ? "coste sin precio" : `${judge.costUsd.toFixed(3)} $`})`, "");
    md.push(`> ${judge.resumen}`, "");
    md.push("| Id | Gravedad | Regla | Problema | Arreglo | Cambio de David |");
    md.push("| --- | --- | --- | --- | --- | --- |");
    for (const p of item.proposals.filter((proposal) => proposal.judge === judge.judge)) md.push(`| ${p.id} | ${p.severity} | ${p.rule} | ${p.problem.replace(/\|/g, "/")} | ${p.fix.replace(/\|/g, "/")} | ${p.changes.length ? p.changes.join(", ") : "ninguno"} |`);
    md.push("");
  }
}
md.push("## Cómo leerlo", "");
md.push("- «Detectados» mide la sensibilidad: de lo que David corrigió, cuánto habría visto el juez solo con el reglamento antiguo y los datos.");
md.push("- Una propuesta «sin cambio que le corresponda» no es necesariamente un error del juez: puede ser algo que David no tocó y que sigue pendiente, o una mejora discutible. Las de gravedad alta merecen una mirada.");
md.push("- Con dos familias y una sola pasada las cifras son orientativas; el modelo no es determinista.", "");
md.push("Repetir:", "", "```bash", `node scripts/calibrar-jueces.mjs --antes <carpeta con antes-revisado-G01.json y antes-revisado-H01.json> G01,H01`, "```", "");
writeFileSync(new URL("../docs/CALIBRACION_JUECES.md", import.meta.url), md.join("\n"));
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({ runId, single, regulation: regulation.map((rule) => rule.key), results }, null, 1));
console.log(`\nInforme en docs/CALIBRACION_JUECES.md · coste ${totalCost.toFixed(3)} $${unpriced ? " (sin OpenAI)" : ""}`);
