// Decisiones de la exportación de pedidos a MHD que no dependen de la red: qué hacer con lo que ya hay en MHD
// bajo la misma referencia y cómo interpretar la respuesta de POST /orders. Ver docs/PEDIDOS_MHD_FASE_1.md.

export type MhdFoundOrder = {
  id?: number; id_transaccion?: string; estado_cliente?: string | null; id_estado_cliente?: number | null;
  arr_productos?: { cd_articulo?: string; cantidad?: number }[];
};
export type MhdPostResponse = { success?: boolean; data?: MhdFoundOrder; errors?: unknown };
type RequestedLine = { codigo: string; cantidad: number };

const ESTADO_CANCELADO = 13;

// Un pedido cancelado en MHD no impide volver a exportar: la referencia queda libre
export function esCanceladoEnMhd(order: MhdFoundOrder) {
  return order.id_estado_cliente === ESTADO_CANCELADO || /cancel/i.test(order.estado_cliente ?? "");
}

// Compara por SKU y unidades. Los servicios van dentro de la línea del aparato, así que no cuentan.
export function productosCoinciden(lines: RequestedLine[], returned: MhdFoundOrder["arr_productos"]) {
  const requestedBySku = new Map<string, number>();
  const returnedBySku = new Map<string, number>();
  for (const line of lines) requestedBySku.set(line.codigo, (requestedBySku.get(line.codigo) ?? 0) + line.cantidad);
  for (const line of returned ?? []) if (line.cd_articulo) returnedBySku.set(line.cd_articulo, (returnedBySku.get(line.cd_articulo) ?? 0) + (line.cantidad ?? 0));
  return requestedBySku.size === returnedBySku.size && [...requestedBySku].every(([sku, quantity]) => returnedBySku.get(sku) === quantity);
}

export type Reconciliacion =
  | { accion: "enviar"; cancelados: number }
  | { accion: "recuperar"; pedido: MhdFoundOrder }
  | { accion: "revisar"; motivo: string; pedido: MhdFoundOrder | null };

// Lo que MHD tiene con esta referencia. arr_productos debe venir del detalle (GET /orders/:id): la búsqueda lo devuelve vacío.
export function reconciliar(lines: RequestedLine[], found: MhdFoundOrder[]): Reconciliacion {
  const vigentes = found.filter((order) => !esCanceladoEnMhd(order));
  if (!vigentes.length) return { accion: "enviar", cancelados: found.length };
  if (vigentes.length > 1) return { accion: "revisar", motivo: `MHD tiene ${vigentes.length} pedidos con esta referencia (${vigentes.map((order) => `#${order.id}`).join(", ")}).`, pedido: null };
  const pedido = vigentes[0];
  if (productosCoinciden(lines, pedido.arr_productos)) return { accion: "recuperar", pedido };
  return { accion: "revisar", motivo: `El pedido #${pedido.id} de MHD no tiene los mismos artículos y unidades que el de Shopify.`, pedido };
}

export type ResultadoEnvio = "exported" | "failed" | "unknown";

// Solo un rechazo expreso de MHD (4xx sin pedido creado) permite reintentar; cualquier otra cosa puede haber creado el pedido
export function resultadoDeEnvio(httpStatus: number, response: MhdPostResponse, lines: RequestedLine[]): ResultadoEnvio {
  const creado = response.data?.id;
  if (httpStatus >= 200 && httpStatus < 300 && response.success === true && creado && productosCoinciden(lines, response.data?.arr_productos)) return "exported";
  if (creado) return "unknown";
  return httpStatus >= 400 && httpStatus < 500 ? "failed" : "unknown";
}

// MHD devuelve los errores como lista, texto u objeto por campo
export function erroresDeMhd(errors: unknown): string[] {
  if (!errors) return [];
  if (typeof errors === "string") return [errors];
  if (Array.isArray(errors)) return errors.flatMap(erroresDeMhd);
  if (typeof errors === "object") return Object.values(errors).flatMap(erroresDeMhd);
  return [String(errors)];
}

// Pedidos cancelados en MHD que se cancelan también en Shopify (David, 14-11-2026), sin reembolso y con aviso al
// cliente. Solo con el interruptor encendido, con cancelaciones de MHD posteriores al corte (así no se tocan las
// antiguas ni las de prueba), una sola vez por pedido, y nunca si Shopify ya lo tiene cancelado.
export function debeCancelarEnShopify(input: { activo: boolean; desde: string | null; pedido: MhdFoundOrder; canceladoEn: string | null; yaIntentado: boolean; canceladoEnShopify: boolean }) {
  if (!input.activo || !input.desde || input.yaIntentado || input.canceladoEnShopify) return false;
  if (!esCanceladoEnMhd(input.pedido) || !input.canceladoEn) return false;
  return new Date(input.canceladoEn).getTime() >= new Date(input.desde).getTime();
}

// Si se reexportó, MHD tiene otro pedido vigente con la misma referencia y el de Shopify sigue vivo.
export function otrosVigentes(found: MhdFoundOrder[], mhdOrderId: number) {
  return found.filter((order) => order.id !== mhdOrderId && !esCanceladoEnMhd(order));
}
