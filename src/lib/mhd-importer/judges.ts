// Pieza del importador: los jueces automáticos. Dos modelos independientes (Claude y OpenAI) revisan el perfil de una
// familia (profile.ts) y sus dudas abiertas con el reglamento que David ya aprobó (mhd_importer_decisions, kind =
// 'regla'), la cobertura del perfil con todo el catálogo de MHD y el vocabulario de filtros de la tienda. Los dos
// devuelven la misma salida (esquema JSON). Si coinciden, la duda se cierra sola; si no, la decide David. Nunca se
// cierra nada con un solo juez. No tocan los perfiles. Ver scripts/juzgar-familias.mjs y docs/CALIBRACION_JUECES.md.
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anthropicKey, costUsd, JUDGE_MODEL, type Usage } from "./ai";
import type { ListingProduct } from "./family";
import type { FamilyProfile } from "./profile";
import { applyProfile, applyValueRule, sourceValues } from "./rules";
import type { MhdProductDetail } from "./sources";
import type { FilterVocabulary } from "./store-filters";

export type JudgeName = "claude" | "openai";
export type RegulationRule = { key: string; decision: string; decided_at: string | null };
export type OpenDoubt = { key: string; question: string; recommendation: string | null };
export type Verdict = "aprobar" | "rechazar" | "cambiar";
export type DoubtVerdict = { key: string; verdict: Verdict; decision: string; rules: string[]; confidence: number; reason: string };
export type ProfileProblem = { filter_index: number | null; problem: string; severity: "alta" | "media" | "baja"; fix: string };
export type JudgeOutput = { dudas: DoubtVerdict[]; problemas: ProfileProblem[]; resumen: string };
export type JudgeResult = { judge: JudgeName; model: string; output: JudgeOutput; usage: Usage; costUsd: number | null };
export type JudgeConfig = { anthropic: Anthropic; openai: { apiKey: string; model: string } | null };

export const SINGLE_JUDGE = "un solo juez: sin consenso";
// Para cerrar una duda, además de coincidir en el veredicto, los dos jueces tienen que estar razonablemente seguros.
export const MIN_CONFIDENCE = 0.6;

// Claude siempre; OpenAI solo si hay clave, y entonces el modelo es obligatorio (no se inventa uno por defecto).
export function judgesFromEnv(env: Record<string, string | undefined>): JudgeConfig {
  const anthropic = new Anthropic({ apiKey: anthropicKey(env) });
  if (!env.OPENAI_API_KEY) return { anthropic, openai: null };
  if (!env.OPENAI_JUDGE_MODEL) throw new Error("Hay OPENAI_API_KEY pero falta OPENAI_JUDGE_MODEL (el modelo del juez OpenAI).");
  return { anthropic, openai: { apiKey: env.OPENAI_API_KEY, model: env.OPENAI_JUDGE_MODEL } };
}

// --- Datos de la familia y cobertura (misma lógica que scripts/cobertura-perfil.mjs) ---------------------------------

export type CatalogProduct = { codigo: string; listing: ListingProduct & Record<string, unknown>; detail: MhdProductDetail };

// Productos presentes de la familia con ficha de MHD descargada.
export async function loadFamilyCatalog(db: SupabaseClient, family: string): Promise<CatalogProduct[]> {
  let listings: { codigo: string; source_payload: CatalogProduct["listing"] }[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await db.from("mhd_catalog_products").select("codigo,source_payload").eq("cod_familia", family).eq("presence_status", "present").order("codigo").range(from, from + 499);
    if (error) throw error;
    listings = listings.concat(data);
    if (data.length < 500) break;
  }
  const details = new Map<string, MhdProductDetail>();
  for (let i = 0; i < listings.length; i += 200) {
    const { data, error } = await db.from("mhd_catalog_product_details").select("codigo,source_payload").in("codigo", listings.slice(i, i + 200).map((item) => item.codigo)).not("source_payload", "is", null);
    if (error) throw error;
    for (const item of data) details.set(item.codigo, item.source_payload as MhdProductDetail);
  }
  return listings.flatMap(({ codigo, source_payload: listing }) => { const detail = details.get(codigo); return detail ? [{ codigo, listing, detail }] : []; });
}

