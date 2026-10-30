import type { SupabaseClient } from "@supabase/supabase-js";
import { buildMhdProductLines } from "@/lib/mhd-order-lines";
import { invoicesFrom, trackingFrom, type MhdOrderData } from "@/lib/mhd-order-status";

// Lectura de pedidos de Shopify y de estados de MHD. La usan los botones de Pedidos MHD (con la sesión) y la tarea
// diaria de Garantía3 (docs/GARANTIA3.md), para que haya una sola forma de traerlos.

type MoneySet = { shopMoney: { amount: string } };
type DiscountApplication = { __typename: string; allocationMethod: string; targetSelection: string; targetType: string; value: { amount?: string; currencyCode?: string; percentage?: number }; code?: string; title?: string };
type ShopifyAddress = { name: string | null; firstName: string | null; lastName: string | null; company: string | null; address1: string | null; address2: string | null; city: string | null; zip: string | null; phone: string | null; countryCodeV2: string | null; provinceCode: string | null; province: string | null };
type ShopifyOrder = { id: string; name: string; createdAt: string; updatedAt: string; cancelledAt: string | null; displayFinancialStatus: string; displayFulfillmentStatus: string; email: string | null; note: string | null; customAttributes: { key: string; value: string | null }[]; customer: { displayName: string } | null; currencyCode: string; discountCodes: string[]; discountApplications: { nodes: DiscountApplication[] }; currentSubtotalPriceSet: MoneySet; currentTotalDiscountsSet: MoneySet; currentShippingPriceSet: MoneySet; currentTotalPriceSet: MoneySet; shippingAddress: ShopifyAddress | null; billingAddress: ShopifyAddress | null; lineItems: { nodes: { id: string; sku: string | null; title: string; quantity: number; discountedUnitPriceSet: MoneySet; product: { id: string; metafield: { value: string } | null } | null; lineItemGroup: { id: string; quantity: number; variantSku: string | null; productId: string | null } | null }[] } };
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
function eligibility(order: ShopifyOrder, provinceMapping: ProvinceMapping | undefined) {
  if (order.cancelledAt) return ["blocked", "Pedido cancelado en Shopify"] as const;
  if (order.displayFinancialStatus !== "PAID") return ["blocked", "Pendiente de pago"] as const;
  if (order.displayFulfillmentStatus === "FULFILLED") return ["blocked", "Ya enviado completamente en Shopify"] as const;
  if (!order.email?.trim()) return ["blocked", "Falta el email del cliente"] as const;
  if (!order.shippingAddress || !["ES", "PT"].includes(order.shippingAddress.countryCodeV2 ?? "")) return ["blocked", "Destino fuera de España o Portugal"] as const;
  if (!order.shippingAddress.provinceCode) return ["blocked", "Falta provincia o distrito en la dirección"] as const;
  if (!order.shippingAddress.address1?.trim() || !order.shippingAddress.city?.trim() || !order.shippingAddress.zip?.trim()) return ["blocked", "Falta calle, localidad o código postal en la dirección de envío"] as const;
  if (!order.shippingAddress.company?.trim()) return ["blocked", "Falta NIF/CIF en el campo Empresa de Shopify"] as const;
  if (order.lineItems.nodes.some((line) => !line.sku)) return ["blocked", "Hay líneas sin SKU"] as const;
  if (!provinceMapping) return ["blocked", "No hay correspondencia de provincia entre Shopify y MHD"] as const;
  if (!provinceMapping.active) return ["blocked", `MHD no presta envío en ${provinceMapping.mhd_province_name}`] as const;
  const mhdLines = buildMhdProductLines({
    lines: order.lineItems.nodes.map((line) => ({ sku: line.sku, quantity: line.quantity, unitPrice: line.discountedUnitPriceSet.shopMoney.amount, payload: line })),
    destination: { country: order.shippingAddress.countryCodeV2, province: order.shippingAddress.provinceCode, postalCode: order.shippingAddress.zip },
    shippingAmount: order.currentShippingPriceSet.shopMoney.amount,
  });
  if (!mhdLines.ok) return ["blocked", mhdLines.reason] as const;
  return ["eligible", mhdLines.warning] as const;
}
function discountSummary(order: ShopifyOrder) {
  const labels = new Set([...order.discountCodes, ...order.discountApplications.nodes.map((discount) => discount.code ?? discount.title ?? discount.__typename.replace("DiscountApplication", ""))]);
  return [...labels].filter(Boolean).join(" · ") || null;
}

type MhdStatusEntry = { estado?: string; fecha?: number | string | null };
type MhdOrderResponse = { success?: boolean; data?: MhdOrderData };

