import type { SupabaseClient } from "@supabase/supabase-js";
import { buildMhdProductLines, pedidoSinEnvio, type MhdProductLine, type ShopifyLinePayload } from "@/lib/mhd-order-lines";
import { buildMhdOrderObservations } from "@/lib/mhd-order-notes";
import { erroresDeMhd, reconciliar, resultadoDeEnvio, type MhdFoundOrder, type MhdPostResponse } from "@/lib/mhd-order-reconcile";

// Exportación de un pedido a MHD. No depende de la sesión: recibe el cliente de base de datos y el propietario, para
// que la use el botón de Pedidos MHD y, cuando se encienda, el proceso automático. Ver docs/PEDIDOS_MHD_FASE_1.md.
// Antes de enviar se relee el pedido en Shopify y se busca su referencia en MHD; si algo de eso falla, no se envía.

type Address = {
  name?: string | null; firstName?: string | null; lastName?: string | null;
  company?: string | null;
  address1?: string | null; address2?: string | null; city?: string | null;
  zip?: string | null; phone?: string | null; countryCodeV2?: string | null;
  provinceCode?: string | null; province?: string | null;
};
type Order = {
  id: string; shopify_order_id: string; shopify_order_name: string; email: string | null; order_note: string | null;
  discount_summary: string | null; shipping_country_code: string | null; source_updated_at: string;
  shipping_province_code: string | null; eligibility_status: string; shipping_amount: string | null;
  source_payload: { shippingAddress?: Address | null; billingAddress?: Address | null; customAttributes?: { key: string; value: string | null }[] | null };
};
type Line = { sku: string | null; title: string; quantity: number; unit_price: string; line_payload: ShopifyLinePayload | null };
type Mapping = { mhd_province_id: number; mhd_province_name: string; active: boolean };
type Country = { mhd_country_id: number; shipping_enabled: boolean };
type PriorExport = { id: string; status: string; mhd_order_id: number | null; updated_at: string };
type Refusal = { ok: false; status: number; error: string; trace?: string };

// Un «exporting» más reciente puede seguir en curso (30 s de envío más la búsqueda posterior)
const EXPORTING_STALE_MS = 2 * 60 * 1000;

function required(name: string) { const value = process.env[name]; if (!value) throw new Error(`Falta la variable ${name}.`); return value; }
function mhdUrl(path: string) {
  const base = required("MHD_API_URL").replace(/\/$/, "");
  const version = required("MHD_API_VERSION").replace(/^\/+|\/+$/g, "");
  const subPath = required("MHD_API_SUB_PATH").replace(/^\/+|\/+$/g, "");
  return `${base}/api/${version}/${subPath}${path}`;
}
function mhdHeaders() {
  const credentials = Buffer.from(`${required("MHD_API_USER")}:${required("MHD_API_PASS")}`).toString("base64");
  return { Accept: "application/json", "Content-Type": "application/json", Authorization: `Basic ${credentials}` };
}
function splitName(address: Address) {
  const fullName = address.name?.trim() ?? "";
  const firstName = address.firstName?.trim() || fullName.split(/\s+/)[0] || "Cliente";
  const lastName = address.lastName?.trim() || fullName.slice(firstName.length).trim() || "Shopify";
  return { nombre: firstName, apellidos: lastName };
}
function mhdAddress(address: Address, mapping: Mapping, country: Country, fallbackNif?: string | null) {
  const { nombre, apellidos } = splitName(address);
  return {
    nombre, apellidos, nif: address.company?.trim() || fallbackNif?.trim() || "", telefono: address.phone?.trim() || "",
    direccion: [address.address1, address.address2].filter(Boolean).join(", "),
    cp: address.zip?.trim() || "", localidad: address.city?.trim() || "",
    id_provincia: mapping.mhd_province_id, provincia: mapping.mhd_province_name,
    id_pais: country.mhd_country_id,
  };
}
function addressError(address: Address | null | undefined) {
  if (!address?.address1?.trim()) return "Falta la dirección de envío.";
  if (!address.city?.trim()) return "Falta la localidad de envío.";
  if (!address.zip?.trim()) return "Falta el código postal de envío.";
  if (!address.countryCodeV2 || !address.provinceCode) return "Falta país o provincia de envío.";
  if (!address.company?.trim()) return "Falta el NIF/CIF en el campo Empresa de Shopify.";
  return null;
}

