// Correos internos con Resend (API REST, sin SDK), igual que chatbot-vicente (`src/email/send.ts`): mismo servicio y
// mismo remitente del equipo, del dominio ya verificado. Variables en Vercel: RESEND_API_KEY (obligatoria),
// EMAIL_FROM_TEAM (opcional) y ALERT_EMAILS (destinatarios separados por comas; por defecto, David). Sin clave no envía
// y devuelve { skipped: true }.
const TEAM_FROM = "Electrónica Vicente <utils@mail.electronicavicente.com>";
const DEFAULT_TO = "david@aligeria.com";

// Delante de todos los asuntos (David, 2026-10-29).
export const EMAIL_PREFIX = "[Electrónica Vicente Utils]";

export type SendResult = { ok: true; id: string } | { ok: false; skipped?: boolean; error: string };

export const alertRecipients = () => (process.env.ALERT_EMAILS || DEFAULT_TO).split(",").map((item) => item.trim()).filter(Boolean);
export const emailConfigured = () => Boolean(process.env.RESEND_API_KEY);

export async function sendEmail(email: { to?: string[]; subject: string; html: string; text: string; idempotencyKey?: string }): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, skipped: true, error: "Correo sin configurar (falta RESEND_API_KEY en Vercel)" };
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(email.idempotencyKey && { "Idempotency-Key": email.idempotencyKey }) },
      body: JSON.stringify({ from: process.env.EMAIL_FROM_TEAM || TEAM_FROM, to: email.to ?? alertRecipients(), subject: email.subject, html: email.html, text: email.text }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!response.ok || !body.id) return { ok: false, error: body.message ?? `Resend respondió ${response.status}` };
    return { ok: true, id: body.id };
  } catch (caught) {
    return { ok: false, error: caught instanceof Error ? caught.message : String(caught) };
  }
}

export const escapeHtml = (text: string) => text.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!);
