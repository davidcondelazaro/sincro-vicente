import type { SupabaseClient } from "@supabase/supabase-js";
import { sameInvoices, sendPendingInvoiceEmails, toShopifyInvoices, writeInvoicesToShopify, type InvoiceSent, type ShopifyInvoice } from "@/lib/mhd-invoices";
import { mhdOrdersFetch } from "@/lib/mhd-order-sync";
import { invoicesFrom, type MhdOrderData } from "@/lib/mhd-order-status";

// Marca un pedido como enviado en Shopify. Lo usan el botón «Marcar enviado en Shopify» (el operador confirma o corrige
// el seguimiento de MHD) y el envío automático de la lectura de estados (docs/PEDIDOS_MHD_FASE_1.md › Automatización).
// MHD no indica qué productos lleva cada envío, así que se envía el pedido completo en un solo fulfillment
// por ubicación, con todos los números de seguimiento. La recogida en tienda no se toca.
// Requiere el permiso write_merchant_managed_fulfillment_orders en la app de Shopify.
// Antes del fulfillment se vuelven a leer las facturas en MHD y se escriben en mhd.facturas, para que la «Confirmación de
// envío» de Shopify las lleve; las que no vayan en ella salen después en el correo de factura (src/lib/mhd-invoices.ts).

export type TrackingInput = { company?: string | null; entries?: { number?: string | null; url?: string | null }[] };
type FulfillmentOrder = { id: string; status: string; deliveryMethod: { methodType: string } | null; assignedLocation: { name: string } | null; lineItems: { nodes: { remainingQuantity: number }[] } };
export type FulfillResult = { ok: true; fulfillments: number } | { ok: false; status: number; error: string; trace?: string };