// Monta lo que se enviaría a MHD con lo guardado en la base de datos, sin llamar a nadie
async function prepare(db: SupabaseClient, orderId: string) {
  const { data: order, error: orderError } = await db.from("shopify_mhd_orders").select("*").eq("id", orderId).single();
  if (orderError || !order) return { ok: false, status: 404, error: "No se encontró el pedido." } satisfies Refusal;
  const typedOrder = order as Order;
  if (typedOrder.eligibility_status !== "eligible") return { ok: false, status: 422, error: "El pedido no cumple los requisitos para exportarse.", trace: "Revisa la elegibilidad y la dirección antes de reintentar." } satisfies Refusal;
  if (!typedOrder.email?.trim()) return { ok: false, status: 422, error: "Falta el email del cliente." } satisfies Refusal;

  const [{ data: lines, error: linesError }, { data: mapping, error: mappingError }, { data: country, error: countryError }, { data: priorExport, error: exportError }] = await Promise.all([
    db.from("shopify_mhd_order_lines").select("sku,title,quantity,unit_price,line_payload").eq("order_id", orderId),
    db.from("mhd_order_province_mappings").select("mhd_province_id,mhd_province_name,active").eq("country_iso_2", typedOrder.shipping_country_code ?? "").eq("shopify_province_code", typedOrder.shipping_province_code ?? "").maybeSingle(),
    db.from("mhd_order_countries").select("mhd_country_id,shipping_enabled").eq("iso_2", typedOrder.shipping_country_code ?? "").maybeSingle(),
    db.from("mhd_order_exports").select("id,status,mhd_order_id,updated_at").eq("order_id", orderId).maybeSingle(),
  ]);
  if (linesError || mappingError || countryError || exportError) return { ok: false, status: 500, error: "No se pudieron preparar los datos de exportación." } satisfies Refusal;
  const typedLines = (lines ?? []) as Line[];
  const address = typedOrder.source_payload.shippingAddress
    ?? (pedidoSinEnvio(typedLines.map((line) => line.line_payload ?? {})) ? typedOrder.source_payload.billingAddress : null);
  const invalidAddress = addressError(address);
  if (invalidAddress) return { ok: false, status: 422, error: invalidAddress } satisfies Refusal;
  const typedMapping = mapping as Mapping | null;
  const typedCountry = country as Country | null;
  const typedPrior = priorExport as PriorExport | null;
  if (!typedLines.length || typedLines.some((line) => !line.sku)) return { ok: false, status: 422, error: "El pedido tiene líneas sin SKU." } satisfies Refusal;
  if (!typedMapping?.active || !typedCountry?.shipping_enabled) return { ok: false, status: 422, error: "La provincia de envío no está habilitada en MHD." } satisfies Refusal;
  if (typedPrior?.status === "exported") return { ok: false, status: 409, error: `El pedido ya fue exportado a MHD como #${typedPrior.mhd_order_id ?? "—"}.` } satisfies Refusal;
  if (typedPrior?.status === "exporting" || typedPrior?.status === "unknown") return { ok: false, status: 409, error: "Existe un intento pendiente o de resultado desconocido. No se reintentará para evitar un pedido duplicado.", trace: "Usa «Comprobar en MHD»." } satisfies Refusal;

  const billingAddress = typedOrder.source_payload.billingAddress;
  const canExportBillingAddress = !addressError(billingAddress);
  const [{ data: billingMapping, error: billingMappingError }, { data: billingCountry, error: billingCountryError }] = canExportBillingAddress
    ? await Promise.all([
      db.from("mhd_order_province_mappings").select("mhd_province_id,mhd_province_name,active").eq("country_iso_2", billingAddress!.countryCodeV2!).eq("shopify_province_code", billingAddress!.provinceCode!).maybeSingle(),
      db.from("mhd_order_countries").select("mhd_country_id,shipping_enabled").eq("iso_2", billingAddress!.countryCodeV2!).maybeSingle(),
    ])
    : [{ data: null, error: null }, { data: null, error: null }];
  if (billingMappingError || billingCountryError) return { ok: false, status: 500, error: "No se pudo preparar la dirección de facturación." } satisfies Refusal;
  const typedBillingMapping = billingMapping as Mapping | null;
  const typedBillingCountry = billingCountry as Country | null;
  const billing = typedBillingMapping?.active && typedBillingCountry?.shipping_enabled
    ? mhdAddress(billingAddress!, typedBillingMapping, typedBillingCountry, address!.company)
    : undefined;
  const mhdLines = buildMhdProductLines({
    lines: typedLines.map((line) => ({ sku: line.sku, quantity: line.quantity, unitPrice: line.unit_price, payload: line.line_payload })),
    destination: { country: address!.countryCodeV2, province: address!.provinceCode, postalCode: address!.zip },
    shippingAmount: typedOrder.shipping_amount ?? 0,
  });
  if (!mhdLines.ok) return { ok: false, status: 422, error: mhdLines.reason } satisfies Refusal;

  const payload = {
    email: typedOrder.email.trim(), referencia_web: typedOrder.shopify_order_name,
    observaciones: buildMhdOrderObservations({ orderNote: typedOrder.order_note, discountSummary: typedOrder.discount_summary, customAttributes: typedOrder.source_payload.customAttributes }),
    envio: mhdAddress(address!, typedMapping, typedCountry),
    ...(billing ? { facturacion: billing } : {}),
    productos: mhdLines.productos,
  };
  return { ok: true as const, order: typedOrder, lines: typedLines, prior: typedPrior, payload, warning: mhdLines.warning };
}

