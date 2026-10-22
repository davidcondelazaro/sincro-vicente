// Seguimiento y facturas de GET /orders/:id de MHD. Ver docs/API_MHD.md.

type MhdStatusEntry = { estado?: string; fecha?: number | string | null };

type MhdTracking = { carrier_code?: string | null; carrier_name?: string | null; tracking_number?: string | null; carrier_url?: string | null; zip_code?: string | null };
type MhdInvoice = { url_factura?: string | null; nombre_factura?: string | null };
export type MhdOrderData = {
  estado_cliente?: string | null; id_estado_cliente?: number | null; arr_estados?: MhdStatusEntry[];
  arr_seguimiento_info?: MhdTracking | null; arr_tracking_info_erp?: MhdTracking[] | null; arr_tracking_info_erp_full?: MhdTracking[] | null; arr_tracking_info_manual?: MhdTracking[] | null;
  arr_facturas_info_full?: MhdInvoice[] | null; arr_facturas_info?: MhdInvoice | null;
};
// MHD devuelve hoy el seguimiento en cuatro propiedades con el mismo contenido y avisará cuando las unifique
// (docs/API_MHD.md). Se juntan todas y se quitan los números repetidos; se prefiere el enlace de arr_seguimiento_info.
export function trackingFrom(data: MhdOrderData) {
  const candidates = [data.arr_seguimiento_info, ...(data.arr_tracking_info_erp_full ?? []), ...(data.arr_tracking_info_erp ?? []), ...(data.arr_tracking_info_manual ?? [])];
  const byNumber = new Map<string, MhdTracking>();
  for (const item of candidates) {
    if (!item) continue;
    const number = item.tracking_number?.trim();
    if (number && !byNumber.has(number)) byNumber.set(number, { carrier_code: item.carrier_code ?? null, carrier_name: item.carrier_name ?? null, tracking_number: number, carrier_url: item.carrier_url ?? null, zip_code: item.zip_code ?? null });
  }
  return [...byNumber.values()];
}
// arr_facturas_info_full (array) sustituye a arr_facturas_info (objeto). Los enlaces son permanentes.
export function invoicesFrom(data: MhdOrderData) {
  const list = data.arr_facturas_info_full ?? (data.arr_facturas_info ? [data.arr_facturas_info] : []);
  return list.filter((item) => item?.url_factura).map((item) => ({ url_factura: item.url_factura!, nombre_factura: item.nombre_factura ?? null }));
}
