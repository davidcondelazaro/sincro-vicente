import { csvContratos } from "@/lib/garantia3";
import { enviarPedidoDePrueba, leerAjustes, vueltaGarantia3 } from "@/lib/garantia3-vuelta";
import { createClient } from "@/lib/supabase/server";

// Pantalla Contratos Garantía3, con la sesión del usuario. GET: ajustes, contratos y última vuelta (?csv=1, el listado
// en CSV). POST { action, … }: ajustes, comprobar, vuelta, prueba, reintentar, pedir_ya, dudoso_creado, dudoso_no_creado, anular,
// anulado. Ver docs/GARANTIA3.md.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const correos = (value: unknown) => (Array.isArray(value) && value.every((item) => typeof item === "string" && EMAIL.test(item)) ? null : "Hay un correo no válido.");
const VALIDATE: Record<string, (value: unknown) => string | null> = {
  garantia3_modo: (value) => (value === "test" || value === "produccion" ? null : "Modo no válido."),
  garantia3_dias: (value) => (Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 365 ? null : "Pon un número de días entre 0 y 365."),
  garantia3_desde: (value) => (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? null : "Fecha no válida."),
  garantia3_emails_incidencias: correos,
  garantia3_emails_resumen: correos,
};

async function session() {
  const db = await createClient();
  const { data } = await db.auth.getUser();
  return data.user ? { db, userId: data.user.id, email: data.user.email ?? null } : null;
}

export async function GET(request: Request) {
  const auth = await session();
  if (!auth) return Response.json({ error: "Sin sesión" }, { status: 401 });
  const { data, error } = await auth.db.from("garantia3_contratos").select("id,shopify_order_name,unidad,order_created_at,sku,ean13,sku_aparato,nombre,apellidos,email,telefono,fecha_inicio,origen_fecha,fecha_prevista,estado,motivo,modo,contrato,pin,fecha_alta").order("created_at", { ascending: false }).limit(1000);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (new URL(request.url).searchParams.get("csv") === "1") return new Response(csvContratos(data ?? []), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=\"contratos-garantia3.csv\"" } });
  const [ajustes, vuelta] = await Promise.all([leerAjustes(auth.db), auth.db.from("garantia3_vueltas").select("origen,modo,inicio,fin,resumen").order("inicio", { ascending: false }).limit(1).maybeSingle()]);
  return Response.json({ ajustes, contratos: data ?? [], vuelta: vuelta.data, proxyConfigurado: Boolean(process.env.GARANTIA3_PROXY_URL && process.env.GARANTIA3_PROXY_TOKEN && (process.env.GARANTIA3_TOKEN || process.env.GARANTIA3_TOKEN_TEST)) });
}

export async function POST(request: Request) {
  const auth = await session();
  if (!auth) return Response.json({ error: "Sin sesión" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { action?: string; id?: string; key?: string; value?: unknown; contrato?: string };
  const cambiar = async (desde: string[], cambios: Record<string, unknown>) => {
    const { data, error } = await auth.db.from("garantia3_contratos").update({ ...cambios, updated_at: new Date().toISOString() }).eq("id", body.id ?? "").in("estado", desde).select("id");
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return data?.length ? Response.json({ ok: true }) : Response.json({ error: "Ese contrato ya no está en ese estado." }, { status: 409 });
  };

  switch (body.action) {
    case "ajustes": {
      const check = body.key ? VALIDATE[body.key] : undefined;
      if (!check) return Response.json({ error: "Ajuste desconocido." }, { status: 400 });
      const problem = check(body.value);
      if (problem) return Response.json({ error: problem }, { status: 400 });
      const { error } = await auth.db.from("store_settings").update({ value: body.value, updated_by: auth.email, updated_at: new Date().toISOString() }).eq("key", body.key!);
      return error ? Response.json({ error: error.message }, { status: 500 }) : Response.json({ ok: true });
    }
    case "comprobar": {
      const { GARANTIA3_PROXY_URL: url, GARANTIA3_PROXY_TOKEN: proxy, GARANTIA3_TOKEN: produccion, GARANTIA3_TOKEN_TEST: test } = process.env;
      if (!url || !proxy || (!produccion && !test)) return Response.json({ error: "Faltan GARANTIA3_PROXY_URL, GARANTIA3_PROXY_TOKEN y algún token de Garantía3." }, { status: 422 });
      const probar = async (entorno: string, token: string | undefined) => {
        if (!token) return { entorno, configurado: false };
        try {
          const response = await fetch(`${url}?comprobar=1`, { method: "POST", headers: { "Content-Type": "application/json", "X-Proxy-Token": proxy }, body: JSON.stringify({ entorno, token }), cache: "no-store", signal: AbortSignal.timeout(40_000) });
          const body = await response.json() as { garantia3?: number; correcto?: boolean; error?: string };
          return { entorno, configurado: true, correcto: body.correcto === true, garantia3: body.garantia3 ?? null, error: body.error ?? null };
        } catch (caught) {
          return { entorno, configurado: true, correcto: false, garantia3: null, error: caught instanceof Error ? caught.message : "No responde el proxy." };
        }
      };
      return Response.json({ entornos: await Promise.all([probar("produccion", produccion), probar("test", test)]) });
    }
    case "vuelta": return Response.json(await vueltaGarantia3(auth.db, process.env, "manual", auth.userId));
    case "prueba":
      try { return Response.json(await enviarPedidoDePrueba(auth.db, process.env)); } catch (caught) { return Response.json({ error: caught instanceof Error ? caught.message : "No se pudo enviar la prueba." }, { status: 422 }); }
    case "reintentar": return cambiar(["error", "bloqueado"], { estado: "lista", motivo: null, ultimo_aviso: null });
    case "pedir_ya": return cambiar(["espera"], { estado: "lista" });
    case "dudoso_creado": return body.contrato?.trim() ? cambiar(["dudoso"], { estado: "creado", contrato: body.contrato.trim(), motivo: null, fecha_alta: new Date().toISOString() }) : Response.json({ error: "Falta el número de contrato." }, { status: 422 });
    case "dudoso_no_creado": return cambiar(["dudoso"], { estado: "lista", motivo: null, ultimo_aviso: null });
    case "anular": return cambiar(["creado"], { estado: "anulacion_pendiente" });
    case "anulado": return cambiar(["anulacion_pendiente"], { estado: "anulado" });
    default: return Response.json({ error: "Acción desconocida." }, { status: 400 });
  }
}