export type Coverage = {
  productos: number;
  subfamilias: { codigo: string; nombre: string; productos: number }[];
  filtros: { clave: string; productos: number; porcentaje: number; valores_distintos: number; valores: [string, number][] }[];
  campos_mhd_sin_usar: { campo: string; productos: number; porcentaje: number; valores_distintos: number; valores: [string, number][] }[];
  // Valores de MHD que llegan a una regla (por una de sus fuentes mhd:) y que la regla no traduce: no están en la tabla,
  // no casan con ninguna fila, no traen número o se salen de min/max. Es donde suelen faltar filas o sobrar fuentes.
  valores_sin_traducir: { indice: number; regla: string; fuente: string; productos: number; valores: [string, number][] }[];
};

// Aplica el perfil a todos los productos, solo con MHD (sin Icecat ni IA): por filtro, a cuántos llega y con qué valores;
// y los campos de MHD que trae al menos el 10 % de la familia y que no usa ninguna regla.
export function coverageReport(profile: FamilyProfile, products: CatalogProduct[], maxValues = 15): Coverage {
  const used = new Set(profile.filters.flatMap((rule) => rule.sources.map((source) => source.toLowerCase())));
  for (const item of profile.title?.key_data ?? []) for (const source of item.sources) used.add(source.toLowerCase());
  const filters = new Map<string, Map<string, number>>(); const fields = new Map<string, Map<string, number>>(); const fieldCount = new Map<string, number>();
  const filterCount = new Map<string, number>(); const subfamilies = new Map<string, { nombre: string; productos: number }>();
  for (const rule of profile.filters) { const key = rule.label ? `${rule.metafield} · ${rule.label}` : rule.metafield; filters.set(key, new Map()); filterCount.set(key, 0); }
  const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);
  const untranslated = new Map<string, Map<string, number>>(); // «índice|fuente» → valor → productos
  for (const { listing, detail } of products) {
    const code = String(listing.cod_subfamilia ?? "");
    const sub = subfamilies.get(code) ?? { nombre: String(listing.nombre_subfamilia ?? ""), productos: 0 }; sub.productos += 1; subfamilies.set(code, sub);
    const values = sourceValues(detail, null, { ...listing, descripcion: (detail.descripcion as string | undefined) ?? null });
    for (const [key, value] of values) {
      if (!key.startsWith("mhd:") || key === "mhd:subfamilia") continue;
      bump(fieldCount, key); bump(fields.get(key) ?? fields.set(key, new Map()).get(key)!, value);
    }
    profile.filters.forEach((rule, index) => {
      if (rule.subfamilies?.length && !rule.subfamilies.includes(String(listing.cod_subfamilia ?? ""))) return;
      // Las fuentes se comparan en minúsculas: «mhd:No Frost» y «mhd:No frost» son el mismo dato y se cuentan una vez.
      for (const source of rule.sources.filter((item, i, all) => all.findIndex((other) => other.toLowerCase() === item.toLowerCase()) === i)) {
        const raw = source.toLowerCase().startsWith("mhd:") && source.toLowerCase() !== "mhd:subfamilia" ? values.get(source.toLowerCase()) : undefined;
        // Como en applyProfile: fuera de las características, una fila o tramo con valor vacío no traduce (deja paso).
        if (raw && applyValueRule({ ...rule, sources: [source] }, values, rule.metafield !== "filtro.caracteristicas") === null) { const key = `${index}|${source}`; bump(untranslated.get(key) ?? untranslated.set(key, new Map()).get(key)!, raw); }
      }
    });
    const applied = applyProfile(profile, values, listing.cod_subfamilia);
    for (const [metafield, value] of Object.entries(applied.metafields)) {
      for (const item of Array.isArray(value) ? value : [value]) {
        const rule = profile.filters.find((r) => r.metafield === metafield && (metafield !== "filtro.caracteristicas" || r.label === item) && (!r.label || metafield === "filtro.caracteristicas" || item.startsWith(r.label)));
        const key = rule?.label ? `${metafield} · ${rule.label}` : metafield;
        bump(filterCount, key); bump(filters.get(key) ?? filters.set(key, new Map()).get(key)!, item);
      }
    }
  }
  const total = products.length;
  const pct = (n: number) => Math.round((n * 100) / Math.max(total, 1));
  const top = (map: Map<string, number>) => [...map].sort((a, b) => b[1] - a[1]).slice(0, maxValues);
  return {
    productos: total,
    subfamilias: [...subfamilies].map(([codigo, item]) => ({ codigo, ...item })),
    filtros: [...filters].map(([clave, values]) => ({ clave, productos: filterCount.get(clave) ?? 0, porcentaje: pct(filterCount.get(clave) ?? 0), valores_distintos: values.size, valores: top(values) })),
    campos_mhd_sin_usar: [...fields].filter(([key]) => !used.has(key) && (fieldCount.get(key) ?? 0) >= total * 0.1).sort((a, b) => (fieldCount.get(b[0]) ?? 0) - (fieldCount.get(a[0]) ?? 0))
      .map(([campo, values]) => ({ campo, productos: fieldCount.get(campo) ?? 0, porcentaje: pct(fieldCount.get(campo) ?? 0), valores_distintos: values.size, valores: top(values).slice(0, 8) })),
    valores_sin_traducir: [...untranslated].map(([key, values]) => {
      const [index, fuente] = [Number(key.slice(0, key.indexOf("|"))), key.slice(key.indexOf("|") + 1)]; const rule = profile.filters[index];
      return { indice: index, regla: rule.label ? `${rule.metafield} · ${rule.label}` : rule.metafield, fuente, productos: [...values.values()].reduce((a, b) => a + b, 0), valores: top(values).slice(0, 10) };
    }).sort((a, b) => a.indice - b.indice),
  };
}

