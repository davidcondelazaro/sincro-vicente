// Exporta el registro de decisiones del importador (mhd_importer_decisions) a docs/DECISIONES_IMPORTADOR.md: el
// reglamento, las dudas abiertas por quién las resuelve y las cerradas con su decisión. Se vuelve a generar después de
// cada tanda de decisiones (de David o de los jueces).
//   node scripts/exportar-decisiones.mjs [salida.md]
// Necesita SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY de la base local (npx supabase status -o env).
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const out = process.argv[2] ?? "docs/DECISIONES_IMPORTADOR.md";
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data: rows, error } = await db.from("mhd_importer_decisions").select("*").order("key");
if (error) throw error;

const ROUTES = { negocio: "Negocio o árbol de colecciones (David o Vicente)", jueces: "Para los jueces (Claude + OpenAI)", codigo: "Arreglos de código", producto: "Productos sueltos: revisión a mano o aviso a MHD" };
const day = (value) => (value ? String(value).slice(0, 10) : "");
const byNumber = (a, b) => Number(a.key.split(":").pop()) - Number(b.key.split(":").pop());
const rules = rows.filter((row) => row.kind === "regla");
const doubts = rows.filter((row) => row.kind === "duda");
const lines = [
  "# Decisiones del importador de productos MHD",
  "",
  `_Generado con \`scripts/exportar-decisiones.mjs\` desde la tabla \`mhd_importer_decisions\` (${new Date().toISOString().slice(0, 10)}). No se edita a mano: se cambia el registro y se vuelve a generar._`,
  "",
  `${rules.length} reglas · ${doubts.length} dudas de los perfiles: ${doubts.filter((row) => row.status === "cerrada").length} cerradas y ${doubts.filter((row) => row.status === "abierta").length} abiertas.`,
  "",
  "## Reglamento",
  "",
  ...rules.map((row) => `- **${row.key}** (${row.decided_by}, ${day(row.decided_at)}): ${row.decision}`),
  "",
];
for (const [route, title] of Object.entries(ROUTES)) {
  const open = doubts.filter((row) => row.status === "abierta" && row.route === route).sort(byNumber);
  if (!open.length) continue;
  lines.push(`## Abiertas · ${title} (${open.length})`, "");
  for (const row of open) lines.push(`- **${row.scope} · ${row.key.split(":").pop()}**: ${row.question}${row.recommendation ? ` _Recomendación del borrador:_ ${row.recommendation}` : ""}${row.reason ? ` _Jueces:_ ${row.reason}` : ""}`);
  lines.push("");
}
const closed = doubts.filter((row) => row.status === "cerrada").sort(byNumber);
lines.push(`## Cerradas (${closed.length})`, "");
for (const row of closed) lines.push(`- **${row.scope} · ${row.key.split(":").pop()}**${row.contradicts_draft ? " ⚠️ contra la recomendación del borrador" : ""} (${row.decided_by}${row.rule_key ? `, ${row.rule_key}` : ""}): ${row.decision}`);
writeFileSync(out, `${lines.join("\n")}\n`);
console.log(`${out}: ${rules.length} reglas, ${doubts.length} dudas.`);
