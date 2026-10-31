import type { SupabaseClient } from "@supabase/supabase-js";
import { EMAIL_PREFIX, escapeHtml, sendEmail, settingRecipients } from "@/lib/email";

// Avisos al momento de los fallos graves de las sincronizaciones (David, 2026-10-26: «fallos graves al momento»). Como
// mucho uno por motivo (`key`) cada hora (o cada `quietMinutes`), para que un fallo que se repite no llene el correo. Cada
// aviso queda en mhd_sync_events (sync «avisos»), se haya podido enviar o no; el resumen diario los recoge.
const QUIET_MINUTES = 60;
const APP_URL = "https://utils.electronicavicente.com";

export async function sendAlert(db: SupabaseClient, alert: { key: string; subject: string; lines: string[]; href?: string; quietMinutes?: number }) {
  const since = new Date(Date.now() - (alert.quietMinutes ?? QUIET_MINUTES) * 60_000).toISOString();
  const { data: recent } = await db.from("mhd_sync_events").select("id").eq("sync", "avisos").eq("kind", "correo").contains("detail", { key: alert.key, sent: true }).gte("created_at", since).limit(1).maybeSingle();
  if (recent) return { ok: true, skipped: "ya avisado hace poco" };
  const link = `${APP_URL}${alert.href ?? "/importador-productos"}`;
  const result = await sendEmail({
    to: await settingRecipients(db, "alert_emails"),
    subject: `${EMAIL_PREFIX} ⚠ ${alert.subject}`,
    text: [...alert.lines, "", link].join("\n"),
    html: `<p>${alert.lines.map(escapeHtml).join("<br>")}</p><p><a href="${link}">Abrir utils</a></p>`,
  });
  await db.from("mhd_sync_events").insert({ sync: "avisos", kind: "correo", detail: { key: alert.key, subject: alert.subject, lines: alert.lines, sent: result.ok, error: result.ok ? null : result.error } });
  return result;
}
