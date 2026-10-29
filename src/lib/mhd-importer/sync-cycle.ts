import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anthropicKey, PROCESSOR_MODEL } from "./ai";
import { sendAlert } from "./alerts";
import type { SourcesConfig } from "./gather";
import { syncPriceStock } from "./price-stock-sync";
import { shopifyGraphql } from "./store-filters";

// Vuelta de sincronización con MHD (David, 2026-10-29; diseño en docs/SINCRONIZACIONES_MHD.md). La abre pg_cron cada 30
// minutos (mhd_sync_cycle_start) y la base llama a la ruta /api/sincronizaciones/vuelta en dos momentos:
//   «inicio»: se comprueban las conexiones (si alguna falla, aviso y la vuelta se para) y se lanza la lectura del listado;
//   «continuar»: al acabar la lectura, los pasos en orden (hoy precio y stock; después altas, bajas y cambios).
// Cada paso queda en mhd_sync_cycles.steps con su inicio, fin, cifras y error; de ahí salen el resumen diario y utils.
type StepStatus = "ok" | "error" | "saltado";
export type CycleStep = { name: string; started_at: string; finished_at?: string; status?: StepStatus; counts?: Record<string, unknown>; error?: string };
type Cycle = { id: string; status: string; read_run_id: string | null; steps: CycleStep[] };
type Deps = { db: SupabaseClient; sources: SourcesConfig; env: Record<string, string | undefined> };

async function loadCycle(db: SupabaseClient, id: string) {
  const { data, error } = await db.from("mhd_sync_cycles").select("id,status,read_run_id,steps").eq("id", id).single();
  if (error) throw error;
  return data as Cycle;
}

async function saveCycle(db: SupabaseClient, cycle: Cycle, patch: Record<string, unknown> = {}) {
  await db.from("mhd_sync_cycles").update({ steps: cycle.steps, ...patch }).eq("id", cycle.id);
}

// Un paso: se apunta al empezar, se cierra con su resultado y, si falla, se guarda el error y se relanza.
async function step<T extends Record<string, unknown>>(db: SupabaseClient, cycle: Cycle, name: string, run: () => Promise<T>) {
  const entry: CycleStep = { name, started_at: new Date().toISOString() };
  cycle.steps.push(entry); await saveCycle(db, cycle);
  try {
    const counts = await run();
    Object.assign(entry, { finished_at: new Date().toISOString(), status: counts.skipped ? "saltado" : "ok", counts });
    return counts;
  } catch (caught) {
    Object.assign(entry, { finished_at: new Date().toISOString(), status: "error", error: caught instanceof Error ? caught.message : String(caught) });
    throw caught;
  } finally { await saveCycle(db, cycle); }
}

async function finish(db: SupabaseClient, cycle: Cycle, status: "terminada" | "fallida" | "parada", error?: string) {
  await saveCycle(db, cycle, { status, finished_at: new Date().toISOString(), error: error ?? null });
}

