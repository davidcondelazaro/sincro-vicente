import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendAlert } from "@/lib/mhd-importer/alerts";
import { decidirEnvio, enHorarioLaboral, listoParaExportarAuto, type Seguimiento } from "@/lib/mhd-order-auto-rules";
import { logOrderEvent } from "@/lib/mhd-order-events";
import { exportMhdOrder } from "@/lib/mhd-order-export";
import { fulfillShopifyOrder } from "@/lib/mhd-order-fulfill";
import { puntoDeRecogida, type PedidoConEntrega } from "@/lib/mhd-order-lines";
import { refreshMhdStatuses, syncShopifyOrders } from "@/lib/mhd-order-sync";

// Tareas programadas de pedidos (docs/PEDIDOS_MHD_FASE_1.md › Automatización de pedidos, 17-11-2026):
// - tareaPedidos, cada 15 min: trae los pedidos de Shopify, exporta a MHD los listos (si está encendido) y avisa de los
//   pagados que siguen sin exportar.
// - tareaEstados, cada 30 min: lee los estados de MHD (facturas, cancelaciones), marca en Shopify los enviados (si está
//   encendido) y avisa de los errores.
// Interruptores en utils › Configuración › Pedidos MHD (store_settings).

const PAGE = "/pedidos-mhd";
const DAY = 24 * 60;
const MAX_EXPORTS_PER_RUN = 10;
const hash = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 12);

export async function orderSettings(db: SupabaseClient) {
  const { data } = await db.from("store_settings").select("key,value").like("key", "pedidos_%");
  const values = new Map((data ?? []).map((row) => [row.key as string, row.value as unknown]));
  const text = (key: string) => (typeof values.get(key) === "string" ? String(values.get(key)) : null);
  const number = (key: string, fallback: number) => (typeof values.get(key) === "number" ? Number(values.get(key)) : fallback);
  return {
    exportar: { activo: values.get("pedidos_exportar_auto_activo") === true && Boolean(text("pedidos_exportar_auto_desde")), desde: text("pedidos_exportar_auto_desde"), margenMinutos: number("pedidos_exportar_margen_minutos", 30) },
    envio: { activo: values.get("pedidos_envio_auto_activo") === true },
    avisoSinExportarHoras: number("pedidos_aviso_sin_exportar_horas", 2),
    informeHora: number("pedidos_informe_hora", 9),
  };
}

// Avisos de pedidos: a sus propios destinatarios (pedidos_avisos_emails)
const orderAlert = (db: SupabaseClient, alert: { key: string; subject: string; lines: string[]; quietMinutes?: number }) =>
  sendAlert(db, { ...alert, href: PAGE, recipientsKey: "pedidos_avisos_emails" });

async function ownerId(db: SupabaseClient) {
  const { data } = await db.from("shopify_mhd_orders").select("owner_id").order("synced_at", { ascending: false }).limit(1).maybeSingle();
  return (data?.owner_id as string | undefined) ?? null;
}

type PendingRow = { id: string; shopify_order_name: string; eligibility_status: string; eligibility_reason: string | null; creado: string | null; exportacion: { status: string } | { status: string }[] | null };
const exportStatus = (row: PendingRow) => (Array.isArray(row.exportacion) ? row.exportacion[0]?.status : row.exportacion?.status) ?? null;