// Lo guardado puede estar atrasado: un pedido cancelado o reembolsado deja de llegar en la lectura de Pedidos MHD
async function checkShopify(order: Order): Promise<Refusal | null> {
  const store = required("SHOPIFY_STORE_URL").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const response = await fetch(`https://${store}/admin/api/2026-07/graphql.json`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": required("SHOPIFY_ACCESS_TOKEN") }, cache: "no-store", signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({ query: "query OrderForExport($id: ID!) { order(id: $id) { updatedAt cancelledAt displayFinancialStatus } }", variables: { id: order.shopify_order_id } }),
  });
  const body = await response.json().catch(() => ({})) as { data?: { order?: { updatedAt: string; cancelledAt: string | null; displayFinancialStatus: string } | null }; errors?: { message: string }[] };
  if (!response.ok || body.errors?.length) throw new Error(body.errors?.map((item) => item.message).join(" ") || `Shopify devolvió HTTP ${response.status}.`);
  const live = body.data?.order;
  if (!live) return { ok: false, status: 409, error: "El pedido ya no existe en Shopify." };
  if (live.cancelledAt) return { ok: false, status: 409, error: "El pedido está cancelado en Shopify." };
  if (live.displayFinancialStatus !== "PAID") return { ok: false, status: 409, error: `El pedido ya no figura como pagado en Shopify (${live.displayFinancialStatus}).` };
  if (new Date(live.updatedAt).getTime() !== new Date(order.source_updated_at).getTime()) return { ok: false, status: 409, error: "El pedido ha cambiado en Shopify desde la última lectura.", trace: "Pulsa actualizar pedidos y revísalo antes de exportar." };
  return null;
}

// La búsqueda es exacta, con el # incluido, y no trae los artículos: hay que pedir el detalle de cada pedido
async function findInMhd(reference: string): Promise<MhdFoundOrder[]> {
  const read = async (path: string) => {
    const response = await fetch(mhdUrl(path), { headers: mhdHeaders(), cache: "no-store", signal: AbortSignal.timeout(20_000) });
    const body = await response.json().catch(() => ({})) as { success?: boolean; data?: unknown };
    if (!response.ok || !body.success) throw new Error(`MHD respondió HTTP ${response.status} al buscar el pedido.`);
    return body.data;
  };
  const found = await read(`/orders?referencia_web=${encodeURIComponent(reference)}`) as MhdFoundOrder[];
  return Promise.all(found.map(async (order) => await read(`/orders/${order.id}`) as MhdFoundOrder));
}

export async function previewMhdExport(db: SupabaseClient, orderId: string) {
  const prepared = await prepare(db, orderId);
  if (!prepared.ok) return prepared;
  const stale = await checkShopify(prepared.order);
  if (stale) return stale;
  const inMhd = reconciliar(prepared.payload.productos, await findInMhd(prepared.order.shopify_order_name));
  if (inMhd.accion === "revisar") return { ok: false, status: 409, error: inMhd.motivo, trace: "Revísalo en MHD: no se enviará nada." } satisfies Refusal;
  const titles = new Map(prepared.lines.map((line) => [line.sku, line.title]));
  return {
    ok: true as const, ...prepared.payload, warning: prepared.warning,
    titulos: Object.fromEntries(prepared.payload.productos.map((line: MhdProductLine) => [line.codigo, titles.get(line.codigo) ?? ""])),
    yaEnMhd: inMhd.accion === "recuperar" ? inMhd.pedido.id ?? null : null,
    canceladosEnMhd: inMhd.accion === "enviar" ? inMhd.cancelados : 0,
  };
}

