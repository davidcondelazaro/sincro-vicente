// Trabajador de los procesos del importador (2026-10-26): coge productos de la cola (mhd_importer_job_items), los
// procesa como la prueba de producto y deja en mhd_importer_events cada paso con su duración, las decisiones, los
// avisos y los errores. Lo llama la ruta /api/importador-productos/trabajos/trabajador, que se vuelve a llamar sola
// mientras quede trabajo; un vigilante de pg_cron la despierta si se para. Ver docs/IMPORTADOR_PRODUCTOS_MHD.md.
import Anthropic from "@anthropic-ai/sdk";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { anthropicKey, PROCESSOR_MODEL } from "./ai";
import type { SourcesConfig } from "./gather";
import { saveRunMedia } from "./media-store";
import { processProduct } from "./processor";
import { createTrace, type TraceEvent } from "./trace";

type Env = Record<string, string | undefined>;
export type JobItem = { id: number; job_id: string; codigo: string; family_code: string | null; attempts: number };

// Una llamada dura como mucho 300 s en Vercel: no se reservan productos nuevos pasados 150 s (un producto tarda hasta
// ~2 min), y el turno caduca a los 290 s por si la llamada muere.
export const WORKER = { budgetMs: 150_000, leaseSeconds: 290, itemLeaseSeconds: 600, concurrency: 4, maxAttempts: 2 };