// --- Entrada y salida de los jueces ------------------------------------------------------------------------------------

export type JudgeInput = {
  family: { code: string; name: string };
  regulation: RegulationRule[];
  profile: FamilyProfile;
  coverage: Coverage;
  vocabulary: FilterVocabulary;
  doubts: OpenDoubt[];
};

// Vocabulario: definiciones y valores de toda la tienda, más el detalle de los tipos de producto actuales que se
// parecen a la familia (como en analyst.ts).
function vocabularyFor(vocabulary: FilterVocabulary, names: string[]) {
  const stems = names.flatMap((name) => name.toLowerCase().split(/[^a-záéíóúñü]+/)).filter((word) => word.length >= 5).map((word) => word.slice(0, 5));
  return {
    filtros_tienda: vocabulary.definitions.map((definition) => ({ ...definition, valores: vocabulary.values[definition.key] ?? {} })),
    filtros_tipos_parecidos: Object.fromEntries(Object.entries(vocabulary.byProductType).filter(([type]) => stems.some((stem) => type.toLowerCase().includes(stem)))),
  };
}

export function judgePayload(input: JudgeInput) {
  return {
    familia: { codigo: input.family.code, nombre: input.family.name },
    reglamento: input.regulation.map((rule) => ({ clave: rule.key, regla: rule.decision, fecha: rule.decided_at?.slice(0, 10) ?? null })),
    perfil: { ...input.profile, filters: input.profile.filters.map((rule, indice) => ({ indice, ...rule })) },
    cobertura: input.coverage,
    ...vocabularyFor(input.vocabulary, [input.family.name, ...input.coverage.subfamilias.map((item) => item.nombre)]),
    dudas: input.doubts.map((doubt) => ({ clave: doubt.key, pregunta: doubt.question, recomendacion: doubt.recommendation })),
  };
}

