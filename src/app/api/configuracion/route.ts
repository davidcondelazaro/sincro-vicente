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
  absence_days: (value) => (Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 365 ? null : "Pon un número de días entre 1 y 365."),
  importer_max_workers: (value) => (Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 12 ? null : "Pon entre 1 y 12 trabajadores."),
  importer_max_concurrency: (value) => (Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 12 ? null : "Pon entre 1 y 12 productos por trabajador."),
  auto_altas: (value) => (typeof value === "boolean" ? null : "Valor no válido."),
  auto_altas_max: (value) => (Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 5000 ? null : "Pon un número entre 1 y 5.000."),
  delivery_changes_alert: (value) => (typeof value === "boolean" ? null : "Valor no válido."),
  supplier_changes_alert: (value) => (typeof value === "boolean" ? null : "Valor no válido."),
  empty_collections_republish: (value) => (typeof value === "boolean" ? null : "Valor no válido."),
  supplier_switch_max: (value) => (Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 100000 ? null : "Pon un número entre 1 y 100.000."),
  absence_brake_pct: (value) => (typeof value === "number" && value >= 0.5 && value <= 50 ? null : "Pon un porcentaje entre 0,5 y 50."),
  // Pedidos MHD (17-11-2026, docs/PEDIDOS_MHD_FASE_1.md › Automatización de pedidos)
  pedidos_exportar_auto_activo: (value) => (typeof value === "boolean" ? null : "Valor no válido."),
  pedidos_exportar_margen_minutos: (value) => (Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 1440 ? null : "Pon entre 0 y 1.440 minutos."),
  pedidos_envio_auto_activo: (value) => (typeof value === "boolean" ? null : "Valor no válido."),
  pedidos_entrega_auto_activo: (value) => (typeof value === "boolean" ? null : "Valor no válido."),
  cancelar_en_shopify_activo: (value) => (typeof value === "boolean" ? null : "Valor no válido."),
  factura_correo_activo: (value) => (typeof value === "boolean" ? null : "Valor no válido."),
  pedidos_aviso_sin_exportar_horas: (value) => (typeof value === "number" && value >= 0.5 && value <= 72 ? null : "Pon entre 0,5 y 72 horas."),
  pedidos_informe_hora: (value) => (Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 23 ? null : "Pon una hora entre 0 y 23."),
  pedidos_informe_emails: (value) => (Array.isArray(value) && value.length && value.every((item) => typeof item === "string" && EMAIL.test(item)) ? null : "Pon al menos un correo válido."),
  pedidos_avisos_emails: (value) => (Array.isArray(value) && value.length && value.every((item) => typeof item === "string" && EMAIL.test(item)) ? null : "Pon al menos un correo válido."),
};
// Al encender estos interruptores sin fecha de corte, el corte es ese momento: no actúan sobre lo anterior
const CUTOFF: Record<string, string> = { pedidos_exportar_auto_activo: "pedidos_exportar_auto_desde", cancelar_en_shopify_activo: "cancelar_en_shopify_desde", factura_correo_activo: "factura_correo_desde" };

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
  const cutoff = CUTOFF[body.key!];
  if (cutoff && body.value === true) {
    const { data: current } = await auth.db.from("store_settings").select("value").eq("key", cutoff).maybeSingle();
    if (typeof current?.value !== "string") await auth.db.from("store_settings").update({ value: new Date().toISOString(), updated_by: auth.email, updated_at: new Date().toISOString() }).eq("key", cutoff);
  }
  return Response.json({ ok: true });
}
