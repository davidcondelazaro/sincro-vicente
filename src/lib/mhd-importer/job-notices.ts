import type { SupabaseClient } from "@supabase/supabase-js";
import { EMAIL_PREFIX, escapeHtml, sendEmail, settingRecipients } from "@/lib/email";

// Aviso de «tanda terminada» (David, 2026-10-29): al acabar una tanda del importador, un correo corto con su resultado
// (subidos, a revisión, bloqueados, descartes por motivo, errores, coste y tiempo). Lo mira la vuelta cada 30 minutos;
// cada tanda se avisa una sola vez (options.notified).
const UTILS = "https://utils.electronicavicente.com";
const integer = new Intl.NumberFormat("es-ES");
const dollars = new Intl.NumberFormat("es-ES", { style: "currency", currency: "USD" });
const duration = (ms: number) => { const minutes = Math.round(ms / 60_000); return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`; };

export async function notifyFinishedJobs(db: SupabaseClient) {
  const since = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const { data: jobs, error } = await db.from("mhd_importer_jobs").select("id,title,options,started_at,finished_at").eq("status", "terminado").gte("finished_at", since).is("options->>notified", null);
  if (error) throw error;
  const sent: string[] = [];
  for (const job of jobs ?? []) {
    const { data: items } = await db.from("mhd_importer_job_items").select("status,error,cost_usd,run_id").eq("job_id", job.id).limit(10_000);
    const list = items ?? [];
    const count = (status: string) => list.filter((item) => item.status === status).length;
    const uploadIssues = list.filter((item) => item.status === "ok" && item.error);
    const blocked = uploadIssues.filter((item) => String(item.error).includes("afirmaciones sin respaldo")).length;
    const otherUpload = uploadIssues.length - blocked;
    const reasons = new Map<string, number>();
    for (const item of list.filter((row) => row.status === "descartado" || row.status === "error")) { const key = `${item.status === "error" ? "Error" : "Descartado"}: ${String(item.error ?? "sin motivo").slice(0, 100)}`; reasons.set(key, (reasons.get(key) ?? 0) + 1); }
    const cost = list.reduce((total, item) => total + Number(item.cost_usd ?? 0), 0);
    const took = job.started_at && job.finished_at ? duration(new Date(job.finished_at).getTime() - new Date(job.started_at).getTime()) : "—";
    const lines = [
      `${integer.format(list.length)} productos en ${took}: ${integer.format(count("ok") - uploadIssues.length)} bien, ${integer.format(count("descartado"))} descartados y ${integer.format(count("error"))} con error.`,
      ...(blocked ? [`${integer.format(blocked)} fichas bloqueadas por el revisor (frases sin respaldo): procesadas pero sin subir, para rehacer.`] : []),
      ...(otherUpload ? [`${integer.format(otherUpload)} procesados que no se pudieron subir a Shopify: hay que reintentarlos.`] : []),
      `Coste de IA: ${dollars.format(cost)}.`,
      ...[...reasons].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([reason, n]) => `${reason} (${n})`),
    ];
    const subject = `${EMAIL_PREFIX} Tanda terminada: ${job.title}`;
    const link = `${UTILS}/importador-productos`;
    const result = await sendEmail({ to: await settingRecipients(db, "report_emails"), subject, text: [...lines, "", link].join("\n"), html: `<p><strong>${escapeHtml(job.title)}</strong></p><ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul><p><a href="${link}">Ver la tanda en utils</a></p>`, idempotencyKey: `tanda-${job.id}` });
    await db.from("mhd_importer_jobs").update({ options: { ...(job.options ?? {}), notified: new Date().toISOString(), notified_ok: result.ok } }).eq("id", job.id);
    sent.push(job.id);
  }
  return { notified: sent.length };
}
