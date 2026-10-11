import { errorMessage, json, sessionEmail } from "@/lib/chatbot-api";
import { createChatbotClient } from "@/lib/chatbot-supabase";

export const dynamic = "force-dynamic";

// Configuración del chatbot (tabla bot_settings, una fila). El chatbot la relee como mucho una vez por minuto
// y valida lo mismo en src/config/settings.ts: si algo no es válido allí, usa el valor de su código.
type Settings = {
  phone: string;
  supportEmail: string;
  whatsapp: { number: string | null; hours: string | null; schedule: { days: number[]; from: string; to: string } };
  notices: string | null;
  teamEmails: { alerts: string[]; tickets: string[]; reports: string[]; quotes: string[] };
  priceAlerts: { minPercent: number; minEuros: number };
};
const TEAM_LISTS = ["alerts", "tickets", "quotes", "reports"] as const;
const TEAM_LABELS = { alerts: "avisos de errores", tickets: "tickets", quotes: "presupuestos", reports: "resúmenes" };

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

function validate(raw: unknown): { settings?: Settings; error?: string } {
  const body = (raw ?? {}) as Record<string, unknown>;
  const whatsapp = (body.whatsapp ?? {}) as Record<string, unknown>;
  const schedule = (whatsapp.schedule ?? {}) as Record<string, unknown>;
  const phone = text(body.phone);
  const supportEmail = text(body.supportEmail);
  const number = text(whatsapp.number).replace(/[\s+]/g, "");
  const days = Array.isArray(schedule.days) ? [...new Set(schedule.days.map(Number))].filter((day) => Number.isInteger(day) && day >= 1 && day <= 7).sort() : [];
  const from = text(schedule.from);
  const to = text(schedule.to);
  const notices = typeof body.notices === "string" ? body.notices.trim() : "";
  if (notices.length > 4000) return { error: "Los avisos no pueden pasar de 4.000 caracteres." };
  if (!phone) return { error: "Falta el teléfono." };
  const rawTeam = (body.teamEmails ?? {}) as Record<string, unknown>;
  const teamEmails = { alerts: [] as string[], tickets: [] as string[], reports: [] as string[], quotes: [] as string[] };
  for (const list of TEAM_LISTS) {
    const raw = rawTeam[list];
    const items = (Array.isArray(raw) ? raw.map(String) : String(raw ?? "").split(/[,;\s]+/)).map((item) => item.trim().toLowerCase()).filter(Boolean);
    const invalid = items.find((item) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item));
    if (invalid) return { error: `El email «${invalid}» de ${TEAM_LABELS[list]} no es válido.` };
    if (items.length > 20) return { error: `Como mucho 20 emails en ${TEAM_LABELS[list]}.` };
    teamEmails[list] = [...new Set(items)];
  }
  const rawPrice = (body.priceAlerts ?? {}) as Record<string, unknown>;
  const minPercent = Number(String(rawPrice.minPercent ?? 3).replace(",", "."));
  const minEuros = Number(String(rawPrice.minEuros ?? 1).replace(",", "."));
  if (!Number.isFinite(minPercent) || minPercent < 0 || minPercent > 50) return { error: "La bajada mínima en % debe estar entre 0 y 50." };
  if (!Number.isFinite(minEuros) || minEuros < 0 || minEuros > 500) return { error: "La bajada mínima en € debe estar entre 0 y 500." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail)) return { error: "El email de soporte no es válido." };
  if (number && !/^\d{8,15}$/.test(number)) return { error: "El WhatsApp debe ser el número con prefijo de país, sin «+» ni espacios (p. ej. 34699742952)." };
  if (!HHMM.test(from) || !HHMM.test(to) || from >= to) return { error: "El horario de WhatsApp debe tener «desde» y «hasta» en formato HH:MM, y «desde» antes que «hasta»." };
  return {
    settings: {
      phone,
      supportEmail,
      whatsapp: { number: number || null, hours: text(whatsapp.hours) || null, schedule: { days, from, to } },
      notices: notices || null,
      teamEmails,
      priceAlerts: { minPercent: Math.round(minPercent * 10) / 10, minEuros: Math.round(minEuros * 100) / 100 },
    },
  };
}

export async function GET() {
  if (!(await sessionEmail())) return json({ error: "Necesitas iniciar sesión." }, 401);
  try {
    const { data, error } = await createChatbotClient().from("bot_settings").select("store, updated_at, updated_by").eq("id", 1).maybeSingle();
    if (error) throw error;
    return json({ settings: data?.store ?? null, updatedAt: data?.updated_at ?? null, updatedBy: data?.updated_by ?? null });
  } catch (caught) {
    return json({ error: errorMessage(caught, "No se pudo leer la configuración del chatbot.") }, 500);
  }
}

export async function PUT(request: Request) {
  const email = await sessionEmail();
  if (!email) return json({ error: "Necesitas iniciar sesión." }, 401);
  const { settings, error: invalid } = validate(await request.json().catch(() => null));
  if (!settings) return json({ error: invalid }, 400);
  try {
    const updatedAt = new Date().toISOString();
    const { error } = await createChatbotClient().from("bot_settings").upsert({ id: 1, store: settings, updated_at: updatedAt, updated_by: email });
    if (error) throw error;
    return json({ settings, updatedAt, updatedBy: email });
  } catch (caught) {
    return json({ error: errorMessage(caught, "No se pudo guardar la configuración del chatbot.") }, 500);
  }
}