const SYSTEM = `Eres un juez independiente del catálogo de Electrónica Vicente, una tienda online española de electrodomésticos y electrónica (Shopify) que importa su catálogo del mayorista MHD. Otro modelo ha escrito el PERFIL de una familia de productos: las reglas que un proceso automático aplica a cada producto para rellenar los filtros (metacampos de Shopify), el título y los textos. Tu trabajo es revisar ese perfil y resolver sus dudas abiertas aplicando el REGLAMENTO que el dueño de la tienda ya aprobó. Otro juez hace lo mismo por separado: si coincidís, la decisión se aplica sin que la vea el dueño; por eso sé riguroso y honesto con tu confianza.

Principios, por este orden:
1. Aplica el reglamento. Cada regla tiene una clave («regla:mhd-manda»…); cita en «rules» las que apliques. No contradigas una regla del reglamento; si un caso no lo cubre ninguna, dilo en «reason» y baja la confianza.
2. Ante la duda, filtro vacío antes que mal. Un producto sin un valor en un filtro es un problema pequeño; un valor equivocado (un integrable que no lo es, una clase energética que no toca) es un problema grave, porque las colecciones y landings comparan el texto literal.
3. Valores nuevos solo de una lista cerrada (filas de tabla o tramos) y con el formato de la tienda: unidad separada por espacio («8 kg», «1400 rpm»), primera letra en mayúscula, tramos abiertos en los extremos («Más de 10 kg»), etiqueta energética «Nueva A»… Nunca texto libre de MHD. Prefiere siempre un valor que la tienda ya usa (te doy el vocabulario con recuentos).
4. Fuentes: solo MHD e Icecat. No uses tu conocimiento de los productos para afirmar datos; apóyate en la cobertura (lo que da el perfil con todo el catálogo de MHD de la familia) y en los campos de MHD sin usar.

Cómo funciona el perfil (lo aplica código, sin IA). Cada regla de «filters» tiene metafield, sources (por orden de preferencia: «mhd:<característica>», «icecat:<sección>|<característica>», «texto:descripcion» = descripción de MHD y resumen de Icecat, «mhd:subfamilia»), method y sus datos:
- numero_exacto: el primer número de la fuente con «format» («{n} kg»).
- tramos: el número en la unidad de la fuente; tramo con from <= n < to; vacío = sin límite.
- tabla: el valor de la fuente se busca en «table» sin distinguir mayúsculas ni tildes; si no está, siguiente fuente.
- contiene: como tabla, pero basta con que el texto contenga la fila (solo en positivo: ignora «sin X», «no X», «X: No»).
- texto: copia tal cual (peligroso: texto libre).
- min y max: números válidos en la unidad de la fuente; fuera de rango se pasa a la siguiente fuente. subfamilies: códigos de subfamilia a los que se aplica (vacío = toda la familia).
- En los filtros de un valor manda la primera regla que da valor. filtro.caracteristicas, filtro.conectividad y filtro.mas_especificaciones son listas.
- filtro.caracteristicas: una regla por característica (nombre en «label»); decide la PRIMERA fuente que tenga dato; un valor vacío en la fila o el tramo = no se pone. Una regla solo con «texto:descripcion» es respaldo y no se aplica si la regla estructurada de la misma característica tiene respuesta. El valor «-» = «no, y que nadie lo rellene».
- filtro.mas_especificaciones: «Dato valor» con el Dato en «label» y el valor en tramos.
La cobertura enseña, por filtro («metacampo» o «metacampo · label»), a cuántos productos de toda la familia llega con solo MHD (Icecat solo puede añadir) y sus valores más repetidos; los campos de MHD que el perfil no usa (con al menos un 10 % de productos); y «valores_sin_traducir»: por regla («indice») y fuente de MHD, los valores que llegan a la regla y no se traducen (no están en la tabla, no traen número o se salen de min y max). Mírala con cuidado: ahí suelen faltar filas que lleven a un valor que la tienda ya usa (variantes de escritura, nombres comerciales, «1» o «Si» por «Sí»), valores erróneos que conviene descartar a propósito («0», «CONFLICTO») o cifras en otra unidad (mm en lugar de cm) que necesitan otra regla con su min y max. No todo valor sin traducir es un problema: un «No» en una característica no pone nada, y es lo correcto.

Qué devuelves:
- «dudas»: exactamente una entrada por cada duda que te paso, con su misma «key» (la «clave» de la duda).
  · verdict «aprobar»: se hace lo que recomienda el borrador, tal cual.
  · verdict «rechazar»: no se hace (se queda como estaba o el filtro vacío).
  · verdict «cambiar»: se hace otra cosa, concreta y aplicable con los métodos del perfil.
  · decision: la decisión concreta, en una o dos frases, lista para el registro (qué valor, qué tramos, qué fuente).
  · rules: claves del reglamento en que te apoyas (vacío si ninguna aplica).
  · confidence: de 0 a 1. Por debajo de 0,6 si la decisión depende de datos que no ves, de gustos del dueño o de negocio.
  · reason: por qué, en una o tres frases, con las cifras de la cobertura cuando las haya.
- «problemas»: los problemas reales del perfil que no son ya una de las dudas, como mucho 15 y los graves primero. Ejemplos: una regla que pone valores con un formato que no es el de la tienda; un valor nuevo que debería ser uno existente; un tramo mal cortado o solapado; una fuente de MHD con un nombre que no casa con la cobertura (filtro al 0 %); un campo de MHD sin usar que da un filtro claro; una característica que tiene casi toda la familia; una regla que contradice el reglamento; un riesgo de poner un valor equivocado. filter_index: el «indice» de la regla en perfil.filters, o null si es del perfil en general (título, textos) o de una regla que falta. severity: «alta» si pone valores equivocados o rompe el reglamento; «media» si deja fuera muchos productos o crea valores innecesarios; «baja» si es de estilo o de poco alcance. fix: el cambio concreto (fuente, fila, tramo o valor). No señales lo que está bien ni repitas el mismo problema con otras palabras; si no hay problemas, lista vacía.
- «resumen»: dos o tres frases sobre el estado del perfil.
Escribe todo en español.`;