function isHttpUrl(value: string) { try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; } }
function required(name: string) { const value = process.env[name]; if (!value) throw new Error(`Falta la variable ${name}.`); return value; }
async function shopify<T>(query: string, variables: Record<string, unknown>) {
  const store = required("SHOPIFY_STORE_URL").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const response = await fetch(`https://${store}/admin/api/2026-07/graphql.json`, { method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": required("SHOPIFY_ACCESS_TOKEN") }, cache: "no-store", signal: AbortSignal.timeout(20_000), body: JSON.stringify({ query, variables }) });
  const body = await response.json() as { data?: T; errors?: { message: string }[] };
  if (!response.ok || body.errors?.length) throw new Error(body.errors?.map((item) => item.message).join(" ") || `Shopify devolvió HTTP ${response.status}.`);
  return body.data!;
}

export async function fulfillShopifyOrder(db: SupabaseClient, orderId: string, tracking: TrackingInput, notifyCustomer: boolean): Promise<FulfillResult> {
  const [{ data: order }, { data: exported }] = await Promise.all([
    db.from("shopify_mhd_orders").select("id,shopify_order_id,shopify_order_name").eq("id", orderId).single(),
    db.from("mhd_order_exports").select("id,mhd_order_id,mhd_status_payload,facturas_cliente").eq("order_id", orderId).maybeSingle(),
  ]);
  if (!order) return { ok: false, status: 404, error: "No se encontró el pedido." };

  const company = tracking.company?.trim() || null;
  const entries = (tracking.entries ?? []).map((entry) => ({ number: entry.number?.trim() ?? "", url: entry.url?.trim() ?? "" })).filter((entry) => entry.number);
  if (!entries.length) return { ok: false, status: 422, error: "Falta el número de seguimiento." };
  const invalidUrl = entries.find((entry) => entry.url && !isHttpUrl(entry.url));
  if (invalidUrl) return { ok: false, status: 422, error: `El enlace de ${invalidUrl.number} no es una dirección web válida (debe empezar por https://).` };
  // Shopify empareja números y enlaces por posición: o todos llevan enlace o ninguno
  const withUrl = entries.filter((entry) => entry.url).length;
  if (withUrl && withUrl !== entries.length) return { ok: false, status: 422, error: "Si hay varios números de seguimiento, pon el enlace en todos o en ninguno." };

  try {
    const data = await shopify<{ order: { displayFulfillmentStatus: string; fulfillmentOrders: { nodes: FulfillmentOrder[] } } | null }>(
      `query Pedido($id: ID!) { order(id: $id) { displayFulfillmentStatus fulfillmentOrders(first: 20) { nodes { id status deliveryMethod { methodType } assignedLocation { name } lineItems(first: 100) { nodes { remainingQuantity } } } } } }`,
      { id: order.shopify_order_id },
    );
    if (!data.order) return { ok: false, status: 404, error: "El pedido ya no existe en Shopify." };
    const pending = data.order.fulfillmentOrders.nodes.filter((item) =>
      ["OPEN", "IN_PROGRESS"].includes(item.status)
      && item.deliveryMethod?.methodType !== "PICK_UP"
      && item.lineItems.nodes.some((line) => line.remainingQuantity > 0));
    if (!pending.length) return { ok: false, status: 422, error: `No hay nada pendiente de enviar en Shopify (${data.order.displayFulfillmentStatus}).` };

    // Facturas de MHD en mhd.facturas antes del fulfillment. Se leen de nuevo en MHD; si no responde, vale la última lectura.
    // Si falla la escritura se sigue: la factura llegará luego en su propio correo.
    const payload = (exported?.mhd_status_payload ?? {}) as { facturas?: { url_factura: string; nombre_factura: string | null }[]; facturas_en_shopify?: ShopifyInvoice[] | null };
    let invoices = payload.facturas ?? [];
    let invoicesInShopify = payload.facturas_en_shopify ?? null;
    if (exported?.mhd_order_id) {
      try {
        const response = await mhdOrdersFetch(`/orders/${exported.mhd_order_id}`, { timeoutMs: 15_000 });
        const body = await response.json().catch(() => ({})) as { success?: boolean; data?: MhdOrderData };
        if (response.ok && body.success && body.data) invoices = invoicesFrom(body.data);
      } catch { /* se usa la última lectura */ }
      const shopifyInvoices = toShopifyInvoices(invoices);
      if (shopifyInvoices.length && !sameInvoices(shopifyInvoices, invoicesInShopify)) {
        try {
          await writeInvoicesToShopify(order.shopify_order_id, shopifyInvoices);
          invoicesInShopify = shopifyInvoices;
          await db.from("mhd_order_exports").update({ mhd_status_payload: { ...payload, facturas: invoices, facturas_en_shopify: invoicesInShopify } }).eq("id", exported.id);
        } catch { /* sin factura en el correo de envío; irá aparte */ }
      }
    }

    // Un fulfillment solo puede agrupar pedidos de envío de la misma ubicación
    const byLocation = new Map<string, FulfillmentOrder[]>();
    for (const item of pending) { const key = item.assignedLocation?.name ?? "—"; byLocation.set(key, [...(byLocation.get(key) ?? []), item]); }

    const trackingInfo = { company: company ?? undefined, numbers: entries.map((entry) => entry.number), ...(withUrl ? { urls: entries.map((entry) => entry.url) } : {}) };
    const fulfillments: unknown[] = [];
    for (const [location, items] of byLocation) {
      const result = await shopify<{ fulfillmentCreate: { fulfillment: { id: string; status: string } | null; userErrors: { field: string[] | null; message: string }[] } }>(
        `mutation Enviar($fulfillment: FulfillmentInput!) { fulfillmentCreate(fulfillment: $fulfillment) { fulfillment { id status trackingInfo { company number url } } userErrors { field message } } }`,
        { fulfillment: { lineItemsByFulfillmentOrder: items.map((item) => ({ fulfillmentOrderId: item.id })), notifyCustomer, trackingInfo } },
      );
      if (result.fulfillmentCreate.userErrors.length) throw new Error(`${location}: ${result.fulfillmentCreate.userErrors.map((error) => error.message).join(" ")}`);
      fulfillments.push({ location, ...result.fulfillmentCreate.fulfillment });
    }

    await db.from("shopify_mhd_orders").update({
      fulfillment_status: "FULFILLED",
      shopify_fulfillment_payload: { mhd_tracking: (exported?.mhd_status_payload as { seguimiento?: unknown } | null)?.seguimiento ?? null, notify_customer: notifyCustomer, tracking: trackingInfo, fulfillments, created_at: new Date().toISOString() },
    }).eq("id", order.id);
    // Las facturas que estaban en mhd.facturas han ido en la «Confirmación de envío» si se avisó al cliente; si no, o
    // si llegan más tarde, sale el correo de factura.
    if (exported) {
      if (notifyCustomer && invoicesInShopify?.length) {
        const at = new Date().toISOString();
        const received = (exported.facturas_cliente ?? []) as InvoiceSent[];
        const known = new Set(received.map((item) => item.url));
        await db.from("mhd_order_exports").update({ facturas_cliente: [...received, ...invoicesInShopify.filter((invoice) => !known.has(invoice.url)).map((invoice) => ({ url: invoice.url, via: "envio", at }))] }).eq("id", exported.id);
      }
      await sendPendingInvoiceEmails(db, [exported.id]);
    }
    return { ok: true, fulfillments: fulfillments.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo marcar como enviado en Shopify.";
    const missingScope = /access denied|merchant_managed_fulfillment_orders/i.test(message);
    return { ok: false, status: 502, error: missingScope ? "La app de Shopify no tiene permiso para marcar envíos (write_merchant_managed_fulfillment_orders)." : message, trace: message };
  }
}
