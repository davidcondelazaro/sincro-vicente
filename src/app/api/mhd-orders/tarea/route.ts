import { sendEmail, settingRecipients } from "@/lib/email";
import { workerClient } from "@/lib/mhd-importer/jobs";
import { orderSettings, tareaEstados, tareaPedidos } from "@/lib/mhd-order-auto";
import { exportMhdOrder } from "@/lib/mhd-order-export";
import { horaEnMadrid } from "@/lib/mhd-order-auto-rules";
import { logOrderEvent } from "@/lib/mhd-order-events";
import { buildOrdersReport } from "@/lib/mhd-order-report";

// Tareas programadas de pedidos (docs/PEDIDOS_MHD_FASE_1.md › Automatización de pedidos). Las llama pg_cron sin sesión
// pero con la cabecera `x-mhd-import-token`: ?tipo=pedidos (cada 15 min), estados (cada 30 min) y resumen (cada hora;
// solo sale a la hora elegida en Configuración, una vez al día). `?simulacion=1` con resumen lo devuelve sin enviarlo y
// `?prueba=1` lo envía ya, marcado como prueba. ?tipo=exportar&pedido=EV… exporta ese pedido como el botón (para
// reexportar a mano uno que MHD canceló: la fila se deja antes en «ready» y se comprueba en MHD que no hay otro vigente).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const db = workerClient(process.env);
  const token = request.headers.get("x-mhd-import-token");
  const { data: valid } = token ? await db.rpc("mhd_import_token_valid", { p_token: token }) : { data: false };
  if (valid !== true) return Response.json({ error: "No autorizado" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const tipo = params.get("tipo");
  try {
    if (tipo === "pedidos") return Response.json(await tareaPedidos(db));
    if (tipo === "estados") return Response.json(await tareaEstados(db));
    if (tipo === "exportar") {
      const name = params.get("pedido") ?? "";
      const { data: order } = await db.from("shopify_mhd_orders").select("id,owner_id").eq("shopify_order_name", name).maybeSingle();
      if (!order) return Response.json({ error: `No está el pedido ${name}` }, { status: 404 });
      const result = await exportMhdOrder(db, order.owner_id as string, order.id as string);
      if (result.ok) await logOrderEvent(db, "exportado", { pedido: name, mhd: result.mhdOrderId, auto: false, recuperado: result.recovered }, name);
      else await logOrderEvent(db, "exportacion_fallida", { pedido: name, error: [result.error, ...(result.mhdErrors ?? [])].join(" "), auto: false }, name);
      return Response.json(result, { status: result.ok ? 200 : result.status });
    }
    if (tipo === "resumen") {
      const now = new Date();
      const report = await buildOrdersReport(db, now);
      if (params.get("simulacion") === "1") return Response.json({ ok: true, dryRun: true, subject: report.subject, text: report.text });
      // ?prueba=1: sale ya, a los mismos destinatarios, marcado como prueba (no cuenta como el del día)
      if (params.get("prueba") === "1") {
        const result = await sendEmail({ to: await settingRecipients(db, "pedidos_informe_emails"), subject: report.subject.replace("Utils] ", "Utils] [PRUEBA] "), html: report.html, text: report.text, idempotencyKey: `pedidos-resumen-prueba-${now.getTime()}` });
        return Response.json({ ...result, subject: report.subject }, { status: result.ok ? 200 : 502 });
      }
      const settings = await orderSettings(db);
      if (horaEnMadrid(now) !== settings.informeHora) return Response.json({ ok: true, skipped: `El resumen sale a las ${settings.informeHora}:00.` });
      const day = now.toLocaleString("sv-SE", { timeZone: "Europe/Madrid" }).slice(0, 10);
      const result = await sendEmail({ to: await settingRecipients(db, "pedidos_informe_emails"), subject: report.subject, html: report.html, text: report.text, idempotencyKey: `pedidos-resumen-${day}` });
      await db.from("mhd_sync_events").insert({ sync: "avisos", kind: "resumen", detail: { day, subject: report.subject, sent: result.ok, error: result.ok ? null : result.error } });
      return Response.json({ ...result, subject: report.subject }, { status: result.ok ? 200 : 502 });
    }
    return Response.json({ error: "Tipo desconocido" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logOrderEvent(db, "error", { proceso: tipo ?? "tarea", texto: message });
    return Response.json({ error: message }, { status: 500 });
  }
}