const str = { type: "string" };
const obj = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
// Mismo esquema para los dos proveedores (Anthropic json_schema y OpenAI strict): todo obligatorio y sin propiedades extra.
export function judgeSchema() {
  return obj({
    dudas: { type: "array", items: obj({ key: str, verdict: { type: "string", enum: ["aprobar", "rechazar", "cambiar"] }, decision: str, rules: { type: "array", items: str }, confidence: { type: "number" }, reason: str }) },
    problemas: { type: "array", items: obj({ filter_index: { anyOf: [{ type: "integer" }, { type: "null" }] }, problem: str, severity: { type: "string", enum: ["alta", "media", "baja"] }, fix: str }) },
    resumen: str,
  });
}

// El esquema no limita claves ni rangos: se quitan las dudas que no se pidieron, las reglas que no existen y los índices
// fuera del perfil, y la confianza se recorta a [0, 1].
function clean(output: JudgeOutput, input: JudgeInput): JudgeOutput {
  const doubts = new Set(input.doubts.map((doubt) => doubt.key)); const rules = new Set(input.regulation.map((rule) => rule.key)); const seen = new Set<string>();
  return {
    dudas: (output.dudas ?? []).filter((item) => doubts.has(item.key) && !seen.has(item.key) && seen.add(item.key))
      .map((item) => ({ ...item, rules: (item.rules ?? []).filter((key) => rules.has(key)), confidence: Math.min(1, Math.max(0, Number(item.confidence) || 0)) })),
    problemas: (output.problemas ?? []).map((item) => ({ ...item, filter_index: Number.isInteger(item.filter_index) && item.filter_index! >= 0 && item.filter_index! < input.profile.filters.length ? item.filter_index : null })),
    resumen: output.resumen ?? "",
  };
}

function userMessage(input: JudgeInput) {
  return `Perfil, reglamento, cobertura, vocabulario de la tienda y dudas abiertas de la familia (JSON):\n\n${JSON.stringify(judgePayload(input))}\n\nDevuelve tu juicio: un veredicto por cada duda (${input.doubts.length}) y los problemas del perfil.`;
}

export async function judgeWithClaude(client: Anthropic, input: JudgeInput): Promise<JudgeResult> {
  const stream = client.beta.messages.stream({
    model: JUDGE_MODEL,
    max_tokens: 32000,
    // Si el modelo declina por seguridad, la API repite la petición con el modelo de reserva que corresponda.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: { type: "json_schema", schema: judgeSchema() } },
    system: SYSTEM,
    messages: [{ role: "user", content: userMessage(input) }],
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") throw new Error("El juez Claude declinó la petición.");
  if (message.stop_reason === "max_tokens") throw new Error("La respuesta del juez Claude se cortó (max_tokens).");
  const text = message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
  return { judge: "claude", model: message.model, output: clean(JSON.parse(text) as JudgeOutput, input), usage: message.usage, costUsd: costUsd(message.model, message.usage) };
}

// OpenAI sin dependencias: Responses API con salida estructurada estricta.
type OpenAiResponse = {
  model?: string; status?: string; incomplete_details?: { reason?: string } | null; error?: { message?: string } | null;
  output?: { type: string; content?: { type: string; text?: string; refusal?: string }[] }[];
  usage?: { input_tokens: number; output_tokens: number; input_tokens_details?: { cached_tokens?: number } };
};
export async function judgeWithOpenAi(config: { apiKey: string; model: string }, input: JudgeInput): Promise<JudgeResult> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({ model: config.model, instructions: SYSTEM, input: userMessage(input), max_output_tokens: 32000, store: false, text: { format: { type: "json_schema", name: "juicio_familia", strict: true, schema: judgeSchema() } } }),
    signal: AbortSignal.timeout(15 * 60_000),
  });
  const body = await response.json().catch(() => null) as OpenAiResponse | null;
  if (!response.ok || !body) throw new Error(`OpenAI respondió con error (HTTP ${response.status}): ${body?.error?.message?.slice(0, 300) ?? ""}`);
  if (body.status !== "completed") throw new Error(`La respuesta del juez OpenAI no se completó (${body.status}${body.incomplete_details?.reason ? `: ${body.incomplete_details.reason}` : ""}).`);
  const parts = (body.output ?? []).filter((item) => item.type === "message").flatMap((item) => item.content ?? []);
  if (parts.some((part) => part.type === "refusal")) throw new Error("El juez OpenAI declinó la petición.");
  const text = parts.filter((part) => part.type === "output_text").map((part) => part.text ?? "").join("");
  // En OpenAI la entrada incluye la parte en caché: se separa para que el precio (si se añade a ai.ts) no la cuente dos veces.
  const cached = body.usage?.input_tokens_details?.cached_tokens ?? 0;
  const usage: Usage = { input_tokens: (body.usage?.input_tokens ?? 0) - cached, output_tokens: body.usage?.output_tokens ?? 0, cache_read_input_tokens: cached, cache_creation_input_tokens: 0 };
  const model = body.model ?? config.model;
  return { judge: "openai", model, output: clean(JSON.parse(text) as JudgeOutput, input), usage, costUsd: costUsd(model, usage) };
}

