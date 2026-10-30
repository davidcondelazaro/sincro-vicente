// Reglas de las altas de Garantía3, sin acceso a red ni base de datos. Ver docs/GARANTIA3.md.

// SKU de las 9 ampliaciones en Shopify y su EAN. Los mismos EAN están en pladisel/proxy-garantia3.php.
export const GARANTIA3_EANS: Record<string, string> = {
  G3PDES250: "8033509880271", G3PDES500: "8033509880394", G3PDES1000: "8033509880400", G3PDES2000: "8033509880417", G3PDES5000: "8033509880424",
  G3PD3ES250: "8033509887652", G3PD3ES500: "8033509887669", G3PD3ES1000: "8033509887676", G3PD3ES2000: "8033509887683",
};

export type Direccion = { firstName?: string | null; lastName?: string | null; phone?: string | null; countryCodeV2?: string | null };
export type PedidoGuardado = { id?: string; name?: string; createdAt?: string; email?: string | null; billingAddress?: Direccion | null; shippingAddress?: Direccion | null };
export type LineaGuardada = { shopify_line_id: string; sku: string | null; quantity: number; line_payload: { lineItemGroup?: { variantSku?: string | null } | null } | null };
export type Fila = { shopify_line_id: string; unidad: number; sku: string; ean13: string; sku_aparato: string | null; nombre: string | null; apellidos: string | null; email: string | null; telefono: string | null };

const PREFIJOS: Record<string, string> = { ES: "34", PT: "351" };

// Deja el teléfono como lo aceptaba Garantía3 en PrestaShop: prefijo y 9 cifras. Allí unas 30 de 353 filas llevaban el
// prefijo repetido, espacios o paréntesis. Si no quedan 9 cifras, devuelve null y la fila se bloquea con aviso.
export function normalizarTelefono(telefono: string | null | undefined, pais: string | null | undefined) {
  const prefijo = PREFIJOS[pais ?? ""];
  if (!telefono || !prefijo) return null;
  let cifras = telefono.replace(/\D/g, "").replace(/^00/, "");
  while (cifras.startsWith(prefijo) && cifras.length > 9) cifras = cifras.slice(prefijo.length);
  return cifras.length === 9 ? `${prefijo}${cifras}` : null;
}

export function filasDePedido(pedido: PedidoGuardado, lineas: LineaGuardada[]): Fila[] {
  const direccion = pedido.billingAddress?.firstName || pedido.billingAddress?.lastName ? pedido.billingAddress : pedido.shippingAddress;
  const telefono = normalizarTelefono(pedido.billingAddress?.phone, pedido.billingAddress?.countryCodeV2) ?? normalizarTelefono(pedido.shippingAddress?.phone, pedido.shippingAddress?.countryCodeV2);
  return lineas.flatMap((linea) => {
    const ean13 = GARANTIA3_EANS[linea.sku ?? ""];
    if (!ean13) return [];
    return Array.from({ length: linea.quantity }, (_, indice) => ({
      shopify_line_id: linea.shopify_line_id, unidad: indice + 1, sku: linea.sku!, ean13, sku_aparato: linea.line_payload?.lineItemGroup?.variantSku ?? null,
      nombre: direccion?.firstName?.trim() || null, apellidos: direccion?.lastName?.trim() || null, email: pedido.email?.trim() || null, telefono,
    }));
  });
}

export function datoQueFalta(fila: Pick<Fila, "sku_aparato" | "nombre" | "apellidos" | "email" | "telefono">) {
  if (!fila.sku_aparato) return "La garantía no está ligada a un aparato";
  if (!fila.nombre) return "Falta el nombre del cliente";
  if (!fila.apellidos) return "Faltan los apellidos del cliente";
  if (!fila.email) return "Falta el email del cliente";
  if (!fila.telefono) return "Falta un teléfono válido del cliente";
  return null;
}

type EstadoMhd = { estado?: string | null; fecha?: number | string | null };
export type PayloadMhd = { id_estado_cliente?: number | null; estado_cliente?: string | null; arr_estados?: EstadoMhd[] | null } | null | undefined;

const ESTADOS_ENVIADO = /^(enviado|en tr[aá]nsito|finalizado)$/i;

// Primer estado de envío: Enviado y, si MHD se lo salta, En tránsito o Finalizado.
export function fechaEnviado(payload: PayloadMhd) {
  const fechas = (payload?.arr_estados ?? []).filter((item) => ESTADOS_ENVIADO.test(item.estado?.trim() ?? "") && item.fecha).map((item) => new Date(item.fecha!).getTime()).filter(Number.isFinite);
  return fechas.length ? new Date(Math.min(...fechas)).toISOString() : null;
}

export const canceladoEnMhd = (payload: PayloadMhd) => payload?.id_estado_cliente === 13 || /^cancelado$/i.test(payload?.estado_cliente?.trim() ?? "");

export function fechaPrevista(inicio: string, dias: number) { return new Date(new Date(inicio).getTime() + dias * 86_400_000).toISOString(); }

export type PedidoVivo = {
  cancelledAt: string | null; displayFinancialStatus: string;
  lineItems: { nodes: { id: string; sku: string | null; currentQuantity: number; lineItemGroup: { variantSku: string | null } | null }[] };
  fulfillmentOrders: { nodes: { deliveryMethod: { methodType: string } | null }[] };
  fulfillments: { status: string; createdAt: string; deliveredAt: string | null }[];
};

