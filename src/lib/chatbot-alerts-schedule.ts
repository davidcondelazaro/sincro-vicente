import { CronExpressionParser } from "cron-parser";
import type { SupabaseClient } from "@supabase/supabase-js";

// Cuándo se comprueban los avisos de stock y de precio: justo después de cada copia de productos del chatbot.
// Última comprobación (último sync_runs de productos terminado, con su resultado en stats.avisos_stock /
// stats.avisos_precio) y próxima (según la programación de productos en sync_schedules).
export type AlertsSchedule = {
  last: { at: string; ok: boolean; sent: number | null; ready: number | null; failed: number | null } | null;
  next: string | null;
  enabled: boolean;
};

export async function alertsSchedule(db: SupabaseClient, key: "avisos_stock" | "avisos_precio"): Promise<AlertsSchedule> {
  const [run, schedule] = await Promise.all([
    db.from("sync_runs").select("finished_at, status, stats").eq("kind", "products").not("finished_at", "is", null).order("finished_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("sync_schedules").select("cron, enabled").eq("kind", "products").maybeSingle(),
  ]);
  const result = (run.data?.stats as Record<string, { sent?: number; ready?: number; failed?: number }> | null)?.[key];
  let next: string | null = null;
  if (schedule.data?.enabled && schedule.data.cron) {
    try { next = CronExpressionParser.parse(schedule.data.cron, { tz: "Europe/Madrid" }).next().toDate().toISOString(); } catch { next = null; }
  }
  return {
    last: run.data ? { at: run.data.finished_at, ok: run.data.status === "ok", sent: result?.sent ?? null, ready: result?.ready ?? null, failed: result?.failed ?? null } : null,
    next,
    enabled: Boolean(schedule.data?.enabled),
  };
}