function exportedFields(pedido: MhdFoundOrder) {
  const now = new Date().toISOString();
  return { status: "exported", mhd_order_id: pedido.id ?? null, mhd_transaction_id: pedido.id_transaccion ?? null, mhd_status: pedido.estado_cliente ?? null, mhd_status_updated_at: now, last_checked_at: now };
}

// Se reclama la fila con una condición de estado: de dos clics seguidos, solo uno llega a enviar
async function claim(db: SupabaseClient, order: Order, prior: PriorExport | null) {
  if (!prior) {
    const { data } = await db.from("mhd_order_exports").insert({ order_id: order.id, status: "exporting", mhd_reference_web: order.shopify_order_name }).select("id").single();
    return data?.id as string | undefined;
  }
  const { data } = await db.from("mhd_order_exports").update({ status: "exporting", mhd_order_id: null, mhd_transaction_id: null, mhd_status: null, updated_at: new Date().toISOString() }).eq("id", prior.id).in("status", ["ready", "failed"]).select("id").maybeSingle();
  return data?.id as string | undefined;
}

export type ExportResult =
  | { ok: true; mhdOrderId: number | null; transactionId: string | null; status: string | null; recovered: boolean }
  | Refusal & { mhdErrors?: string[] };

export async function exportMhdOrder(db: SupabaseClient, ownerId: string, orderId: string): Promise<ExportResult> {
  const prepared = await prepare(db, orderId);
  if (!prepared.ok) return prepared;
  const { order, prior, payload } = prepared;
  const stale = await checkShopify(order);
  if (stale) return stale;
  const inMhd = reconciliar(payload.productos, await findInMhd(order.shopify_order_name));
  if (inMhd.accion === "revisar") return { ok: false, status: 409, error: inMhd.motivo, trace: "Revísalo en MHD: no se ha enviado nada." };

  const exportId = await claim(db, order, prior);
  if (!exportId) return { ok: false, status: 409, error: "Otro intento acaba de empezar con este pedido." };

  if (inMhd.accion === "recuperar") {
    await Promise.all([
      db.from("mhd_order_exports").update(exportedFields(inMhd.pedido)).eq("id", exportId),
      db.from("mhd_order_export_attempts").insert({ export_id: exportId, owner_id: ownerId, response_payload: inMhd.pedido, outcome: "success", error_message: "Ya existía en MHD: se recuperan sus datos sin reenviar." }),
    ]);
    return { ok: true, mhdOrderId: inMhd.pedido.id ?? null, transactionId: inMhd.pedido.id_transaccion ?? null, status: inMhd.pedido.estado_cliente ?? null, recovered: true };
  }

  let httpStatus: number | null = null;
  let responsePayload: MhdPostResponse | null = null;
  let failure: string | null = null;
  try {
    const response = await fetch(mhdUrl("/orders"), { method: "POST", headers: mhdHeaders(), body: JSON.stringify(payload), cache: "no-store", signal: AbortSignal.timeout(30_000) });
    httpStatus = response.status;
    responsePayload = await response.json().catch(() => ({})) as MhdPostResponse;
  } catch (error) { failure = error instanceof Error ? error.message : "No se pudo contactar con MHD."; }

  const outcome = httpStatus !== null && responsePayload ? resultadoDeEnvio(httpStatus, responsePayload, payload.productos) : "unknown";
  if (outcome === "exported") {
    const pedido = responsePayload!.data!;
    await Promise.all([
      db.from("mhd_order_exports").update(exportedFields(pedido)).eq("id", exportId),
      db.from("mhd_order_export_attempts").insert({ export_id: exportId, owner_id: ownerId, request_payload: payload, response_payload: responsePayload, http_status: httpStatus, outcome: "success" }),
    ]);
    return { ok: true, mhdOrderId: pedido.id ?? null, transactionId: pedido.id_transaccion ?? null, status: pedido.estado_cliente ?? null, recovered: false };
  }

  const mhdErrors = erroresDeMhd(responsePayload?.errors);
  const errorMessage = failure ?? (mhdErrors.length ? "MHD rechazó o no confirmó todas las líneas del pedido." : "MHD no confirmó todas las líneas del pedido.");
  await db.from("mhd_order_export_attempts").insert({ export_id: exportId, owner_id: ownerId, request_payload: payload, response_payload: responsePayload, http_status: httpStatus, outcome, error_message: errorMessage });
  if (outcome === "failed") {
    await db.from("mhd_order_exports").update({ status: "failed", last_checked_at: new Date().toISOString() }).eq("id", exportId);
    return { ok: false, status: 502, error: errorMessage, trace: "MHD no ha creado el pedido.", mhdErrors };
  }
  await db.from("mhd_order_exports").update({ status: "unknown", mhd_order_id: responsePayload?.data?.id ?? null, mhd_transaction_id: responsePayload?.data?.id_transaccion ?? null, last_checked_at: new Date().toISOString() }).eq("id", exportId);
  const checked = await settleUnknown(db, ownerId, exportId, payload.productos, order.shopify_order_name).catch(() => null);
  if (checked?.ok) return { ...checked, recovered: true };
  return { ok: false, status: 502, error: errorMessage, trace: checked?.error ?? "El intento se ha marcado como resultado desconocido y no se reintentará: usa «Comprobar en MHD».", mhdErrors };
}

