import { createClient } from "@/lib/supabase/server";

// Datos de Inicio (panel en tiempo real, 2026-10-29). Lo pide la pantalla cada pocos segundos con la sesión del usuario:
// vueltas de sincronización (la de ahora, con el progreso de la lectura de MHD), lo de hoy (mhd_sync_report desde las
// 0:00 de Madrid), catálogo frente a la tienda (mhd_catalog_overview, ~2 s: se guarda 60 s) y avisos del último día.
export const dynamic = "force-dynamic";

let overviewCache: { at: number; data: unknown } | null = null;

export async function GET() {
  const db = await createClient();
  const { data: auth } = await db.auth.getUser();
  if (!auth.user) return Response.json({ error: "Sin sesión" }, { status: 401 });
  const madridDay = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Madrid" });
  const madridOffset = new Intl.DateTimeFormat("en", { timeZone: "Europe/Madrid", timeZoneName: "longOffset" }).formatToParts(new Date()).find((part) => part.type === "timeZoneName")?.value.replace("GMT", "") || "+00:00";
  const since = new Date(`${madridDay}T00:00:00${madridOffset}`).toISOString();
  const overviewFresh = overviewCache && Date.now() - overviewCache.at < 60_000;
  const [cycles, today, overview, alerts, absences] = await Promise.all([
    db.from("mhd_sync_cycles").select("id,trigger,status,started_at,finished_at,read_run_id,steps,error").order("started_at", { ascending: false }).limit(16),
    db.rpc("mhd_sync_report", { p_since: since }),
    overviewFresh ? Promise.resolve({ data: overviewCache!.data, error: null }) : db.rpc("mhd_catalog_overview"),
    db.from("mhd_sync_events").select("detail,created_at").eq("sync", "avisos").eq("kind", "correo").gte("created_at", new Date(Date.now() - 86_400_000).toISOString()).order("created_at", { ascending: false }).limit(8),
    db.rpc("mhd_absence_report", { p_since: since }),
  ]);
  if (!overviewFresh && overview.data) overviewCache = { at: Date.now(), data: overview.data };
  const current = cycles.data?.[0];
  let reading: { done: number; total: number } | null = null;
  if (current?.status === "leyendo" && current.read_run_id) {
    const { data: run } = await db.from("mhd_catalog_import_runs").select("entity_progress").eq("id", current.read_run_id).maybeSingle();
    const progress = (run?.entity_progress as Record<string, { done?: number; total?: number }> | undefined)?.products;
    reading = { done: progress?.done ?? 0, total: progress?.total ?? 0 };
  }
  const error = cycles.error?.message ?? today.error?.message ?? overview.error?.message;
  return Response.json({ absences: absences.data ?? null, cycles: cycles.data ?? [], reading, today: today.data, overview: overview.data, alerts: alerts.data ?? [], since, error: error ?? null, now: new Date().toISOString() });
}
