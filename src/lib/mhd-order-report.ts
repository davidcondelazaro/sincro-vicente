import type { SupabaseClient } from "@supabase/supabase-js";
import { EMAIL_PREFIX, escapeHtml } from "@/lib/email";
import { orderSettings } from "@/lib/mhd-order-auto";
import { puntoDeRecogida, type PedidoConEntrega } from "@/lib/mhd-order-lines";

// Resumen diario de pedidos (David, 17-11-2026): lo que ha pasado en las últimas 24 horas (mhd_sync_events, sync
// «pedidos», ver src/lib/mhd-order-events.ts) y lo que queda pendiente ahora mismo. Sale a la hora elegida en utils ›
// Configuración › Pedidos MHD, a sus propios destinatarios.

type Event = { kind: string; codigo: string | null; detail: Record<string, unknown>; created_at: string };
type Section = { title: string; warn?: boolean; lines: string[]; table?: { head: string[]; rows: string[][] } };
type ExportRow = { mhd_order_id: number | null; mhd_status: string | null; mhd_status_payload: { facturas?: unknown[]; seguimiento?: { tracking_number?: string }[] } | null; order: { shopify_order_name: string; fulfillment_status: string | null; cancelled_at: string | null; source_payload: PedidoConEntrega | null } | null };

const UTILS = "https://utils.electronicavicente.com";
const time = (iso: string) => new Date(iso).toLocaleString("es-ES", { timeZone: "Europe/Madrid", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const names = (events: Event[]) => [...new Set(events.map((item) => item.codigo).filter(Boolean))].join(", ");

export async function buildOrdersReport(db: SupabaseClient, now = new Date()) {
  const since = new Date(now.getTime() - 24 * 3_600_000).toISOString();
  const [eventsResult, alertsResult, exportsResult, pendingResult, settings, deliveriesResult] = await Promise.all([
    db.from("mhd_sync_events").select("kind,codigo,detail,created_at").eq("sync", "pedidos").gte("created_at", since).order("created_at").limit(5000),
    db.from("mhd_sync_events").select("detail,created_at").eq("sync", "avisos").eq("kind", "correo").like("detail->>key", "pedidos:%").gte("created_at", since).order("created_at"),
    db.from("mhd_order_exports").select("mhd_order_id,mhd_status,mhd_status_payload,order:shopify_mhd_orders(shopify_order_name,fulfillment_status,cancelled_at,source_payload)").eq("status", "exported"),
    db.from("shopify_mhd_orders").select("shopify_order_name,eligibility_status,eligibility_reason,synced_at,exportacion:mhd_order_exports(status)").is("cancelled_at", null).neq("fulfillment_status", "FULFILLED").gte("synced_at", new Date(now.getTime() - 3_600_000).toISOString()),
    orderSettings(db),
    db.from("mhd_order_deliveries").select("order_name,estado,estado_fecha,resultado,resultado_at"),
  ]);
  const events = (eventsResult.data ?? []) as Event[];
  const of = (kind: string) => events.filter((item) => item.kind === kind);
  const exported = of("exportado"); const exportFailed = of("exportacion_fallida");
  const shipped = of("enviado").filter((item) => !item.detail.yaEnShopify); const shipFailed = of("envio_fallido"); const shipReview = of("envio_revisar");
  const delivered = of("entregado"); const readyPickup = of("listo_recoger"); const deliveryReview = of("entrega_revisar");
  const states = of("estado"); const invoicesShopify = of("factura_shopify"); const cancelled = of("cancelado_shopify"); const errors = of("error");
  const invoiceEmails = of("factura_correo").reduce((total, item) => total + Number(item.detail.enviados ?? 0), 0);
  const fetched = of("traidos").reduce((acc, item) => ({ nuevos: acc.nuevos + Number(item.detail.nuevos ?? 0), actualizados: acc.actualizados + Number(item.detail.actualizados ?? 0) }), { nuevos: 0, actualizados: 0 });
  const alerts = (alertsResult.data ?? []) as { detail: { subject?: string; sent?: boolean }; created_at: string }[];

  const sections: Section[] = [];
  sections.push({
    title: "En las últimas 24 horas",
    warn: exportFailed.length + shipFailed.length + errors.length > 0,
    lines: [
      `Traídos de Shopify: ${plural(fetched.nuevos, "pedido nuevo", "pedidos nuevos")} y ${plural(fetched.actualizados, "actualización", "actualizaciones")}.`,
      `Exportados a MHD: ${exported.length}${exported.length ? ` (${names(exported)}; ${exported.filter((item) => item.detail.auto).length} automáticos)` : ""}.${exportFailed.length ? ` Fallidos: ${exportFailed.length} (${names(exportFailed)}).` : ""}`,
      `Cambios de estado en MHD: ${states.length}${states.length ? ` (${names(states)})` : ""}.`,
      `Marcados como enviados en Shopify: ${shipped.length}${shipped.length ? ` (${names(shipped)})` : ""}.${shipReview.length ? ` A revisar a mano: ${shipReview.length} (${names(shipReview)}).` : ""}${shipFailed.length ? ` Fallidos: ${shipFailed.length} (${names(shipFailed)}).` : ""}`,
      `Entregas del transportista: ${delivered.length} marcados como entregados${delivered.length ? ` (${names(delivered)})` : ""} y ${readyPickup.length} «Listo para recoger»${readyPickup.length ? ` (${names(readyPickup)})` : ""}.${deliveryReview.length ? ` A revisar a mano: ${deliveryReview.length} (${names(deliveryReview)}).` : ""}`,
      `Facturas guardadas en Shopify: ${invoicesShopify.length}${invoicesShopify.length ? ` (${names(invoicesShopify)})` : ""}. Correos de factura al cliente: ${invoiceEmails}.`,
      `Cancelados en Shopify por cancelación de MHD: ${cancelled.length}${cancelled.length ? ` (${names(cancelled)})` : ""}.`,
      `Errores: ${errors.length}. Avisos enviados: ${alerts.length}.`,
    ],
    table: states.length ? { head: ["Hora", "Pedido", "MHD", "Estado"], rows: states.map((item) => [time(item.created_at), item.codigo ?? "—", `#${item.detail.mhd ?? "—"}`, `${item.detail.de ?? "—"} → ${item.detail.a ?? "—"}`]) } : undefined,
  });

  // Ahora mismo
  type PendingRow = { shopify_order_name: string; eligibility_status: string; eligibility_reason: string | null; exportacion: { status: string } | { status: string }[] | null };
  const pending = ((pendingResult.data ?? []) as unknown as PendingRow[]).filter((row) => (Array.isArray(row.exportacion) ? row.exportacion[0]?.status : row.exportacion?.status) !== "exported");
  const rows = ((exportsResult.data ?? []) as unknown as ExportRow[]).filter((row) => row.order && !row.order.cancelled_at);
  // Recogidas en tienda: el envío no se marca en Shopify (se marca a mano al recogerlas), así que van aparte: las que
  // ya están «Listo para recoger» (desde cuándo) y las que MHD ha enviado y aún no constan en la tienda
  const recogida = (row: ExportRow) => Boolean(row.order!.source_payload && puntoDeRecogida(row.order!.source_payload));
  const sentNotClosed = rows.filter((row) => /enviado|tr[aá]nsito|finalizado/i.test(row.mhd_status ?? "") && row.order!.fulfillment_status !== "FULFILLED");
  const shippedNotMarked = sentNotClosed.filter((row) => !recogida(row));
  type DeliveryRow = { order_name: string; estado: string | null; estado_fecha: string | null; resultado: string | null; resultado_at: string | null };
  const deliveries = new Map(((deliveriesResult.data ?? []) as DeliveryRow[]).map((item) => [item.order_name, item]));
  const pickups = sentNotClosed.filter(recogida).map((row) => ({ name: row.order!.shopify_order_name, tienda: puntoDeRecogida(row.order!.source_payload!)?.name ?? "la tienda", entrega: deliveries.get(row.order!.shopify_order_name) }))
    .filter((item) => item.entrega?.resultado !== "ya_hecho"); // ya cerrada en Shopify, aunque la copia local no lo sepa
  const pickupReady = pickups.filter((item) => item.entrega?.resultado === "listo_recoger");
  const pickupOnTheWay = pickups.filter((item) => item.entrega?.resultado !== "listo_recoger");
  const cuando = (value: string | null | undefined) => (value ? new Date(value).toLocaleString("es-ES", { timeZone: "Europe/Madrid", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
  const waitingInvoice = rows.filter((row) => /enviado|tr[aá]nsito|finalizado/i.test(row.mhd_status ?? "") && !(row.mhd_status_payload?.facturas ?? []).length);
  const open = rows.filter((row) => !/enviado|tr[aá]nsito|finalizado|cancelado/i.test(row.mhd_status ?? ""));
  sections.push({
    title: "Pendiente ahora",
    warn: pending.length > 0 || shippedNotMarked.length > 0,
    lines: [
      `Pagados sin exportar a MHD: ${pending.length}${pending.length ? ` (${pending.map((row) => `${row.shopify_order_name}${row.eligibility_status === "eligible" ? "" : ` bloqueado: ${row.eligibility_reason ?? "sin motivo"}`}`).join("; ")})` : ""}.`,
      `En MHD sin enviar todavía: ${open.length}${open.length ? ` (${open.map((row) => `${row.order!.shopify_order_name} ${row.mhd_status ?? ""}`.trim()).join("; ")})` : ""}.`,
      `Enviados por MHD y sin marcar en Shopify: ${shippedNotMarked.length}${shippedNotMarked.length ? ` (${shippedNotMarked.map((row) => row.order!.shopify_order_name).join(", ")})` : ""}.`,
      `Recogidas en tienda listas para recoger: ${pickupReady.length}${pickupReady.length ? ` (${pickupReady.map((item) => `${item.name} en ${item.tienda} desde el ${cuando(item.entrega?.resultado_at)}`).join("; ")})` : ""}. Se marcan como recogidas a mano en Shopify.`,
      `Recogidas en tienda enviadas por MHD y aún sin llegar: ${pickupOnTheWay.length}${pickupOnTheWay.length ? ` (${pickupOnTheWay.map((item) => `${item.name} a ${item.tienda}${item.entrega?.resultado === "revisar" ? ", revisar a mano" : ""}`).join("; ")})` : ""}.`,
      `Enviados esperando la factura de MHD: ${waitingInvoice.length}${waitingInvoice.length ? ` (${waitingInvoice.map((row) => row.order!.shopify_order_name).join(", ")})` : ""}.`,
      `Automático: exportar ${settings.exportar.activo ? "ENCENDIDO" : "apagado"} · marcar envíos ${settings.envio.activo ? "ENCENDIDO" : "apagado"} · entregas y recogidas ${settings.entrega.activo ? "ENCENDIDO" : "apagado"}.`,
    ],
  });
  if (errors.length || alerts.length) sections.push({
    title: "Errores y avisos", warn: true,
    lines: [...errors.map((item) => `${time(item.created_at)} · ${String(item.detail.proceso ?? "")}: ${String(item.detail.texto ?? "")}`), ...alerts.map((item) => `${time(item.created_at)} · aviso: ${item.detail.subject ?? ""}${item.detail.sent === false ? " (NO SE PUDO ENVIAR)" : ""}`)],
  });

  const day = now.toLocaleDateString("es-ES", { timeZone: "Europe/Madrid", day: "numeric", month: "long" });
  const problems = exportFailed.length + shipFailed.length + shipReview.length + deliveryReview.length + errors.length;
  const subject = `${EMAIL_PREFIX} Pedidos ${day}: ${exported.length} exportados, ${shipped.length} enviados${problems ? ` · ${problems} a revisar` : ""}`;
  const text = sections.map((section) => [`${section.warn ? "⚠ " : ""}${section.title}`, ...section.lines.map((line) => `- ${line}`)].join("\n")).join("\n\n") + `\n\n${UTILS}/pedidos-mhd`;
  const td = "padding:4px 8px;border-bottom:1px solid #e4e4e7;vertical-align:top";
  const html = `<div style="font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;font-size:14px;color:#18181b">${sections.map((section) => `<h2 style="font-size:16px;margin:20px 0 6px;color:${section.warn ? "#b45309" : "#18181b"}">${section.warn ? "⚠ " : ""}${escapeHtml(section.title)}</h2><ul style="margin:0;padding-left:18px">${section.lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>${section.table ? `<table style="border-collapse:collapse;margin-top:8px;font-size:13px"><thead><tr>${section.table.head.map((head) => `<th style="${td};text-align:left;background:#f4f4f5">${escapeHtml(head)}</th>`).join("")}</tr></thead><tbody>${section.table.rows.map((row) => `<tr>${row.map((cell) => `<td style="${td}">${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>` : ""}`).join("")}<p style="margin-top:20px"><a href="${UTILS}/pedidos-mhd">Abrir Pedidos MHD</a></p></div>`;
  return { subject, text, html, sections };
}
