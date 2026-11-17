import { createClient } from "@/lib/supabase/server";
import { buildDailyReport } from "@/lib/mhd-importer/daily-report";
import { workerClient } from "@/lib/mhd-importer/jobs";

// Página Resumen (2026-11-17). GET: el último resumen diario guardado y los indicadores de los 30 anteriores, para la
// evolución. POST: el resumen calculado ahora mismo (últimas 24 horas), sin enviarlo ni guardarlo.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function signedIn() {
  const db = await createClient();
  const { data } = await db.auth.getUser();
  return data.user ? db : null;
}

export async function GET() {
  const db = await signedIn();
  if (!db) return Response.json({ error: "Sin sesión" }, { status: 401 });
  const { data, error } = await db.from("mhd_daily_reports").select("id,period_start,period_end,subject,kpis,sections").eq("period_hours", 24).order("period_end", { ascending: false }).limit(31);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const [latest, ...rest] = data ?? [];
  return Response.json({ latest: latest ?? null, history: [latest, ...rest].filter(Boolean).reverse().map((row) => ({ period_end: row!.period_end, kpis: row!.kpis })) });
}

export async function POST() {
  if (!(await signedIn())) return Response.json({ error: "Sin sesión" }, { status: 401 });
  const report = await buildDailyReport(workerClient(process.env), new Date(), 24);
  return Response.json({ live: { period_start: report.since, period_end: report.until, subject: report.subject, kpis: report.kpis, sections: report.sections } });
}
