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
};

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
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail)) return { error: "El email de soporte no es válido." };
  if (number && !/^\d{8,15}$/.test(number)) return { error: "El WhatsApp debe ser el número con prefijo de país, sin «+» ni espacios (p. ej. 34699742952)." };
  if (!HHMM.test(from) || !HHMM.test(to) || from >= to) return { error: "El horario de WhatsApp debe tener «desde» y «hasta» en formato HH:MM, y «desde» antes que «hasta»." };
  return {
    settings: {
      phone,
      supportEmail,
      whatsapp: { number: number || null, hours: text(whatsapp.hours) || null, schedule: { days, from, to } },
      notices: notices || null,
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
