import type { SupabaseClient } from "@supabase/supabase-js";
import { EMAIL_PREFIX, escapeHtml, sendEmail, settingRecipients, type RecipientsKey } from "@/lib/email";

// Avisos al momento de los fallos graves de las sincronizaciones (David, 2026-10-26: «fallos graves al momento»). Como
// mucho uno por motivo (`key`) cada hora (o cada `quietMinutes`), para que un fallo que se repite no llene el correo. Cada
// aviso queda en mhd_sync_events (sync «avisos»), se haya podido enviar o no; el resumen diario los recoge.
const QUIET_MINUTES = 60;
const APP_URL = "https://utils.electronicavicente.com";

export async function sendAlert(db: SupabaseClient, alert: { key: string; subject: string; lines: string[]; href?: string; quietMinutes?: number; recipientsKey?: RecipientsKey }) {
  const since = new Date(Date.now() - (alert.quietMinutes ?? QUIET_MINUTES) * 60_000).toISOString();
  // Reserva atómica en la base (mhd_alert_claim, 2026-11-17): con varios trabajadores a la vez, solo uno envía.
  const { data: claim, error: claimError } = await db.rpc("mhd_alert_claim", { p_key: alert.key, p_since: since });
  // Si la reserva falla, se avisa igual: mejor un aviso repetido que ninguno.
  if (!claimError && claim === null) return { ok: true, skipped: "ya avisado hace poco" };
  const link = `${APP_URL}${alert.href ?? "/importador-productos"}`;
  const result = await sendEmail({
    to: await settingRecipients(db, alert.recipientsKey ?? "alert_emails"),
    subject: `${EMAIL_PREFIX} ⚠ ${alert.subject}`,
    text: [...alert.lines, "", link].join("\n"),
    html: `<p>${alert.lines.map(escapeHtml).join("<br>")}</p><p><a href="${link}">Abrir utils</a></p>`,
  });
  // Si no salió, se quita la reserva para que el siguiente intento pueda avisar.
  if (!result.ok && claim) await db.from("mhd_sync_events").delete().eq("id", claim);
  await db.from("mhd_sync_events").insert({ sync: "avisos", kind: "correo", detail: { key: alert.key, subject: alert.subject, lines: alert.lines, sent: result.ok, error: result.ok ? null : result.error } });
  return result;
}