export async function tareaPedidos(db: SupabaseClient, now = new Date()) {
  const startedAt = new Date().toISOString();
  const errors: string[] = [];
  const owner = await ownerId(db);
  if (!owner) throw new Error("No hay usuario con pedidos sincronizados: pulsa una vez «Traer pedidos» en Pedidos MHD.");
  const settings = await orderSettings(db);

  let fetched: Awaited<ReturnType<typeof syncShopifyOrders>>;
  try {
    fetched = await syncShopifyOrders(db, owner);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logOrderEvent(db, "error", { proceso: "traer pedidos", texto: message });
    await orderAlert(db, { key: "pedidos:shopify", subject: "Pedidos: no se pudieron traer de Shopify", lines: ["La tarea de cada 15 minutos no ha podido leer los pedidos de Shopify:", message] });
    throw error;
  }
  if (fetched.createdCount || fetched.updatedCount) await logOrderEvent(db, "traidos", { nuevos: fetched.createdCount, actualizados: fetched.updatedCount, total: fetched.count });

  // Pendientes: los que Shopify sigue dando como pagados y sin enviar en esta lectura, sin cancelar y sin exportar
  const { data, error } = await db.from("shopify_mhd_orders")
    .select("id,shopify_order_name,eligibility_status,eligibility_reason,creado:source_payload->>createdAt,exportacion:mhd_order_exports(status)")
    .gte("synced_at", startedAt).is("cancelled_at", null).neq("fulfillment_status", "FULFILLED");
  if (error) throw new Error(`No se pudieron leer los pedidos pendientes: ${error.message}`);
  const pending = ((data ?? []) as unknown as PendingRow[]).filter((row) => exportStatus(row) !== "exported");

  const exported: string[] = [];
  if (settings.exportar.activo) {
    const ready = pending.filter((row) => listoParaExportarAuto({ elegible: row.eligibility_status === "eligible", creado: row.creado, desde: settings.exportar.desde, margenMinutos: settings.exportar.margenMinutos, ahora: now, estadoExportacion: exportStatus(row) }));
    for (const row of ready.slice(0, MAX_EXPORTS_PER_RUN)) {
      try {
        const result = await exportMhdOrder(db, owner, row.id);
        if (result.ok) {
          exported.push(row.shopify_order_name);
          await logOrderEvent(db, "exportado", { pedido: row.shopify_order_name, mhd: result.mhdOrderId, auto: true, recuperado: result.recovered }, row.shopify_order_name);
        } else {
          const motivo = [result.error, ...(result.mhdErrors ?? [])].join(" ");
          await logOrderEvent(db, "exportacion_fallida", { pedido: row.shopify_order_name, error: motivo, auto: true }, row.shopify_order_name);
          await orderAlert(db, { key: `pedidos:exportar:${row.shopify_order_name}:${hash(motivo)}`, quietMinutes: DAY, subject: `Pedido ${row.shopify_order_name}: no se pudo exportar a MHD`, lines: [`La exportación automática de ${row.shopify_order_name} ha fallado:`, motivo, result.trace ?? ""].filter(Boolean) });
        }
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        errors.push(`${row.shopify_order_name}: ${message}`);
        await logOrderEvent(db, "exportacion_fallida", { pedido: row.shopify_order_name, error: message, auto: true }, row.shopify_order_name);
        await orderAlert(db, { key: `pedidos:exportar:${row.shopify_order_name}:${hash(message)}`, quietMinutes: DAY, subject: `Pedido ${row.shopify_order_name}: no se pudo exportar a MHD`, lines: [`La exportación automática de ${row.shopify_order_name} ha fallado:`, message] });
      }
    }
  }

  // Aviso de pagados sin exportar desde hace más de X horas (listos y bloqueados), en horario laboral. Se repite como
  // mucho una vez al día si la lista no cambia; una lista distinta avisa al momento.
  const limit = now.getTime() - settings.avisoSinExportarHoras * 3_600_000;
  const late = pending.filter((row) => !exported.includes(row.shopify_order_name) && row.creado && new Date(row.creado).getTime() <= limit)
    .sort((a, b) => a.shopify_order_name.localeCompare(b.shopify_order_name));
  if (late.length && enHorarioLaboral(now)) {
    const lines = late.map((row) => `${row.shopify_order_name} · ${row.eligibility_status === "eligible" ? "listo para exportar" : `BLOQUEADO: ${row.eligibility_reason ?? "sin motivo"}`}${exportStatus(row) === "failed" ? " · el último intento falló" : ""}`);
    await orderAlert(db, { key: `pedidos:sin-exportar:${hash(lines.join("|"))}`, quietMinutes: DAY, subject: `${late.length} ${late.length === 1 ? "pedido pagado sin exportar" : "pedidos pagados sin exportar"} a MHD`, lines: [`Llevan más de ${settings.avisoSinExportarHoras} h pagados y no están en MHD:`, ...lines] });
  }
  return { traidos: fetched, pendientes: pending.length, exportados: exported, avisados: late.length, errors };
}

type ShippedRow = { id: string; mhd_order_id: number; mhd_status: string | null; mhd_status_payload: { id_estado_cliente?: number | null; estado_cliente?: string | null; seguimiento?: Seguimiento[] } | null; order: { id: string; shopify_order_name: string; fulfillment_status: string | null; cancelled_at: string | null; source_payload: PedidoConEntrega | null } | null };

