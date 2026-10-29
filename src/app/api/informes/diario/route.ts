import { sendEmail } from "@/lib/email";
import { buildDailyReport } from "@/lib/mhd-importer/daily-report";
import { workerClient } from "@/lib/mhd-importer/jobs";

// Resumen diario por correo (src/lib/mhd-importer/daily-report.ts). Lo llamará pg_cron a las 9:00, sin sesión pero con
// la cabecera `x-mhd-import-token`, igual que la sincronización de precio y stock. `?simulacion=1` devuelve el resumen
// sin enviarlo. Un mismo día solo se envía una vez (clave de idempotencia de Resend).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const db = workerClient(process.env);
  const token = request.headers.get("x-mhd-import-token");
  const { data: valid } = token ? await db.rpc("mhd_import_token_valid", { p_token: token }) : { data: false };
  if (valid !== true) return Response.json({ error: "No autorizado" }, { status: 401 });
  const report = await buildDailyReport(db);
  if (new URL(request.url).searchParams.get("simulacion") === "1") return Response.json({ ok: true, dryRun: true, ...report });
  const day = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Madrid" });
  const result = await sendEmail({ subject: report.subject, html: report.html, text: report.text, idempotencyKey: `informe-diario-${day}` });
  await db.from("mhd_sync_events").insert({ sync: "avisos", kind: "resumen", detail: { day, subject: report.subject, sent: result.ok, error: result.ok ? null : result.error } });
  return Response.json({ ...result, subject: report.subject }, { status: result.ok ? 200 : 502 });
}
