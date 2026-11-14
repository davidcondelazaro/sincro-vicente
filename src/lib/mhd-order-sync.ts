import type { SupabaseClient } from "@supabase/supabase-js";
import { buildMhdProductLines, direccionDeExportacion, estadoDeEnvio, pedidoSinEnvio, puntoDeRecogida, type PedidoConEntrega } from "@/lib/mhd-order-lines";
import { sameInvoices, sendPendingInvoiceEmails, toShopifyInvoices, writeInvoicesToShopify } from "@/lib/mhd-invoices";
import { mhdApiUrl, mhdConfigFromEnv, mhdFetch } from "@/lib/mhd-importer/sources";
import { invoicesFrom, trackingFrom, type MhdOrderData } from "@/lib/mhd-order-status";
import { debeCancelarEnShopify, otrosVigentes, type MhdFoundOrder } from "@/lib/mhd-order-reconcile";

// Lectura de pedidos de Shopify y de estados de MHD. La usan los botones de Pedidos MHD (con la sesión) y la tarea
// diaria de Garantía3 (docs/GARANTIA3.md), para que haya una sola forma de traerlos.

type MoneySet = { shopMoney: { amount: string } };
type DiscountApplication = { __typename: string; allocationMethod: string; targetSelection: string; targetType: string; value: { amount?: string; currencyCode?: string; percentage?: number }; code?: string; title?: string };
type ShopifyAddress = { name: string | null; firstName: string | null; lastName: string | null; company: string | null; address1: string | null; address2: string | null; city: string | null; zip: string | null; phone: string | null; countryCodeV2: string | null; provinceCode: string | null; province: string | null };
type ShopifyOrder = PedidoConEntrega & { id: string; name: string; createdAt: string; updatedAt: string; cancelledAt: string | null; displayFinancialStatus: string; displayFulfillmentStatus: string; email: string | null; note: string | null; customAttributes: { key: string; value: string | null }[]; customer: { displayName: string } | null; currencyCode: string; discountCodes: string[]; discountApplications: { nodes: DiscountApplication[] }; currentSubtotalPriceSet: MoneySet; currentTotalDiscountsSet: MoneySet; currentShippingPriceSet: MoneySet; currentTotalPriceSet: MoneySet; shippingAddress: ShopifyAddress | null; billingAddress: ShopifyAddress | null; lineItems: { nodes: { id: string; sku: string | null; title: string; quantity: number; requiresShipping: boolean; unfulfilledQuantity: number; discountedUnitPriceSet: MoneySet; product: { id: string; metafield: { value: string } | null } | null; lineItemGroup: { id: string; quantity: number; variantSku: string | null; productId: string | null } | null }[] } };
type ProvinceMapping = { country_iso_2: string; shopify_province_code: string; active: boolean; mhd_province_id: number; mhd_province_name: string };