// Conexiones: una consulta mínima a cada servicio. La de Anthropic es una respuesta de 1 token con el modelo barato
// (~0,00001 $), que es la forma de saber que la clave vale y que queda crédito. Solo Shopify y MHD son imprescindibles
// para la vuelta (`critical`); Anthropic e Icecat hacen falta para procesar fichas y Resend para los correos: si fallan
// se avisa (Resend no puede avisarse a sí mismo: queda en rojo en Inicio) pero la vuelta sigue (David, 2026-10-29).
export async function checkConnections(sources: SourcesConfig, env: Record<string, string | undefined>) {
  const timed = async (name: string, critical: boolean, check: () => Promise<unknown>) => {
    const started = Date.now();
    try { await check(); return { name, critical, ok: true, ms: Date.now() - started }; }
    catch (caught) { return { name, critical, ok: false, ms: Date.now() - started, error: caught instanceof Error ? caught.message : String(caught) }; }
  };
  const mhd = sources.mhd; const icecat = sources.icecat;
  return Promise.all([
    timed("Shopify", true, () => shopifyGraphql(sources.shopify, "{ shop { id } }")),
    timed("MHD", true, async () => {
      const url = `${mhd.url.replace(/\/$/, "")}/api/${mhd.version.replace(/^\/+|\/+$/g, "")}/${mhd.subPath.replace(/^\/+|\/+$/g, "")}/categories?page=1&pageSize=1`;
      const response = await fetch(url, { headers: { Accept: "application/json", Authorization: `Basic ${btoa(`${mhd.user}:${mhd.pass}`)}` }, signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`MHD respondió HTTP ${response.status}`);
    }),
    timed("Anthropic", false, async () => {
      const client = new Anthropic({ apiKey: anthropicKey(env), maxRetries: 1 });
      await client.messages.create({ model: PROCESSOR_MODEL, max_tokens: 1, messages: [{ role: "user", content: "ok" }] });
    }),
    // Icecat como la comprobación de utils (/api/health): un producto de Full Icecat que solo contesta a la IP autorizada.
    timed("Icecat", false, async () => {
      const query = new URLSearchParams({ UserName: icecat.username, Language: icecat.language, GTIN: "3700460207656", app_key: icecat.appKey });
      const response = await fetch(`${icecat.proxyUrl || "https://live.icecat.biz/api"}?${query}`, { headers: icecat.proxyUrl && icecat.proxyToken ? { "X-Proxy-Token": icecat.proxyToken } : undefined, signal: AbortSignal.timeout(15_000) });
      if (response.status === 403) throw new Error("IP de salida no autorizada para Full Icecat.");
      if (!response.ok) throw new Error(`Icecat respondió HTTP ${response.status}`);
    }),
    // Resend: la clave de solo envío no puede listar dominios y contesta «restricted_api_key», que también vale (es válida).
    timed("Resend", false, async () => {
      if (!env.RESEND_API_KEY) throw new Error("Falta RESEND_API_KEY.");
      const response = await fetch("https://api.resend.com/domains", { headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` }, signal: AbortSignal.timeout(10_000) });
      if (response.ok) return;
      const body = await response.json().catch(() => ({})) as { name?: string; message?: string };
      if (body.name === "restricted_api_key") return;
      throw new Error(body.message ?? `Resend respondió HTTP ${response.status}`);
    }),
  ]);
}

export async function startCycle(deps: Deps, cycleId: string) {
  const cycle = await loadCycle(deps.db, cycleId);
  if (cycle.status !== "iniciando") return { skipped: `La vuelta ya está en «${cycle.status}».` };
  // La vuelta anterior se dio por atascada al abrir esta: se avisa.
  const { data: stuck } = await deps.db.from("mhd_sync_cycles").select("id,started_at,steps").eq("status", "atascada").gte("finished_at", new Date(Date.now() - 10 * 60_000).toISOString());
  for (const item of stuck ?? []) {
    const last = (item.steps as CycleStep[]).at(-1);
    await sendAlert(deps.db, { key: "vuelta:atascada", subject: "Vuelta de sincronización atascada", lines: [`La vuelta del ${new Date(item.started_at).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })} no terminó en 25 minutos.`, `Último paso: ${last ? `${last.name}${last.finished_at ? " (terminado)" : " (sin terminar)"}` : "ninguno"}.`], href: "/importar-datos-mhd" });
  }
  try {
    const checks = await step(deps.db, cycle, "conexiones", async () => {
      const results = await checkConnections(deps.sources, deps.env);
      return { services: results, failed: results.filter((item) => !item.ok).map((item) => item.name) };
    });
    const failed = checks.services.filter((item) => !item.ok);
    for (const item of failed.filter((service) => service.name !== "Resend")) await sendAlert(deps.db, { key: `conexion:${item.name}`, subject: `Sin conexión con ${item.name}`, lines: [item.critical ? `La vuelta de sincronización se ha parado: ${item.name} no responde.` : `${item.name} no responde: precio y stock siguen, pero no se pueden procesar fichas hasta que vuelva.`, item.error ?? ""] });
    const blocking = failed.filter((item) => item.critical);
    if (blocking.length) return finish(deps.db, cycle, "fallida", `Sin conexión con ${blocking.map((item) => item.name).join(", ")}.`);
    const read = await step(deps.db, cycle, "lectura", async () => {
      const { data, error } = await deps.db.rpc("mhd_import_start_scheduled", { p_kind: "products", p_entities: ["products"] });
      if (error) throw error;
      return data ? { run: data as string } : { skipped: true, reason: "Ya había una lectura de MHD en marcha." };
    });
    if (!read.run) return finish(deps.db, cycle, "parada", String(read.reason));
    // El paso «lectura» se cierra de verdad al terminar la lectura (continueCycle).
    Object.assign(cycle.steps.at(-1)!, { finished_at: undefined, status: undefined });
    await saveCycle(deps.db, cycle, { status: "leyendo", read_run_id: read.run });
  } catch (caught) {
    const error = caught instanceof Error ? caught.message : String(caught);
    await sendAlert(deps.db, { key: "vuelta:error", subject: "La vuelta de sincronización ha fallado", lines: ["Al empezar la vuelta:", error] });
    await finish(deps.db, cycle, "fallida", error);
  }
}

export async function continueCycle(deps: Deps, cycleId: string) {
  const cycle = await loadCycle(deps.db, cycleId);
  if (cycle.status !== "leyendo" || !cycle.read_run_id) return { skipped: `La vuelta está en «${cycle.status}».` };
  const { data: run } = await deps.db.from("mhd_catalog_import_runs").select("status,error_message,started_at,last_activity_at,entity_progress").eq("id", cycle.read_run_id).single();
  const reading = cycle.steps.find((item) => item.name === "lectura");
  if (reading) Object.assign(reading, { finished_at: run?.last_activity_at ?? new Date().toISOString(), status: run?.status === "completed" ? "ok" : "error", counts: { run: cycle.read_run_id, products: run?.entity_progress?.products?.done ?? 0 }, ...(run?.status === "completed" ? {} : { error: run?.error_message ?? `Lectura ${run?.status}` }) });
  if (run?.status !== "completed") {
    await sendAlert(deps.db, { key: "lectura:fallida", subject: "La lectura de MHD ha fallado", lines: ["La vuelta de sincronización se ha parado: la lectura del listado de MHD no terminó bien.", run?.error_message ?? `Estado: ${run?.status}`], href: "/importar-datos-mhd" });
    return finish(deps.db, cycle, "fallida", run?.error_message ?? "La lectura de MHD no terminó bien.");
  }
  await saveCycle(deps.db, cycle, { status: "procesando" });
  try {
    await step(deps.db, cycle, "precio-stock", async () => {
      const result = await syncPriceStock({ db: deps.db, shopify: deps.sources.shopify }, { runId: cycle.read_run_id! });
      if (!result.ok && "reason" in result) throw new Error(String(result.reason));
      return result as Record<string, unknown>;
    });
    await finish(deps.db, cycle, "terminada");
  } catch (caught) {
    await finish(deps.db, cycle, "fallida", caught instanceof Error ? caught.message : String(caught));
  }
}
