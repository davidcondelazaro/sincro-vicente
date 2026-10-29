import { sendEmail } from "@/lib/email";
import { buildDailyReport } from "@/lib/mhd-importer/daily-report";
import { workerClient } from "@/lib/mhd-importer/jobs";

// Resumen por correo (src/lib/mhd-importer/daily-report.ts). Lo llama pg_cron sin sesión pero con la cabecera
// `x-mhd-import-token`, igual que la sincronización de precio y stock: a las 9:00 el diario y, mientras se estabiliza
// todo (David, 2026-10-29), cada hora con `?horas=1`. `?simulacion=1` devuelve el resumen sin enviarlo. Cada resumen
// sale una sola vez aunque se repita la llamada (clave de idempotencia de Resend por día u hora).

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
  if (params.get("simulacion") === "1") return Response.json({ ok: true, dryRun: true, ...report });
  const day = new Date().toLocaleString("sv-SE", { timeZone: "Europe/Madrid" }).slice(0, hours === 24 ? 10 : 13);
  const result = await sendEmail({ subject: report.subject, html: report.html, text: report.text, idempotencyKey: `informe-${hours}h-${day}` });
  await db.from("mhd_sync_events").insert({ sync: "avisos", kind: "resumen", detail: { day, subject: report.subject, sent: result.ok, error: result.ok ? null : result.error } });
  return Response.json({ ...result, subject: report.subject }, { status: result.ok ? 200 : 502 });
}
