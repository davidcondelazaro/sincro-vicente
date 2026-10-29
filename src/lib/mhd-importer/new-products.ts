import type { SupabaseClient } from "@supabase/supabase-js";
import { sendAlert } from "./alerts";

// Altas automáticas (David, 2026-10-29; docs/SINCRONIZACIONES_MHD.md › Altas). Paso de la vuelta, después de agotados:
// las altas de la lectura (mhd_new_products: productos nuevos y descartados «Sin imagen» a los que MHD ha puesto fotos)
// se añaden a la tanda «Altas automáticas» abierta, o a una nueva, y se despierta al trabajador. Sin repetidos (la
// consulta ya excluye lo que está en cola) y con freno: si salen más de `auto_altas_max`, no se encola nada y se avisa.
// El trabajador respeta el tope de Configuración (importer_max_workers × importer_max_concurrency).
const APP_URL = process.env.APP_URL ?? "https://utils.electronicavicente.com";

async function setting<T>(db: SupabaseClient, key: string, fallback: T): Promise<T> {
  const { data } = await db.from("store_settings").select("value").eq("key", key).maybeSingle();
  return (data?.value ?? fallback) as T;
}

export async function queueNewProducts(deps: { db: SupabaseClient }, options: { runId: string; cycleId?: string; dryRun?: boolean }) {
  const db = deps.db;
  const [enabled, max] = await Promise.all([setting(db, "auto_altas", true), setting(db, "auto_altas_max", 300)]);
  const rows: { codigo: string; family_code: string | null; motivo: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.rpc("mhd_new_products", { p_run: options.runId }).range(from, from + 999);
    if (error) throw error;
    rows.push(...((data ?? []) as typeof rows));
    if (!data || data.length < 1000) break;
  }
  const summary = { found: rows.length, nuevos: rows.filter((row) => row.motivo === "nuevo").length, fotosNuevas: rows.filter((row) => row.motivo === "fotos nuevas").length, queued: 0, job: null as string | null, braked: false, skipped: !enabled };
  if (!enabled || !rows.length || options.dryRun) return summary;
  if (rows.length > Number(max)) {
    summary.braked = true;
    await sendAlert(db, { key: "altas:freno", subject: `Freno: ${rows.length} altas de golpe`, lines: [`En esta vuelta salen ${rows.length} productos nuevos de MHD, más del tope (${max}).`, "No se ha encolado nada: revisa si es normal y lánzalos desde el importador, o sube el tope en Configuración."], href: "/importador-productos" });
    return summary;
  }
  // Tanda abierta de altas automáticas, o una nueva.
  const { data: open } = await db.from("mhd_importer_jobs").select("id").eq("options->>auto", "altas").in("status", ["en_cola", "en_curso", "pausado"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  let jobId = open?.id as string | undefined;
  if (!jobId) {
    const when = new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    const { data: created, error } = await db.from("mhd_importer_jobs").insert({ title: `Altas automáticas (desde el ${when})`, created_by: "vuelta automática", status: "en_cola", options: { auto: "altas", upload: true, workers: 3, concurrency: 4, skipDone: false } }).select("id").single();
    if (error) throw error;
    jobId = created.id as string;
  } else {
    await db.from("mhd_importer_jobs").update({ status: "en_curso" }).eq("id", jobId).eq("status", "en_cola");
  }
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from("mhd_importer_job_items").insert(rows.slice(i, i + 500).map((row) => ({ job_id: jobId, codigo: row.codigo, family_code: row.family_code })));
    if (error) throw error;
  }
  for (let i = 0; i < rows.length; i += 1000) await db.from("mhd_sync_events").insert(rows.slice(i, i + 1000).map((row) => ({ sync: "altas", kind: "encolado", codigo: row.codigo, detail: { motivo: row.motivo, job: jobId, cycle: options.cycleId ?? null } })));
  // El trabajador procesa y sube; si le falta la ficha de MHD, la pide él mismo.
  await fetch(`${APP_URL}/api/importador-productos/trabajos/trabajador`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
  return { ...summary, queued: rows.length, job: jobId };
}