// La recogida en tienda no pasa por MHD: la cuenta empieza cuando el pedido se da por entregado (decidido por David).
export function fechaRecogida(pedido: PedidoVivo) {
  if (!pedido.fulfillmentOrders.nodes.some((item) => item.deliveryMethod?.methodType === "PICK_UP")) return null;
  const hecho = pedido.fulfillments.find((item) => item.status === "SUCCESS");
  return hecho ? hecho.deliveredAt ?? hecho.createdAt : null;
}

// Por qué ya no procede pedir el contrato de esta unidad, mirando el pedido tal como está ahora en Shopify.
export function motivoParaNoPedir(pedido: PedidoVivo | null, fila: { shopify_line_id: string; unidad: number; sku_aparato: string | null }) {
  if (!pedido) return "El pedido ya no existe en Shopify";
  if (pedido.cancelledAt) return "Pedido cancelado en Shopify";
  if (!["PAID", "PARTIALLY_REFUNDED"].includes(pedido.displayFinancialStatus)) return `Pedido no pagado en Shopify (${pedido.displayFinancialStatus})`;
  const garantia = pedido.lineItems.nodes.find((linea) => linea.id === fila.shopify_line_id);
  if (!garantia || garantia.currentQuantity < fila.unidad) return "Garantía reembolsada o quitada del pedido";
  const aparato = pedido.lineItems.nodes.find((linea) => linea.sku === fila.sku_aparato && !linea.lineItemGroup);
  if (!aparato || aparato.currentQuantity < fila.unidad) return "Aparato reembolsado o quitado del pedido";
  return null;
}

export type Resultado = { estado: "creado" | "error" | "dudoso"; contrato?: string; pin?: string; motivo?: string; parar?: boolean };

// Solo hay contrato con 200, message OK y número de contrato. Lo que no se pueda asegurar queda dudoso y no se repite:
// la API no evita duplicados y cada contrato se paga.
export function interpretarRespuesta(status: number, cuerpo: unknown): Resultado {
  const json = (cuerpo && typeof cuerpo === "object" ? cuerpo : {}) as { message?: unknown; proxy?: unknown; data?: { transaction?: unknown; pin?: unknown }[] };
  const dato = Array.isArray(json.data) ? json.data[0] : undefined;
  if (status === 200 && json.message === "OK" && typeof dato?.transaction === "string" && dato.transaction) return { estado: "creado", contrato: dato.transaction, pin: typeof dato.pin === "string" ? dato.pin : undefined };
  if (status === 401) return { estado: "error", motivo: "401: token o IP no autorizados", parar: true };
  if (status === 404) return { estado: "error", motivo: "404: producto inexistente o sin autorización de compra" };
  if (status === 503 && json.proxy === "no_enviado") return { estado: "error", motivo: "No se pudo conectar con Garantía3: la petición no salió" };
  if (status === 400) return { estado: "dudoso", motivo: "400: transacción fallida; comprobar en el portal" };
  if (status === 504 && json.proxy === "resultado_desconocido") return { estado: "dudoso", motivo: "Sin respuesta tras enviar: comprobar en el portal" };
  return { estado: "dudoso", motivo: `Respuesta no reconocida (HTTP ${status || "sin respuesta"}): comprobar en el portal` };
}

export function respuestaSimulada(fila: { shopify_order_name: string; unidad: number; sku: string }) {
  return { data: [{ transaction: `TEST_${fila.sku}_${fila.shopify_order_name.replace(/\D/g, "")}-${fila.unidad}`, pin: `TEST${fila.shopify_order_name.replace(/\D/g, "")}${fila.unidad}` }], code: 200, message: "OK" };
}

// Pedido de prueba del modo test: todo inventado, sin relación con Shopify ni con clientes. El prefijo de
// shopify_order_id lo distingue: estas filas se borran al pasar a producción y nunca se piden de verdad.
export const PREFIJO_PRUEBA = "prueba:";
export function pedidoDePrueba(marca: number) {
  const id = `${PREFIJO_PRUEBA}${marca}`;
  return {
    shopify_order_id: id, shopify_order_name: `#PRUEBA-${marca}`, shopify_line_id: id, unidad: 1, sku: "G3PDES250", ean13: GARANTIA3_EANS.G3PDES250, sku_aparato: "APARATO-PRUEBA",
    nombre: "Cliente", apellidos: "De Prueba", email: "cliente.prueba@example.com", telefono: "34600000000", fecha_inicio: new Date(marca).toISOString(), origen_fecha: "Prueba", fecha_prevista: new Date(marca).toISOString(), estado: "enviando", modo: "test",
  };
}

const celda = (valor: unknown) => `"${String(valor ?? "").replace(/"/g, '""')}"`;
export type FilaCsv = { fecha_alta: string | null; shopify_order_name: string; sku: string; ean13: string; sku_aparato: string | null; contrato: string | null; estado: string };

// Sin PIN ni datos del cliente: es para cuadrar con la factura.
export function csvContratos(filas: FilaCsv[]) {
  const cabecera = ["Fecha de alta", "Pedido", "SKU", "EAN", "Aparato", "Contrato", "Estado"];
  return `﻿${[cabecera, ...filas.map((fila) => [fila.fecha_alta?.slice(0, 10), fila.shopify_order_name, fila.sku, fila.ean13, fila.sku_aparato, fila.contrato, fila.estado])].map((linea) => linea.map(celda).join(";")).join("\r\n")}`;
}

export function mesAnterior(ahora: Date) {
  const fin = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), 1));
  const inicio = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth() - 1, 1));
  return { inicio: inicio.toISOString(), fin: fin.toISOString(), etiqueta: inicio.toISOString().slice(0, 7) };
}
