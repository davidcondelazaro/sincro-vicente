import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Marca un pedido como enviado en Shopify. El operador confirma o corrige en pantalla el seguimiento que haya dado
// MHD (o lo escribe a mano): cualquier nombre de transportista y, por número, un enlace de seguimiento opcional.
// MHD no indica qué productos lleva cada envío, así que se envía el pedido completo en un solo fulfillment
// por ubicación, con todos los números de seguimiento. La recogida en tienda no se toca.
// Requiere el permiso write_merchant_managed_fulfillment_orders en la app de Shopify.

type TrackingInput = { company?: string; entries?: { number?: string; url?: string }[] };
type FulfillmentOrder = { id: string; status: string; deliveryMethod: { methodType: string } | null; assignedLocation: { name: string } | null; lineItems: { nodes: { remainingQuantity: number }[] } };

function isHttpUrl(value: string) { try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; } }

function required(name: string) { const value = process.env[name]; if (!value) throw new Error(`Falta la variable ${name}.`); return value; }
async function shopify<T>(query: string, variables: Record<string, unknown>) {
  const store = required("SHOPIFY_STORE_URL").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const response = await fetch(`https://${store}/admin/api/2026-07/graphql.json`, { method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": required("SHOPIFY_ACCESS_TOKEN") }, cache: "no-store", body: JSON.stringify({ query, variables }) });
  const body = await response.json() as { data?: T; errors?: { message: string }[] };
  if (!response.ok || body.errors?.length) throw new Error(body.errors?.map((item) => item.message).join(" ") || `Shopify devolvió HTTP ${response.status}.`);
  return body.data!;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims.sub) return Response.json({ error: "Necesitas iniciar sesión." }, { status: 401 });

  let input: { orderId?: string; tracking?: TrackingInput; notifyCustomer?: boolean };
  try { input = await request.json(); } catch { return Response.json({ error: "Solicitud no válida." }, { status: 400 }); }
  if (!input.orderId) return Response.json({ error: "Falta el pedido." }, { status: 400 });

  const [{ data: order }, { data: exported }] = await Promise.all([
    supabase.from("shopify_mhd_orders").select("id,shopify_order_id,shopify_order_name").eq("id", input.orderId).single(),
    supabase.from("mhd_order_exports").select("mhd_status_payload").eq("order_id", input.orderId).maybeSingle(),
  ]);
  if (!order) return Response.json({ error: "No se encontró el pedido." }, { status: 404 });

  const company = input.tracking?.company?.trim() || null;
  const entries = (input.tracking?.entries ?? []).map((entry) => ({ number: entry.number?.trim() ?? "", url: entry.url?.trim() ?? "" })).filter((entry) => entry.number);
  if (!entries.length) return Response.json({ error: "Falta el número de seguimiento." }, { status: 422 });
  const invalidUrl = entries.find((entry) => entry.url && !isHttpUrl(entry.url));
  if (invalidUrl) return Response.json({ error: `El enlace de ${invalidUrl.number} no es una dirección web válida (debe empezar por https://).` }, { status: 422 });
  // Shopify empareja números y enlaces por posición: o todos llevan enlace o ninguno
  const withUrl = entries.filter((entry) => entry.url).length;
  if (withUrl && withUrl !== entries.length) return Response.json({ error: "Si hay varios números de seguimiento, pon el enlace en todos o en ninguno." }, { status: 422 });

  try {
    const data = await shopify<{ order: { displayFulfillmentStatus: string; fulfillmentOrders: { nodes: FulfillmentOrder[] } } | null }>(
      `query Pedido($id: ID!) { order(id: $id) { displayFulfillmentStatus fulfillmentOrders(first: 20) { nodes { id status deliveryMethod { methodType } assignedLocation { name } lineItems(first: 100) { nodes { remainingQuantity } } } } } }`,
      { id: order.shopify_order_id },
    );
    if (!data.order) return Response.json({ error: "El pedido ya no existe en Shopify." }, { status: 404 });
    const pending = data.order.fulfillmentOrders.nodes.filter((item) =>
      ["OPEN", "IN_PROGRESS"].includes(item.status)
      && item.deliveryMethod?.methodType !== "PICK_UP"
      && item.lineItems.nodes.some((line) => line.remainingQuantity > 0));
    if (!pending.length) return Response.json({ error: `No hay nada pendiente de enviar en Shopify (${data.order.displayFulfillmentStatus}).` }, { status: 422 });

    // Un fulfillment solo puede agrupar pedidos de envío de la misma ubicación
    const byLocation = new Map<string, FulfillmentOrder[]>();
    for (const item of pending) { const key = item.assignedLocation?.name ?? "—"; byLocation.set(key, [...(byLocation.get(key) ?? []), item]); }

    const trackingInfo = { company: company ?? undefined, numbers: entries.map((entry) => entry.number), ...(withUrl ? { urls: entries.map((entry) => entry.url) } : {}) };
    const fulfillments: unknown[] = [];
    for (const [location, items] of byLocation) {
      const result = await shopify<{ fulfillmentCreate: { fulfillment: { id: string; status: string } | null; userErrors: { field: string[] | null; message: string }[] } }>(
        `mutation Enviar($fulfillment: FulfillmentInput!) { fulfillmentCreate(fulfillment: $fulfillment) { fulfillment { id status trackingInfo { company number url } } userErrors { field message } } }`,
        { fulfillment: { lineItemsByFulfillmentOrder: items.map((item) => ({ fulfillmentOrderId: item.id })), notifyCustomer: Boolean(input.notifyCustomer), trackingInfo } },
      );
      if (result.fulfillmentCreate.userErrors.length) throw new Error(`${location}: ${result.fulfillmentCreate.userErrors.map((error) => error.message).join(" ")}`);
      fulfillments.push({ location, ...result.fulfillmentCreate.fulfillment });
    }

    await supabase.from("shopify_mhd_orders").update({
      fulfillment_status: "FULFILLED",
      shopify_fulfillment_payload: { mhd_tracking: (exported?.mhd_status_payload as { seguimiento?: unknown } | null)?.seguimiento ?? null, notify_customer: Boolean(input.notifyCustomer), tracking: trackingInfo, fulfillments, created_at: new Date().toISOString() },
    }).eq("id", order.id);
    return Response.json({ fulfillments: fulfillments.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo marcar como enviado en Shopify.";
    const missingScope = /access denied|merchant_managed_fulfillment_orders/i.test(message);
    return Response.json({ error: missingScope ? "La app de Shopify no tiene permiso para marcar envíos (write_merchant_managed_fulfillment_orders)." : message, trace: message }, { status: 502 });
  }
}