// Los dos jueces a la vez, cada uno con su error por separado (si uno falla, el otro cuenta igual, pero sin consenso).
export async function runJudges(config: JudgeConfig, input: JudgeInput) {
  const calls: [JudgeName, Promise<JudgeResult>][] = [["claude", judgeWithClaude(config.anthropic, input)]];
  if (config.openai) calls.push(["openai", judgeWithOpenAi(config.openai, input)]);
  const settled = await Promise.allSettled(calls.map(([, call]) => call));
  const results: JudgeResult[] = []; const errors: { judge: JudgeName; message: string }[] = [];
  settled.forEach((item, index) => { if (item.status === "fulfilled") results.push(item.value); else errors.push({ judge: calls[index][0], message: item.reason instanceof Error ? item.reason.message : String(item.reason) }); });
  return { results, errors, singleJudge: !config.openai };
}

// --- Consenso -----------------------------------------------------------------------------------------------------------

export type Consensus =
  | { status: "cerrar"; decision: string; reason: string }
  | { status: "discrepan" | "un-juez" | "sin-veredicto"; reason: string };

const JUDGE_LABEL: Record<JudgeName, string> = { claude: "Claude", openai: "OpenAI" };
const position = (judge: JudgeName, item: DoubtVerdict) => `${JUDGE_LABEL[judge]}: ${item.verdict} (${Math.round(item.confidence * 100)} %) — ${item.decision} Motivo: ${item.reason}`;

// Se cierra solo si hay dos jueces, los dos dan el mismo veredicto con confianza suficiente y, si el veredicto es
// «cambiar», proponen el mismo cambio (mismo texto): dos «cambiar» con propuestas distintas no son un acuerdo.
export function consensus(key: string, results: JudgeResult[]): Consensus {
  const verdicts = results.flatMap((result) => { const item = result.output.dudas.find((doubt) => doubt.key === key); return item ? [{ judge: result.judge, item }] : []; });
  if (!verdicts.length) return { status: "sin-veredicto", reason: "Ningún juez dio veredicto." };
  if (verdicts.length === 1) return { status: results.length === 1 ? "un-juez" : "sin-veredicto", reason: `${SINGLE_JUDGE}. ${position(verdicts[0].judge, verdicts[0].item)}` };
  const [a, b] = verdicts;
  const same = a.item.verdict === b.item.verdict && (a.item.verdict !== "cambiar" || normalizeText(a.item.decision) === normalizeText(b.item.decision));
  const sure = a.item.confidence >= MIN_CONFIDENCE && b.item.confidence >= MIN_CONFIDENCE;
  if (!same || !sure) {
    const why = a.item.verdict !== b.item.verdict ? "Los jueces discrepan" : !same ? "Los dos proponen cambiar, pero cosas distintas" : "Coinciden, pero con poca confianza";
    return { status: "discrepan", reason: `${why}. ${position(a.judge, a.item)} | ${position(b.judge, b.item)}` };
  }
  const rules = [...new Set([...a.item.rules, ...b.item.rules])];
  return { status: "cerrar", decision: a.item.decision, reason: `Coinciden Claude y OpenAI (${a.item.verdict}). ${a.item.reason}${rules.length ? ` Reglas: ${rules.join(", ")}.` : ""} Otro juez: ${b.item.reason}` };
}
const normalizeText = (text: string) => text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\d]+/gu, " ").trim();
