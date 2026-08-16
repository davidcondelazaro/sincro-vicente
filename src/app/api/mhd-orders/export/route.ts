import { buildMhdOrderObservations } from "@/lib/mhd-order-notes";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Address = {
  name?: string | null; firstName?: string | null; lastName?: string | null;
  company?: string | null;
  address1?: string | null; address2?: string | null; city?: string | null;
  zip?: string | null; phone?: string | null; countryCodeV2?: string | null;
  provinceCode?: string | null; province?: string | null;
};
type Order = {
  id: string; shopify_order_name: string; email: string | null; order_note: string | null;
  discount_summary: string | null; shipping_country_code: string | null;
  shipping_province_code: string | null; eligibility_status: string;
  source_payload: { shippingAddress?: Address | null; billingAddress?: Address | null };
};
type Line = { sku: string | null; quantity: number; unit_price: string };
type Mapping = { mhd_province_id: number; mhd_province_name: string; active: boolean };
type Country = { mhd_country_id: number; shipping_enabled: boolean };
type MhdResponse = { success?: boolean; data?: { id?: number; id_transaccion?: string; estado_cliente?: string; arr_productos?: { cd_articulo?: string; cantidad?: number }[] }; errors?: unknown };

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
function mhdProductMatches(lines: Line[], response: MhdResponse) {
  const returned = response.data?.arr_productos ?? [];
  const requestedBySku = new Map<string, number>();
  const returnedBySku = new Map<string, number>();
  for (const line of lines) requestedBySku.set(line.sku!, (requestedBySku.get(line.sku!) ?? 0) + line.quantity);
  for (const line of returned) if (line.cd_articulo) returnedBySku.set(line.cd_articulo, (returnedBySku.get(line.cd_articulo) ?? 0) + (line.cantidad ?? 0));
  return requestedBySku.size === returnedBySku.size && [...requestedBySku].every(([sku, quantity]) => returnedBySku.get(sku) === quantity);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const ownerId = claims?.claims.sub;
  if (!ownerId) return Response.json({ error: "Necesitas iniciar sesión." }, { status: 401 });

  let orderId: string;
  try { ({ orderId } = await request.json() as { orderId: string }); } catch { return Response.json({ error: "Solicitud de exportación no válida." }, { status: 400 }); }
  if (!orderId) return Response.json({ error: "Falta el pedido a exportar." }, { status: 400 });

  const { data: order, error: orderError } = await supabase.from("shopify_mhd_orders").select("*").eq("id", orderId).single();
  if (orderError || !order) return Response.json({ error: "No se encontró el pedido." }, { status: 404 });
  const typedOrder = order as Order;
  if (typedOrder.eligibility_status !== "eligible") return Response.json({ error: "El pedido no cumple los requisitos para exportarse.", trace: "Revisa la elegibilidad y la dirección antes de reintentar." }, { status: 422 });
  const address = typedOrder.source_payload.shippingAddress;
  const invalidAddress = addressError(address);
  if (invalidAddress) return Response.json({ error: invalidAddress }, { status: 422 });
  if (!typedOrder.email?.trim()) return Response.json({ error: "Falta el email del cliente." }, { status: 422 });

  const [{ data: lines, error: linesError }, { data: mapping, error: mappingError }, { data: country, error: countryError }, { data: priorExport, error: exportError }] = await Promise.all([
    supabase.from("shopify_mhd_order_lines").select("sku,quantity,unit_price").eq("order_id", orderId),
    supabase.from("mhd_order_province_mappings").select("mhd_province_id,mhd_province_name,active").eq("country_iso_2", typedOrder.shipping_country_code ?? "").eq("shopify_province_code", typedOrder.shipping_province_code ?? "").maybeSingle(),
    supabase.from("mhd_order_countries").select("mhd_country_id,shipping_enabled").eq("iso_2", typedOrder.shipping_country_code ?? "").maybeSingle(),
    supabase.from("mhd_order_exports").select("id,status,mhd_order_id").eq("order_id", orderId).maybeSingle(),
  ]);
  if (linesError || mappingError || countryError || exportError) return Response.json({ error: "No se pudieron preparar los datos de exportación." }, { status: 500 });
  const typedLines = (lines ?? []) as Line[];
  const typedMapping = mapping as Mapping | null;
  const typedCountry = country as Country | null;
  if (!typedLines.length || typedLines.some((line) => !line.sku)) return Response.json({ error: "El pedido tiene líneas sin SKU." }, { status: 422 });
  if (!typedMapping?.active || !typedCountry?.shipping_enabled) return Response.json({ error: "La provincia de envío no está habilitada en MHD." }, { status: 422 });
  if (priorExport?.status === "exported") return Response.json({ error: `El pedido ya fue exportado a MHD como #${priorExport.mhd_order_id ?? "—"}.` }, { status: 409 });
  if (priorExport?.status === "exporting" || priorExport?.status === "unknown") return Response.json({ error: "Existe un intento pendiente o de resultado desconocido. No se reintentará para evitar un pedido duplicado." }, { status: 409 });

  const billingAddress = typedOrder.source_payload.billingAddress;
  const canExportBillingAddress = !addressError(billingAddress);
  const [{ data: billingMapping, error: billingMappingError }, { data: billingCountry, error: billingCountryError }] = canExportBillingAddress
    ? await Promise.all([
      supabase.from("mhd_order_province_mappings").select("mhd_province_id,mhd_province_name,active").eq("country_iso_2", billingAddress!.countryCodeV2!).eq("shopify_province_code", billingAddress!.provinceCode!).maybeSingle(),
      supabase.from("mhd_order_countries").select("mhd_country_id,shipping_enabled").eq("iso_2", billingAddress!.countryCodeV2!).maybeSingle(),
    ])
    : [{ data: null, error: null }, { data: null, error: null }];
  if (billingMappingError || billingCountryError) return Response.json({ error: "No se pudo preparar la dirección de facturación." }, { status: 500 });
  const typedBillingMapping = billingMapping as Mapping | null;
  const typedBillingCountry = billingCountry as Country | null;
  const billing = typedBillingMapping?.active && typedBillingCountry?.shipping_enabled
    ? mhdAddress(billingAddress!, typedBillingMapping, typedBillingCountry, address!.company)
    : undefined;
  const productPayload = typedLines.map((line, index) => ({
    codigo: line.sku, cantidad: line.quantity, precio: Number(line.unit_price),
    portes: index === 0 ? Number((order as { shipping_amount?: string | null }).shipping_amount ?? 0) : 0,
    subida: false, precio_subida: null, instalacion: false, precio_instalacion: null, retirada: false, precio_retirada: null,
  }));

  const payload = {
    email: typedOrder.email.trim(), referencia_web: typedOrder.shopify_order_name,
    observaciones: buildMhdOrderObservations({ orderNote: typedOrder.order_note, discountSummary: typedOrder.discount_summary }),
    envio: mhdAddress(address!, typedMapping, typedCountry),
    ...(billing ? { facturacion: billing } : {}),
    productos: productPayload,
  };
  const exportRow = priorExport
    ? await supabase.from("mhd_order_exports").update({ status: "exporting", mhd_order_id: null, mhd_transaction_id: null, mhd_status: null }).eq("id", priorExport.id).select("id").single()
    : await supabase.from("mhd_order_exports").insert({ order_id: orderId, status: "exporting", mhd_reference_web: typedOrder.shopify_order_name }).select("id").single();
  if (exportRow.error || !exportRow.data) return Response.json({ error: "No se pudo iniciar el registro de exportación." }, { status: 500 });
  const exportId = exportRow.data.id;

  try {
    const response = await fetch(mhdUrl("/orders"), { method: "POST", headers: mhdHeaders(), body: JSON.stringify(payload), cache: "no-store", signal: AbortSignal.timeout(30_000) });
    const responsePayload = await response.json().catch(() => ({})) as MhdResponse;
    const mhdOrderId = responsePayload.data?.id ?? null;
    const success = response.ok && responsePayload.success === true && mhdOrderId && mhdProductMatches(typedLines, responsePayload);
    const outcome = success ? "success" : mhdOrderId ? "unknown" : "failed";
    const status = success ? "exported" : outcome;
    const errorMessage = success ? null : responsePayload.errors ? "MHD rechazó o no confirmó todas las líneas del pedido." : "MHD no confirmó todas las líneas del pedido.";
    await Promise.all([
      supabase.from("mhd_order_exports").update({ status, mhd_order_id: mhdOrderId, mhd_transaction_id: responsePayload.data?.id_transaccion ?? null, mhd_status: responsePayload.data?.estado_cliente ?? null, mhd_status_updated_at: success ? new Date().toISOString() : null, last_checked_at: new Date().toISOString() }).eq("id", exportId),
      supabase.from("mhd_order_export_attempts").insert({ export_id: exportId, owner_id: ownerId, request_payload: payload, response_payload: responsePayload, http_status: response.status, outcome, error_message: errorMessage }),
    ]);
    if (!success) return Response.json({ error: errorMessage, trace: mhdOrderId ? "MHD devolvió un pedido incompleto; se ha marcado como resultado desconocido para impedir duplicados." : "MHD no confirmó el pedido." }, { status: 502 });
    return Response.json({ mhdOrderId, transactionId: responsePayload.data?.id_transaccion ?? null, status: responsePayload.data?.estado_cliente ?? null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo contactar con MHD.";
    await Promise.all([
      supabase.from("mhd_order_exports").update({ status: "unknown", last_checked_at: new Date().toISOString() }).eq("id", exportId),
      supabase.from("mhd_order_export_attempts").insert({ export_id: exportId, owner_id: ownerId, request_payload: payload, outcome: "unknown", error_message: message }),
    ]);
    return Response.json({ error: "No se pudo confirmar el resultado en MHD.", trace: "El intento se ha marcado como resultado desconocido y no se reintentará automáticamente." }, { status: 502 });
  }
}