// Resuelve un resultado desconocido mirando lo que hay en MHD. Si no hay nada, el pedido vuelve a poder exportarse.
async function settleUnknown(db: SupabaseClient, ownerId: string, exportId: string, lines: MhdProductLine[], reference: string) {
  const inMhd = reconciliar(lines, await findInMhd(reference));
  const now = new Date().toISOString();
  if (inMhd.accion === "recuperar") {
    await Promise.all([
      db.from("mhd_order_exports").update(exportedFields(inMhd.pedido)).eq("id", exportId),
      db.from("mhd_order_export_attempts").insert({ export_id: exportId, owner_id: ownerId, response_payload: inMhd.pedido, outcome: "success", error_message: "Encontrado en MHD al comprobar un resultado desconocido." }),
    ]);
    return { ok: true as const, mhdOrderId: inMhd.pedido.id ?? null, transactionId: inMhd.pedido.id_transaccion ?? null, status: inMhd.pedido.estado_cliente ?? null, error: null };
  }
  if (inMhd.accion === "enviar") {
    await Promise.all([
      db.from("mhd_order_exports").update({ status: "failed", mhd_order_id: null, mhd_transaction_id: null, last_checked_at: now }).eq("id", exportId),
      db.from("mhd_order_export_attempts").insert({ export_id: exportId, owner_id: ownerId, outcome: "failed", error_message: "Comprobado en MHD: el pedido no existe." }),
    ]);
    return { ok: false as const, error: "El pedido no existe en MHD: ya se puede volver a exportar." };
  }
  await Promise.all([
    db.from("mhd_order_exports").update({ mhd_order_id: inMhd.pedido?.id ?? null, last_checked_at: now }).eq("id", exportId),
    db.from("mhd_order_export_attempts").insert({ export_id: exportId, owner_id: ownerId, response_payload: inMhd.pedido, outcome: "unknown", error_message: inMhd.motivo }),
  ]);
  return { ok: false as const, error: `${inMhd.motivo} Revísalo en MHD.` };
}

// Botón «Comprobar en MHD». Compara con lo último que se intentó enviar, no con el pedido tal como esté ahora.
export async function checkMhdExport(db: SupabaseClient, ownerId: string, orderId: string): Promise<ExportResult> {
  const [{ data: order }, { data: prior }] = await Promise.all([
    db.from("shopify_mhd_orders").select("shopify_order_name").eq("id", orderId).single(),
    db.from("mhd_order_exports").select("id,status,mhd_order_id,updated_at").eq("order_id", orderId).maybeSingle(),
  ]);
  const typedPrior = prior as PriorExport | null;
  if (!order || !typedPrior) return { ok: false, status: 404, error: "No hay ningún intento de exportación de este pedido." };
  if (typedPrior.status !== "unknown" && typedPrior.status !== "exporting") return { ok: false, status: 409, error: "Este pedido no tiene un resultado desconocido." };
  if (typedPrior.status === "exporting" && Date.now() - new Date(typedPrior.updated_at).getTime() < EXPORTING_STALE_MS) return { ok: false, status: 409, error: "La exportación puede seguir en curso. Espera dos minutos y vuelve a comprobar." };
  const { data: attempts } = await db.from("mhd_order_export_attempts").select("request_payload").eq("export_id", typedPrior.id).not("request_payload", "is", null).order("created_at", { ascending: false }).limit(1);
  const lines = (attempts?.[0]?.request_payload as { productos?: MhdProductLine[] } | undefined)?.productos;
  if (!lines) return { ok: false, status: 409, error: "No consta qué se envió a MHD: revísalo a mano." };
  const checked = await settleUnknown(db, ownerId, typedPrior.id, lines, order.shopify_order_name);
  return checked.ok ? { ...checked, recovered: true } : { ok: false, status: 409, error: checked.error };
}
