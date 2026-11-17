import { sendEmail, settingRecipients } from "@/lib/email";
import { buildDailyReport } from "@/lib/mhd-importer/daily-report";
import { workerClient } from "@/lib/mhd-importer/jobs";

// Resumen por correo (src/lib/mhd-importer/daily-report.ts). Lo llama pg_cron sin sesión pero con la cabecera
// `x-mhd-import-token`, igual que la sincronización de precio y stock: a las 9:00 el diario y, mientras se estabiliza
// todo (David, 2026-10-29), cada hora con `?horas=1`. `?simulacion=1` devuelve el resumen sin enviarlo. Cada resumen
// sale una sola vez aunque se repita la llamada (clave de idempotencia de Resend por día u hora). Lo enviado se guarda
// en mhd_daily_reports (página /resumen).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const db = workerClient(process.env);
  const token = request.headers.get("x-mhd-import-token");
  const { data: valid } = token ? await db.rpc("mhd_import_token_valid", { p_token: token }) : { data: false };
  if (valid !== true) return Response.json({ error: "No autorizado" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const hours = Math.min(24, Math.max(1, Number(params.get("horas")) || 24));
  const report = await buildDailyReport(db, new Date(), hours);
  // Se guarda (indicadores y secciones) para la página Resumen y para comparar con el siguiente. En simulación, solo
  // con `?guardar=1`.
  const save = () => db.from("mhd_daily_reports").insert({ period_hours: hours, period_start: report.since, period_end: report.until, subject: report.subject, kpis: report.kpis, sections: report.sections });
  if (params.get("simulacion") === "1") {
    if (params.get("guardar") === "1") await save();
    return Response.json({ ok: true, dryRun: true, ...report });
  }
  const day = new Date().toLocaleString("sv-SE", { timeZone: "Europe/Madrid" }).slice(0, hours === 24 ? 10 : 13);
  const result = await sendEmail({ to: await settingRecipients(db, "report_emails"), subject: report.subject, html: report.html, text: report.text, idempotencyKey: `informe-${hours}h-${day}` });
  if (result.ok) await save();
  await db.from("mhd_sync_events").insert({ sync: "avisos", kind: "resumen", detail: { day, subject: report.subject, sent: result.ok, error: result.ok ? null : result.error } });
  return Response.json({ ...result, subject: report.subject }, { status: result.ok ? 200 : 502 });
}
