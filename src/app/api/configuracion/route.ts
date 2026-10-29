import { createClient } from "@/lib/supabase/server";

// Configuración de las sincronizaciones (store_settings, 2026-10-29) con la sesión del usuario. GET: todos los valores.
// POST { key, value }: cambia uno, validado. La frecuencia del resumen y la pausa de las vueltas las lleva a pg_cron la
// propia base al guardar (disparador store_settings_schedule).
export const dynamic = "force-dynamic";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALIDATE: Record<string, (value: unknown) => string | null> = {
  alert_emails: (value) => (Array.isArray(value) && value.length && value.every((item) => typeof item === "string" && EMAIL.test(item)) ? null : "Pon al menos un correo válido."),
  report_emails: (value) => (Array.isArray(value) && value.length && value.every((item) => typeof item === "string" && EMAIL.test(item)) ? null : "Pon al menos un correo válido."),
  report_frequency: (value) => (value === "hora" || value === "diario" ? null : "Frecuencia no válida."),
  sync_enabled: (value) => (typeof value === "boolean" ? null : "Valor no válido."),
};

async function session() {
  const db = await createClient();
  const { data } = await db.auth.getUser();
  return data.user ? { db, email: data.user.email ?? null } : null;
}

export async function GET() {
  const auth = await session();
  if (!auth) return Response.json({ error: "Sin sesión" }, { status: 401 });
  const { data, error } = await auth.db.from("store_settings").select("key,value,updated_by,updated_at");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ settings: Object.fromEntries((data ?? []).map((row) => [row.key, row])) });
}

export async function POST(request: Request) {
  const auth = await session();
  if (!auth) return Response.json({ error: "Sin sesión" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { key?: string; value?: unknown };
  const check = body.key ? VALIDATE[body.key] : undefined;
  if (!check) return Response.json({ error: "Ajuste desconocido." }, { status: 400 });
  const problem = check(body.value);
  if (problem) return Response.json({ error: problem }, { status: 400 });
  const { error } = await auth.db.from("store_settings").update({ value: body.value, updated_by: auth.email, updated_at: new Date().toISOString() }).eq("key", body.key!);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