function required(name: string) { const value = process.env[name]; if (!value) throw new Error(`Falta la variable ${name}.`); return value; }
export function messageOf(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    const code = "code" in error && typeof error.code === "string" ? ` (${error.code})` : "";
    const details = "details" in error && typeof error.details === "string" && error.details ? ` ${error.details}` : "";
    return `${error.message}${code}${details}`;
  }
  return "No se pudieron actualizar los pedidos.";
}
function fulfillmentStatus(order: ShopifyOrder) {
  return estadoDeEnvio(order.displayFulfillmentStatus, order.lineItems.nodes);
}
function exportAddress(order: ShopifyOrder) {
  return direccionDeExportacion(order, order.lineItems.nodes);
}
function eligibility(order: ShopifyOrder, provinceMapping: ProvinceMapping | undefined) {
  const address = exportAddress(order);
  if (order.cancelledAt) return ["blocked", "Pedido cancelado en Shopify"] as const;
  if (order.displayFinancialStatus !== "PAID") return ["blocked", "Pendiente de pago"] as const;
  // Sin líneas con envío no hay nada que esperar: Shopify da por enviadas las tarjetas regalo nada más pagarlas
  if (fulfillmentStatus(order) === "FULFILLED" && !pedidoSinEnvio(order.lineItems.nodes)) return ["blocked", "Ya enviado completamente en Shopify"] as const;
  if (!order.email?.trim()) return ["blocked", "Falta el email del cliente"] as const;
  if (!address || !["ES", "PT"].includes(address.countryCodeV2 ?? "")) return ["blocked", "Destino fuera de España o Portugal"] as const;
  if (!address.provinceCode) return ["blocked", "Falta provincia o distrito en la dirección"] as const;
  if (!address.address1?.trim() || !address.city?.trim() || !address.zip?.trim()) return ["blocked", "Falta calle, localidad o código postal en la dirección de envío"] as const;
  if (order.lineItems.nodes.some((line) => !line.sku)) return ["blocked", "Hay líneas sin SKU"] as const;
  if (!provinceMapping) return ["blocked", "No hay correspondencia de provincia entre Shopify y MHD"] as const;
  if (!provinceMapping.active) return ["blocked", `MHD no presta envío en ${provinceMapping.mhd_province_name}`] as const;
  const mhdLines = buildMhdProductLines({
    lines: order.lineItems.nodes.map((line) => ({ sku: line.sku, quantity: line.quantity, unitPrice: line.discountedUnitPriceSet.shopMoney.amount, payload: line })),
    destination: { country: address.countryCodeV2, province: address.provinceCode, postalCode: address.zip },
    shippingAmount: order.currentShippingPriceSet.shopMoney.amount,
    recogida: Boolean(puntoDeRecogida(order)),
  });
  if (!mhdLines.ok) return ["blocked", mhdLines.reason] as const;
  // Sin NIF se exporta con un espacio en blanco (MHD rechaza el vacío; David, 14-11-2026: a probar)
  const notes = [puntoDeRecogida(order) ? `Recogida en ${puntoDeRecogida(order)!.name}` : null, address.company?.trim() ? null : "Sin NIF: se envía un espacio en blanco", mhdLines.warning];
  return ["eligible", notes.filter(Boolean).join(" · ") || null] as const;
}
function discountSummary(order: ShopifyOrder) {
  const labels = new Set([...order.discountCodes, ...order.discountApplications.nodes.map((discount) => discount.code ?? discount.title ?? discount.__typename.replace("DiscountApplication", ""))]);
  return [...labels].filter(Boolean).join(" · ") || null;
}

type MhdStatusEntry = { estado?: string; fecha?: number | string | null };
type MhdOrderResponse = { success?: boolean; data?: MhdOrderData };