// Cliente con la clave secreta: el trabajador no tiene sesión de usuario. Vale la clave nueva (SUPABASE_SECRET_KEY) o
// la antigua (SUPABASE_SERVICE_ROLE_KEY).
export function workerClient(env: Env): SupabaseClient {
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL; const key = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Falta SUPABASE_SECRET_KEY (o SUPABASE_SERVICE_ROLE_KEY) en el entorno del trabajador.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// Registro de un producto: se guarda por tandas para no hacer una escritura por hecho.
function itemLog(db: SupabaseClient, item: JobItem) {
  const pending: TraceEvent[] = [];
  const flush = async () => {
    if (!pending.length) return;
    const rows = pending.splice(0).map((event) => ({ job_id: item.job_id, item_id: item.id, codigo: item.codigo, level: event.level, step: event.step, message: event.message.slice(0, 4000), duration_ms: event.durationMs ?? null, data: event.data ?? null }));
    const { error } = await db.from("mhd_importer_events").insert(rows);
    if (error) console.error(JSON.stringify({ productImporterWorker: "registro", error: error.message }));
  };
  const trace = createTrace((event) => {
    pending.push(event);
    // El paso en curso se ve en la pantalla: se apunta el último terminado.
    if (event.durationMs !== undefined) void db.from("mhd_importer_job_items").update({ step: event.step }).eq("id", item.id).eq("status", "en_curso").then(() => undefined);
    if (pending.length >= 20) void flush();
  });
  return { trace, flush, add: (event: TraceEvent) => pending.push(event) };
}

const familyCache = new Map<string, Promise<{ profileRow: { profile: unknown; status: string } | null; family: { cod_subfamilia: string | null; codigo_ean: string | null }[] }>>();
function familyData(db: SupabaseClient, family: string) {
  if (!familyCache.has(family)) familyCache.set(family, (async () => {
    const [{ data: profileRow, error: profileError }, { data: family_, error: familyError }] = await Promise.all([
      db.from("mhd_importer_family_profiles").select("profile,status").eq("family_code", family).maybeSingle(),
      db.rpc("mhd_importer_family_listing", { p_family_code: family }),
    ]);
    if (profileError) throw profileError;
    if (familyError) throw familyError;
    return { profileRow, family: (family_ ?? []) as { cod_subfamilia: string | null; codigo_ean: string | null }[] };
  })().catch((caught) => { familyCache.delete(family); throw caught; }));
  return familyCache.get(family)!;
}

export async function processJobItem(deps: { db: SupabaseClient; config: SourcesConfig; ai: Anthropic }, item: JobItem) {
  const started = Date.now(); const log = itemLog(deps.db, item);
  try {
    const { data: listing, error } = await deps.db.rpc("mhd_importer_product", { p_codigo: item.codigo });
    if (error) throw error;
    if (!listing) throw new Error(`MHD ya no tiene el producto ${item.codigo}.`);
    const { profileRow, family } = await familyData(deps.db, listing.cod_familia);
    const subfamilyEans = family.filter((entry) => entry.cod_subfamilia === listing.cod_subfamilia && entry.codigo_ean).map((entry) => entry.codigo_ean!);
    const result = await processProduct({ ...deps, trace: log.trace }, listing, profileRow as Parameters<typeof processProduct>[2], subfamilyEans);
    const row: Record<string, unknown> = result.status === "ok"
      ? { codigo: listing.codigo, family_code: listing.cod_familia, status: "ok", result: result.product, warnings: result.warnings, model: PROCESSOR_MODEL, usage: result.usage, cost_usd: result.costUsd, created_by: "trabajador" }
      : { codigo: listing.codigo, family_code: listing.cod_familia, status: "discarded", discard_reason: result.reason, warnings: result.warnings, created_by: "trabajador" };
    const saved = await log.trace.step("Guardar la prueba", async () => {
      const { data, error: saveError } = await deps.db.from("mhd_importer_product_runs").insert(row).select("id").single();
      if (saveError) throw saveError;
      if (result.status === "ok") await saveRunMedia(deps.db, data.id, result.media);
      return data;
    }, () => (result.status === "ok" ? `${result.media.length} archivos guardados` : "Descartado"));
    // Avisos del procesador que no han salido ya como decisión o revisión.
    for (const warning of result.warnings.filter((text) => !text.startsWith("Revisión:") && !/^(Modelo|Marca|Fotos de Icecat)/.test(text))) log.add({ level: "aviso", step: "Avisos", message: warning });
    const duration = Date.now() - started;
    await deps.db.from("mhd_importer_job_items").update({ status: result.status === "ok" ? "ok" : "descartado", finished_at: new Date().toISOString(), duration_ms: duration, cost_usd: result.status === "ok" ? result.costUsd : null, run_id: saved.id, error: result.status === "ok" ? null : result.reason, lease_until: null, step: null }).eq("id", item.id);
    log.add({ level: "info", step: "Producto", message: `${result.status === "ok" ? `Hecho: ${result.product.content.title}` : `Descartado: ${result.reason}`} · ${Math.round(duration / 1000)} s`, durationMs: duration });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : typeof caught === "object" && caught && "message" in caught ? String((caught as { message: unknown }).message) : String(caught);
    const retry = item.attempts < WORKER.maxAttempts;
    log.add({ level: "error", step: "Producto", message: `${message}${retry ? " · se reintenta" : ""}`, durationMs: Date.now() - started });
    await deps.db.from("mhd_importer_job_items").update(retry ? { status: "pendiente", error: message, lease_until: null, step: null } : { status: "error", error: message, finished_at: new Date().toISOString(), duration_ms: Date.now() - started, lease_until: null, step: null }).eq("id", item.id);
  } finally {
    await log.flush();
  }
}

// Un turno del trabajador: mientras quede tiempo, reserva hasta `concurrency` productos y los procesa a la vez.
// Devuelve si queda trabajo, para que la ruta se vuelva a llamar.
export async function runWorkerTurn(env: Env, config: SourcesConfig) {
  const db = workerClient(env);
  const { data: token, error } = await db.rpc("mhd_importer_worker_acquire", { p_seconds: WORKER.leaseSeconds });
  if (error) throw error;
  if (!token) return { ran: false, processed: 0, more: false, reason: "Otra llamada tiene el turno." };
  const ai = new Anthropic({ apiKey: anthropicKey(env) });
  const started = Date.now(); let processed = 0; let more = false;
  try {
    while (Date.now() - started < WORKER.budgetMs) {
      const { data: jobs } = await db.from("mhd_importer_jobs").select("options").in("status", ["en_cola", "en_curso"]).order("created_at").limit(1);
      const concurrency = Math.min(8, Math.max(1, Number((jobs?.[0]?.options as { concurrency?: number } | undefined)?.concurrency ?? WORKER.concurrency)));
      const { data: items, error: claimError } = await db.rpc("mhd_importer_claim_items", { p_limit: concurrency, p_lease_seconds: WORKER.itemLeaseSeconds });
      if (claimError) throw claimError;
      if (!items?.length) break;
      await Promise.all((items as JobItem[]).map((item) => processJobItem({ db, config, ai }, item)));
      processed += items.length;
      await db.from("mhd_importer_worker").update({ heartbeat_at: new Date().toISOString(), lease_until: new Date(Date.now() + WORKER.leaseSeconds * 1000).toISOString() }).eq("lease_token", token);
    }
    await db.rpc("mhd_importer_finish_jobs");
    // Queda trabajo si hay pendientes en tandas activas (las pausadas esperan).
    const { data: active } = await db.from("mhd_importer_jobs").select("id").in("status", ["en_cola", "en_curso"]);
    const ids = (active ?? []).map((job) => job.id);
    const { count } = ids.length ? await db.from("mhd_importer_job_items").select("id", { count: "exact", head: true }).eq("status", "pendiente").in("job_id", ids) : { count: 0 };
    more = Boolean(count);
  } finally {
    await db.rpc("mhd_importer_worker_release", { p_token: token });
  }
  return { ran: true, processed, more };
}