function mhdUrl(path: string) {
  const base = required("MHD_API_URL").replace(/\/$/, "");
  const version = required("MHD_API_VERSION").replace(/^\/+|\/+$/g, "");
  const subPath = required("MHD_API_SUB_PATH").replace(/^\/+|\/+$/g, "");
  return `${base}/api/${version}/${subPath}${path}`;
}
function mhdHeaders() {
  const credentials = Buffer.from(`${required("MHD_API_USER")}:${required("MHD_API_PASS")}`).toString("base64");
  return { Accept: "application/json", Authorization: `Basic ${credentials}` };
}
function dateFromMhd(value: MhdStatusEntry["fecha"]) {
  if (typeof value === "number") return new Date(value).toISOString();
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
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
    const response = await fetch(`https://${store}/admin/api/2026-07/graphql.json`, { method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": required("SHOPIFY_ACCESS_TOKEN") }, cache: "no-store", body: JSON.stringify({ query: `query RecentOrders($cursor: String) { orders(first: 100, after: $cursor, query: "financial_status:paid fulfillment_status:unfulfilled", sortKey: UPDATED_AT, reverse: true) { nodes { id name createdAt updatedAt cancelledAt displayFinancialStatus displayFulfillmentStatus email note customAttributes { key value } customer { displayName } currencyCode discountCodes discountApplications(first: 50) { nodes { __typename allocationMethod targetSelection targetType value { ... on MoneyV2 { amount currencyCode } ... on PricingPercentageValue { percentage } } ... on DiscountCodeApplication { code } ... on AutomaticDiscountApplication { title } ... on ManualDiscountApplication { title } ... on ScriptDiscountApplication { title } } } currentSubtotalPriceSet { shopMoney { amount } } currentTotalDiscountsSet { shopMoney { amount } } currentShippingPriceSet { shopMoney { amount } } currentTotalPriceSet { shopMoney { amount } } shippingAddress { name firstName lastName company address1 address2 city zip phone countryCodeV2 provinceCode province } billingAddress { name firstName lastName company address1 address2 city zip phone countryCodeV2 provinceCode province } lineItems(first: 250) { nodes { id sku title quantity discountedUnitPriceSet { shopMoney { amount } } product { id metafield(namespace: \"custom\", key: \"opciones_entrega\") { value } } lineItemGroup { id quantity variantSku productId } } } } pageInfo { hasNextPage endCursor } } }`, variables: { cursor } }) });
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
    const provinceMapping = order.shippingAddress?.countryCodeV2 && order.shippingAddress.provinceCode
      ? provinceMappingByKey.get(`${order.shippingAddress.countryCodeV2}:${order.shippingAddress.provinceCode}`)
      : undefined;
    const [eligibilityStatus, eligibilityReason] = eligibility(order, provinceMapping);
    const { data: saved, error } = await db.from("shopify_mhd_orders").upsert({ owner_id: ownerId, shopify_order_id: order.id, shopify_order_name: order.name, financial_status: order.displayFinancialStatus, fulfillment_status: order.displayFulfillmentStatus, cancelled_at: order.cancelledAt, email: order.email, order_note: order.note, currency_code: order.currencyCode, discount_codes: order.discountCodes, discount_summary: discountSummary(order), discount_applications: order.discountApplications.nodes, subtotal_amount: order.currentSubtotalPriceSet.shopMoney.amount, discount_amount: order.currentTotalDiscountsSet.shopMoney.amount, shipping_amount: order.currentShippingPriceSet.shopMoney.amount, total_amount: order.currentTotalPriceSet.shopMoney.amount, shipping_country_code: order.shippingAddress?.countryCodeV2 ?? null, shipping_province_code: order.shippingAddress?.provinceCode ?? null, shipping_province_name: order.shippingAddress?.province ?? null, eligibility_status: eligibilityStatus, eligibility_reason: eligibilityReason, source_updated_at: order.updatedAt, source_payload: order, synced_at: new Date().toISOString() }, { onConflict: "owner_id,shopify_order_id" }).select("id").single();
    if (error || !saved) throw error ?? new Error("No se pudo guardar un pedido de Shopify.");
    const lines = order.lineItems.nodes.map((line) => ({ order_id: saved.id, shopify_line_id: line.id, sku: line.sku, title: line.title, quantity: line.quantity, unit_price: line.discountedUnitPriceSet.shopMoney.amount, line_payload: line }));
    if (lines.length) { const { error: lineError } = await db.from("shopify_mhd_order_lines").upsert(lines, { onConflict: "order_id,shopify_line_id" }); if (lineError) throw lineError; }
  }
  return { count: orders.length, createdCount, updatedCount };
}

export async function refreshMhdStatuses(db: SupabaseClient) {
  const { data: exports, error: exportsError } = await db
    .from("mhd_order_exports")
    .select("id,mhd_order_id,mhd_status,mhd_status_payload")
    .eq("status", "exported")
    .not("mhd_order_id", "is", null);
  if (exportsError) throw new Error("No se pudieron cargar los pedidos exportados.");

  let checkedCount = 0;
  let changedCount = 0;
  const errors: string[] = [];
  for (const item of exports ?? []) {
    try {
      const response = await fetch(mhdUrl(`/orders/${item.mhd_order_id}`), { headers: mhdHeaders(), cache: "no-store", signal: AbortSignal.timeout(20_000) });
      const body = await response.json().catch(() => ({})) as MhdOrderResponse;
      if (!response.ok || !body.success || !body.data) throw new Error(`MHD respondió HTTP ${response.status}.`);
      checkedCount += 1;
      const received = (body.data.arr_estados ?? []).filter((entry) => entry.estado).map((entry) => ({ status: entry.estado!, occurred_at: dateFromMhd(entry.fecha), source_payload: entry }));
      const latest = received.sort((a, b) => (b.occurred_at ?? "").localeCompare(a.occurred_at ?? ""))[0];
      const currentStatus = body.data.estado_cliente ?? latest?.status ?? item.mhd_status;
      const statusPayload = {
        estado_cliente: body.data.estado_cliente ?? null, id_estado_cliente: body.data.id_estado_cliente ?? null, arr_estados: body.data.arr_estados ?? [],
        seguimiento: trackingFrom(body.data), facturas: invoicesFrom(body.data),
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
  return { checkedCount, changedCount, errors };
}