// Todas las llamadas de pedidos a MHD salen por aquí, para que pasen por el proxy de Pladisel cuando esté
// configurado (ver mhdFetch en mhd-importer/sources.ts).
export function mhdOrdersFetch(path: string, options: { method?: "GET" | "POST"; body?: string; timeoutMs: number }) {
  const config = mhdConfigFromEnv(process.env);
  return mhdFetch(config, mhdApiUrl(config, path), options);
}
function dateFromMhd(value: MhdStatusEntry["fecha"]) {
  if (typeof value === "number") return new Date(value).toISOString();
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}
// Interruptor y corte en utils (store_settings), apagado por defecto. Ver docs/PEDIDOS_MHD_FASE_1.md › Cancelados en MHD.
async function cancelSettings(db: SupabaseClient) {
  const { data } = await db.from("store_settings").select("key,value").in("key", ["cancelar_en_shopify_activo", "cancelar_en_shopify_desde"]);
  const values = new Map((data ?? []).map((row) => [row.key as string, row.value as unknown]));
  const desde = typeof values.get("cancelar_en_shopify_desde") === "string" ? String(values.get("cancelar_en_shopify_desde")) : null;
  return { activo: values.get("cancelar_en_shopify_activo") === true && Boolean(desde), desde };
}
async function otherActiveInMhd(reference: string, mhdOrderId: number) {
  const response = await mhdOrdersFetch(`/orders?referencia_web=${encodeURIComponent(reference)}`, { timeoutMs: 20_000 });
  const body = await response.json().catch(() => ({})) as { success?: boolean; data?: MhdFoundOrder[] };
  if (!response.ok || !body.success) throw new Error(`MHD respondió HTTP ${response.status} al buscar otros pedidos con la referencia ${reference}.`);
  // El estado se lee del detalle, como en la exportación: la búsqueda no trae todos los campos
  const details = await Promise.all((body.data ?? []).filter((order) => order.id !== mhdOrderId).map(async (order) => {
    const detail = await mhdOrdersFetch(`/orders/${order.id}`, { timeoutMs: 20_000 });
    const detailBody = await detail.json().catch(() => ({})) as { success?: boolean; data?: MhdFoundOrder };
    if (!detail.ok || !detailBody.success || !detailBody.data) throw new Error(`MHD respondió HTTP ${detail.status} al leer el pedido #${order.id}.`);
    return detailBody.data;
  }));
  return otrosVigentes(details, mhdOrderId);
}
// Sin reembolso (se hace a mano) y con el correo de cancelación de Shopify al cliente. Devuelve el resultado para
// guardarlo: no se reintenta, para no repetir un error cada 30 minutos.
async function cancelInShopify(shopifyOrderId: string, mhdOrderId: number) {
  const store = required("SHOPIFY_STORE_URL").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const response = await fetch(`https://${store}/admin/api/2026-07/graphql.json`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": required("SHOPIFY_ACCESS_TOKEN") }, cache: "no-store", signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({
      query: "mutation($id: ID!, $note: String) { orderCancel(orderId: $id, reason: OTHER, restock: true, notifyCustomer: true, refundMethod: { originalPaymentMethodsRefund: false }, staffNote: $note) { job { id } orderCancelUserErrors { message } } }",
      variables: { id: shopifyOrderId, note: `Cancelado en MHD (pedido #${mhdOrderId}). Reembolso pendiente, a mano.` },
    }),
  });
  const body = await response.json().catch(() => ({})) as { data?: { orderCancel?: { job?: { id: string } | null; orderCancelUserErrors: { message: string }[] } }; errors?: { message: string }[] };
  const userErrors = body.data?.orderCancel?.orderCancelUserErrors ?? [];
  const error = body.errors?.map((item) => item.message).join(" ") || userErrors.map((item) => item.message).join("; ") || (!response.ok || !body.data?.orderCancel ? `Shopify devolvió HTTP ${response.status}.` : null);
  return { at: new Date().toISOString(), ok: !error, job: body.data?.orderCancel?.job?.id ?? null, error };
}
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function syncShopifyOrders(db: SupabaseClient, ownerId: string, progress: { stage: string } = { stage: "" }) {
  const store = required("SHOPIFY_STORE_URL").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const orders: ShopifyOrder[] = [];
  let cursor: string | null = null;
  do {
    const response = await fetch(`https://${store}/admin/api/2026-07/graphql.json`, { method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": required("SHOPIFY_ACCESS_TOKEN") }, cache: "no-store", body: JSON.stringify({ query: `query RecentOrders($cursor: String) { orders(first: 100, after: $cursor, query: "financial_status:paid (fulfillment_status:unfulfilled OR fulfillment_status:partial OR delivery_method:none)", sortKey: UPDATED_AT, reverse: true) { nodes { id name createdAt updatedAt cancelledAt displayFinancialStatus displayFulfillmentStatus email note customAttributes { key value } customer { displayName } currencyCode discountCodes discountApplications(first: 50) { nodes { __typename allocationMethod targetSelection targetType value { ... on MoneyV2 { amount currencyCode } ... on PricingPercentageValue { percentage } } ... on DiscountCodeApplication { code } ... on AutomaticDiscountApplication { title } ... on ManualDiscountApplication { title } ... on ScriptDiscountApplication { title } } } currentSubtotalPriceSet { shopMoney { amount } } currentTotalDiscountsSet { shopMoney { amount } } currentShippingPriceSet { shopMoney { amount } } currentTotalPriceSet { shopMoney { amount } } shippingAddress { name firstName lastName company address1 address2 city zip phone countryCodeV2 provinceCode province } billingAddress { name firstName lastName company address1 address2 city zip phone countryCodeV2 provinceCode province } fulfillmentOrders(first: 10) { nodes { deliveryMethod { methodType } destination { location { name address { address1 address2 city zip provinceCode province countryCode phone } } } } } lineItems(first: 250) { nodes { id sku title quantity requiresShipping unfulfilledQuantity discountedUnitPriceSet { shopMoney { amount } } product { id metafield(namespace: \"custom\", key: \"opciones_entrega\") { value } } lineItemGroup { id quantity variantSku productId } } } } pageInfo { hasNextPage endCursor } } }`, variables: { cursor } }) });
    const body = await response.json() as { data?: { orders?: { nodes: ShopifyOrder[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } }; errors?: { message: string }[] };
    if (!response.ok || body.errors?.length) throw new Error(body.errors?.map((item) => item.message).join(" ") || `Shopify devolvió HTTP ${response.status}.`);
    const connection = body.data?.orders;
    orders.push(...(connection?.nodes ?? []));
    cursor = connection?.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
  } while (cursor);
  progress.stage = "cargando las correspondencias de provincias";
  const { data: provinceMappings, error: provinceMappingsError } = await db
    .from("mhd_order_province_mappings")
    .select("country_iso_2,shopify_province_code,active,mhd_province_id,mhd_province_name");
  if (provinceMappingsError) throw provinceMappingsError;
  const provinceMappingByKey = new Map(
    ((provinceMappings ?? []) as ProvinceMapping[]).map((mapping) => [`${mapping.country_iso_2}:${mapping.shopify_province_code}`, mapping]),
  );
  const { data: storedOrders, error: storedOrdersError } = await db.from("shopify_mhd_orders").select("shopify_order_id,source_updated_at").in("shopify_order_id", orders.map((order) => order.id));
  if (storedOrdersError) throw storedOrdersError;
  const storedByShopifyId = new Map((storedOrders ?? []).map((order) => [order.shopify_order_id, order.source_updated_at]));
  let createdCount = 0;
  let updatedCount = 0;
  for (const order of orders) {
    progress.stage = `guardando el pedido ${order.name}`;
    const previousUpdatedAt = storedByShopifyId.get(order.id);
    if (!previousUpdatedAt) createdCount += 1;
    else if (new Date(previousUpdatedAt).getTime() !== new Date(order.updatedAt).getTime()) updatedCount += 1;
    const address = exportAddress(order);
    const provinceMapping = address?.countryCodeV2 && address.provinceCode
      ? provinceMappingByKey.get(`${address.countryCodeV2}:${address.provinceCode}`)
      : undefined;
    const [eligibilityStatus, eligibilityReason] = eligibility(order, provinceMapping);
    const { data: saved, error } = await db.from("shopify_mhd_orders").upsert({ owner_id: ownerId, shopify_order_id: order.id, shopify_order_name: order.name, financial_status: order.displayFinancialStatus, fulfillment_status: fulfillmentStatus(order), cancelled_at: order.cancelledAt, email: order.email, order_note: order.note, currency_code: order.currencyCode, discount_codes: order.discountCodes, discount_summary: discountSummary(order), discount_applications: order.discountApplications.nodes, subtotal_amount: order.currentSubtotalPriceSet.shopMoney.amount, discount_amount: order.currentTotalDiscountsSet.shopMoney.amount, shipping_amount: order.currentShippingPriceSet.shopMoney.amount, total_amount: order.currentTotalPriceSet.shopMoney.amount, shipping_country_code: address?.countryCodeV2 ?? null, shipping_province_code: address?.provinceCode ?? null, shipping_province_name: address?.province ?? null, eligibility_status: eligibilityStatus, eligibility_reason: eligibilityReason, source_updated_at: order.updatedAt, source_payload: order, synced_at: new Date().toISOString() }, { onConflict: "owner_id,shopify_order_id" }).select("id").single();
    if (error || !saved) throw error ?? new Error("No se pudo guardar un pedido de Shopify.");
    const lines = order.lineItems.nodes.map((line) => ({ order_id: saved.id, shopify_line_id: line.id, sku: line.sku, title: line.title, quantity: line.quantity, unit_price: line.discountedUnitPriceSet.shopMoney.amount, line_payload: line }));
    if (lines.length) { const { error: lineError } = await db.from("shopify_mhd_order_lines").upsert(lines, { onConflict: "order_id,shopify_line_id" }); if (lineError) throw lineError; }
  }
  return { count: orders.length, createdCount, updatedCount };
}

export async function refreshMhdStatuses(db: SupabaseClient) {
  const { data: exports, error: exportsError } = await db
    .from("mhd_order_exports")
    .select("id,mhd_order_id,mhd_reference_web,mhd_status,mhd_status_payload,order:shopify_mhd_orders(shopify_order_id,cancelled_at)")
    .eq("status", "exported")
    .not("mhd_order_id", "is", null);
  if (exportsError) throw new Error("No se pudieron cargar los pedidos exportados.");

  const cancelling = await cancelSettings(db);
  let checkedCount = 0;
  let changedCount = 0;
  let cancelledCount = 0;
  const errors: string[] = [];
  for (const item of exports ?? []) {
    try {
      const response = await mhdOrdersFetch(`/orders/${item.mhd_order_id}`, { timeoutMs: 20_000 });
      const body = await response.json().catch(() => ({})) as MhdOrderResponse;
      if (!response.ok || !body.success || !body.data) throw new Error(`MHD respondió HTTP ${response.status}.`);
      checkedCount += 1;
      const received = (body.data.arr_estados ?? []).filter((entry) => entry.estado).map((entry) => ({ status: entry.estado!, occurred_at: dateFromMhd(entry.fecha), source_payload: entry }));
      const latest = received.sort((a, b) => (b.occurred_at ?? "").localeCompare(a.occurred_at ?? ""))[0];
      const currentStatus = body.data.estado_cliente ?? latest?.status ?? item.mhd_status;
      const invoices = invoicesFrom(body.data);
      const previous = (item.mhd_status_payload ?? {}) as { facturas_en_shopify?: unknown; cancelacion_shopify?: unknown };
      let invoicesInShopify = previous.facturas_en_shopify ?? null;
      const shopifyInvoices = toShopifyInvoices(invoices);
      const shopifyOrder = item.order as unknown as { shopify_order_id: string; cancelled_at: string | null } | null;
      const shopifyOrderId = shopifyOrder?.shopify_order_id;
      let cancellation = previous.cancelacion_shopify ?? null;
      const cancelledAtMhd = received.filter((entry) => /cancel/i.test(entry.status)).map((entry) => entry.occurred_at).filter(Boolean).sort().at(-1) ?? null;
      if (shopifyOrderId && debeCancelarEnShopify({ activo: cancelling.activo, desde: cancelling.desde, pedido: body.data as MhdFoundOrder, canceladoEn: cancelledAtMhd, yaIntentado: Boolean(cancellation), canceladoEnShopify: Boolean(shopifyOrder?.cancelled_at) })) {
        const others = await otherActiveInMhd(item.mhd_reference_web, item.mhd_order_id);
        if (!others.length) {
          cancellation = await cancelInShopify(shopifyOrderId, item.mhd_order_id);
          if ((cancellation as { ok: boolean }).ok) cancelledCount += 1;
          else errors.push(`Pedido MHD #${item.mhd_order_id}: no se canceló en Shopify. ${(cancellation as { error: string }).error}`);
        }
      }
      // Facturas en el metacampo mhd.facturas (src/lib/mhd-invoices.ts), solo si la lista cambia respecto a la última
      // escrita: sin leer Shopify, y lo corregido a mano se respeta hasta que MHD cambie. Sin facturas no se toca.
      if (shopifyInvoices.length && shopifyOrderId && !sameInvoices(shopifyInvoices, invoicesInShopify)) {
        try {
          await writeInvoicesToShopify(shopifyOrderId, shopifyInvoices);
          invoicesInShopify = shopifyInvoices;
        } catch (error) {
          errors.push(`Pedido MHD #${item.mhd_order_id}: ${error instanceof Error ? error.message : "no se guardaron las facturas en Shopify."}`);
        }
      }
      const statusPayload = {
        estado_cliente: body.data.estado_cliente ?? null, id_estado_cliente: body.data.id_estado_cliente ?? null, arr_estados: body.data.arr_estados ?? [],
        seguimiento: trackingFrom(body.data), facturas: invoices,
        // Última lista escrita en el metacampo mhd.facturas del pedido de Shopify
        facturas_en_shopify: invoicesInShopify,
        // Cancelación en Shopify de un pedido cancelado en MHD: { at, ok, job, error }. Se intenta una sola vez.
        cancelacion_shopify: cancellation,
        // Respuesta completa de MHD tal como llega, para no perder ningún campo que añadan
        respuesta_mhd: body.data,
      };
      const changed = currentStatus !== item.mhd_status || canonicalJson(item.mhd_status_payload ?? null) !== canonicalJson(statusPayload);
      if (changed) changedCount += 1;
      await db.from("mhd_order_exports").update({ mhd_status: currentStatus, mhd_status_payload: statusPayload, mhd_status_updated_at: latest?.occurred_at ?? new Date().toISOString(), last_checked_at: new Date().toISOString() }).eq("id", item.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error desconocido.";
      errors.push(`Pedido MHD #${item.mhd_order_id}: ${message}`);
      await db.from("mhd_order_exports").update({ last_checked_at: new Date().toISOString() }).eq("id", item.id);
    }
  }
  // Correo de factura a quien aún no la tenga (apagado por defecto: utils › store_settings factura_correo_activo)
  const invoiceEmails = await sendPendingInvoiceEmails(db, (exports ?? []).map((item) => item.id));
  errors.push(...invoiceEmails.errors);
  return { checkedCount, changedCount, cancelledCount, errors, invoiceEmailsSent: invoiceEmails.sent };
}