// Marca en Shopify, con aviso al cliente, los pedidos que MHD da por enviados. Cada pedido se intenta una vez: un fallo
// o un caso a revisar queda en el registro y avisa, y no se repite (se resuelve a mano con «Marcar enviado en Shopify»).
async function autoFulfill(db: SupabaseClient) {
  const { data, error } = await db.from("mhd_order_exports")
    .select("id,mhd_order_id,mhd_status,mhd_status_payload,order:shopify_mhd_orders(id,shopify_order_name,fulfillment_status,cancelled_at,source_payload)")
    .eq("status", "exported").not("mhd_order_id", "is", null);
  if (error) throw new Error(`No se pudieron leer los pedidos exportados: ${error.message}`);
  const rows = ((data ?? []) as unknown as ShippedRow[]).filter((row) => row.order && !row.order.cancelled_at && row.order.fulfillment_status !== "FULFILLED");
  const names = rows.map((row) => row.order!.shopify_order_name);
  const { data: done } = names.length ? await db.from("mhd_sync_events").select("codigo").eq("sync", "pedidos").in("kind", ["enviado", "envio_fallido", "envio_revisar"]).in("codigo", names) : { data: [] };
  const attempted = new Set((done ?? []).map((row) => row.codigo as string));
  const result = { marcados: [] as string[], revisar: [] as string[], fallidos: [] as string[] };

  for (const row of rows) {
    const order = row.order!;
    const name = order.shopify_order_name;
    if (attempted.has(name)) continue;
    if (order.source_payload && puntoDeRecogida(order.source_payload)) continue; // recogida en tienda: a mano
    const decision = decidirEnvio(row.mhd_status_payload?.id_estado_cliente, row.mhd_status_payload?.estado_cliente ?? row.mhd_status, row.mhd_status_payload?.seguimiento ?? []);
    if (decision.accion === "esperar") continue;
    if (decision.accion === "revisar") {
      result.revisar.push(name);
      await logOrderEvent(db, "envio_revisar", { pedido: name, mhd: row.mhd_order_id, motivo: decision.motivo }, name);
      await orderAlert(db, { key: `pedidos:envio-revisar:${name}`, quietMinutes: 30 * DAY, subject: `Pedido ${name}: envío sin marcar en Shopify`, lines: [`MHD da el pedido ${name} (#${row.mhd_order_id}) por enviado, pero no se marca solo:`, decision.motivo, "Márcalo a mano con «Marcar enviado en Shopify»."] });
      continue;
    }
    const fulfilled = await fulfillShopifyOrder(db, order.id, { company: decision.company, entries: [{ number: decision.number, url: decision.url }] }, true);
    if (fulfilled.ok) {
      result.marcados.push(name);
      await logOrderEvent(db, "enviado", { pedido: name, mhd: row.mhd_order_id, seguimiento: decision.number, transportista: decision.company, auto: true }, name);
    } else if (fulfilled.error.startsWith("No hay nada pendiente de enviar")) {
      // Ya marcado en el admin de Shopify: se anota y no se avisa
      await db.from("shopify_mhd_orders").update({ fulfillment_status: "FULFILLED" }).eq("id", order.id);
      await logOrderEvent(db, "enviado", { pedido: name, mhd: row.mhd_order_id, yaEnShopify: true, auto: true }, name);
    } else {
      result.fallidos.push(name);
      await logOrderEvent(db, "envio_fallido", { pedido: name, mhd: row.mhd_order_id, error: fulfilled.error }, name);
      await orderAlert(db, { key: `pedidos:envio-fallido:${name}`, quietMinutes: 30 * DAY, subject: `Pedido ${name}: no se pudo marcar el envío en Shopify`, lines: [`MHD da el pedido ${name} (#${row.mhd_order_id}) por enviado con el seguimiento ${decision.number}, pero Shopify ha dado error:`, fulfilled.error, "Márcalo a mano con «Marcar enviado en Shopify»."] });
    }
  }
  return result;
}

export async function tareaEstados(db: SupabaseClient) {
  const settings = await orderSettings(db);
  const statuses = await refreshMhdStatuses(db);
  const errors = [...statuses.errors];
  let envios: Awaited<ReturnType<typeof autoFulfill>> | null = null;
  if (settings.envio.activo) {
    try { envios = await autoFulfill(db); } catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
  }
  if (errors.length) {
    for (const text of errors) await logOrderEvent(db, "error", { proceso: "estados de MHD", texto: text });
    // Un aviso por lista de errores: si se repite igual, como mucho una vez al día
    await orderAlert(db, { key: `pedidos:estados:${hash([...errors].sort().join("|"))}`, quietMinutes: DAY, subject: `Pedidos: ${errors.length} ${errors.length === 1 ? "error" : "errores"} al leer los estados de MHD`, lines: errors });
  }
  return { ...statuses, envios, errors };
}
