import assert from "node:assert/strict";
import test from "node:test";
import { buildMhdProductLines, direccionDeExportacion, estadoDeEnvio, pedidoSinEnvio, puntoDeRecogida } from "../src/lib/mhd-order-lines.ts";
import { erroresDeMhd, reconciliar, resultadoDeEnvio } from "../src/lib/mhd-order-reconcile.ts";

const destination = { country: "ES", province: "SA", postalCode: "37900" };
const tarjeta = (sku, quantity = 1, unitPrice = "25.00") => ({ sku, quantity, unitPrice, payload: { requiresShipping: false, product: { metafield: null }, lineItemGroup: null } });
const aparato = { sku: "32A4Q", quantity: 1, unitPrice: "199.00", payload: { requiresShipping: true, product: { metafield: { value: JSON.stringify({ gastos_envio_peninsula_particulares: 9.99 }) } }, lineItemGroup: null } };

test("una tarjeta regalo sola se exporta como un SKU con su precio, sin portes ni aviso", () => {
  const result = buildMhdProductLines({ lines: [tarjeta("10153333")], destination, shippingAmount: "0.00" });
  assert.equal(result.ok, true);
  assert.equal(result.warning, null);
  assert.deepEqual(result.productos.map(({ codigo, cantidad, precio, portes }) => ({ codigo, cantidad, precio, portes })), [{ codigo: "10153333", cantidad: 1, precio: 25, portes: 0 }]);
});

test("varias tarjetas de distinto importe van en líneas independientes", () => {
  const result = buildMhdProductLines({ lines: [tarjeta("10153333", 2), tarjeta("10153335", 1, "100.00")], destination, shippingAmount: 0 });
  assert.deepEqual(result.productos.map(({ codigo, cantidad, precio }) => [codigo, cantidad, precio]), [["10153333", 2, 25], ["10153335", 1, 100]]);
});

test("con otros artículos, los portes salen solo de los aparatos", () => {
  const result = buildMhdProductLines({ lines: [aparato, tarjeta("10153334", 1, "50.00")], destination, shippingAmount: "9.99" });
  assert.equal(result.ok, true);
  assert.equal(result.warning, null);
  assert.deepEqual(result.productos.map(({ codigo, portes }) => [codigo, portes]), [["32A4Q", 9.99], ["10153334", 0]]);
});

test("cualquier línea sin envío se trata igual, aunque su producto tenga portes", () => {
  const conPortes = { sku: "DIGITAL-1", quantity: 1, unitPrice: "10.00", payload: { requiresShipping: false, product: aparato.payload.product, lineItemGroup: null } };
  const result = buildMhdProductLines({ lines: [conPortes], destination, shippingAmount: 0 });
  assert.equal(result.ok, true);
  assert.equal(result.productos[0].portes, 0);
});

test("solo es pedido sin envío si ninguna línea lo requiere", () => {
  assert.equal(pedidoSinEnvio([{ requiresShipping: false }, { requiresShipping: false }]), true);
  assert.equal(pedidoSinEnvio([{ requiresShipping: false }, { requiresShipping: true }]), false);
  assert.equal(pedidoSinEnvio([]), false);
});

const sinEnvio = (unfulfilledQuantity) => ({ requiresShipping: false, quantity: 1, unfulfilledQuantity });
const conEnvio = (quantity, unfulfilledQuantity) => ({ requiresShipping: true, quantity, unfulfilledQuantity });

test("la tarjeta ya cumplida no deja parcial un pedido con el aparato pendiente", () => {
  assert.equal(estadoDeEnvio("PARTIALLY_FULFILLED", [sinEnvio(0), conEnvio(1, 1)]), "UNFULFILLED");
});

test("si salió todo lo que tiene envío, el pedido está enviado", () => {
  assert.equal(estadoDeEnvio("PARTIALLY_FULFILLED", [sinEnvio(1), conEnvio(1, 0)]), "FULFILLED");
});

test("sigue parcial si faltan líneas con envío por salir", () => {
  assert.equal(estadoDeEnvio("PARTIALLY_FULFILLED", [sinEnvio(0), conEnvio(1, 0), conEnvio(1, 1)]), "PARTIALLY_FULFILLED");
  assert.equal(estadoDeEnvio("PARTIALLY_FULFILLED", [conEnvio(3, 1)]), "PARTIALLY_FULFILLED");
});

test("los demás estados de Shopify no se tocan", () => {
  assert.equal(estadoDeEnvio("UNFULFILLED", [sinEnvio(1), conEnvio(1, 1)]), "UNFULFILLED");
  assert.equal(estadoDeEnvio("FULFILLED", [sinEnvio(0)]), "FULFILLED");
  assert.equal(estadoDeEnvio("ON_HOLD", [conEnvio(1, 1)]), "ON_HOLD");
});

const pedidos = [{ codigo: "32A4Q", cantidad: 2 }, { codigo: "10153333", cantidad: 1 }];
const completo = { id: 7, id_estado_cliente: 2, arr_productos: [{ cd_articulo: "32A4Q", cantidad: 2 }, { cd_articulo: "10153333", cantidad: 1 }] };

test("sin nada en MHD se envía; los cancelados no lo impiden", () => {
  assert.deepEqual(reconciliar(pedidos, []), { accion: "enviar", cancelados: 0 });
  assert.deepEqual(reconciliar(pedidos, [{ id: 55014, id_estado_cliente: 13, estado_cliente: "Cancelado", arr_productos: [] }]), { accion: "enviar", cancelados: 1 });
});

test("si ya está completo en MHD se recupera sin reenviar", () => {
  assert.equal(reconciliar(pedidos, [completo]).accion, "recuperar");
});

test("incompleto o repetido en MHD va a revisión", () => {
  assert.equal(reconciliar(pedidos, [{ ...completo, arr_productos: [{ cd_articulo: "32A4Q", cantidad: 1 }] }]).accion, "revisar");
  assert.equal(reconciliar(pedidos, [completo, { ...completo, id: 8 }]).accion, "revisar");
});

test("solo un rechazo 4xx sin pedido permite reintentar", () => {
  assert.equal(resultadoDeEnvio(201, { success: true, data: completo }, pedidos), "exported");
  assert.equal(resultadoDeEnvio(400, { errors: ["El producto con código X no existe"] }, pedidos), "failed");
  assert.equal(resultadoDeEnvio(500, {}, pedidos), "unknown");
  assert.equal(resultadoDeEnvio(200, { success: false }, pedidos), "unknown");
  assert.equal(resultadoDeEnvio(200, { success: true, data: { ...completo, arr_productos: [] } }, pedidos), "unknown");
});

test("los errores de MHD se aplanan sea cual sea su forma", () => {
  assert.deepEqual(erroresDeMhd({ productos: ["a", "b"], email: "c" }), ["a", "b", "c"]);
  assert.deepEqual(erroresDeMhd("d"), ["d"]);
  assert.deepEqual(erroresDeMhd(undefined), []);
});

const tienda = { name: "Yois", address: { address1: "Calle Vitoria, 160", address2: null, city: "Burgos", zip: "09007", provinceCode: "BU", province: "Burgos", countryCode: "ES", phone: "+34947225750" } };
const recogida = { shippingAddress: null, billingAddress: { name: "Ana Pérez", phone: "600111222", company: "", address1: "Calle Mayor 1", city: "León", zip: "24001", countryCodeV2: "ES", provinceCode: "LE" }, fulfillmentOrders: { nodes: [{ deliveryMethod: { methodType: "PICK_UP" }, destination: { location: tienda } }] } };

test("la recogida va a MHD con la dirección de la tienda y el cliente en apellidos", () => {
  const direccion = direccionDeExportacion(recogida, [{ requiresShipping: true }]);
  assert.equal(puntoDeRecogida(recogida).name, "Yois");
  assert.deepEqual([direccion.firstName, direccion.lastName, direccion.address1, direccion.zip, direccion.provinceCode, direccion.phone, direccion.company], ["Yois", "Ana Pérez · 600111222", "Calle Vitoria, 160", "09007", "BU", "+34947225750", ""]);
});

test("sin recogida se usa la dirección de envío", () => {
  const envio = { ...recogida, shippingAddress: { address1: "Calle Real 2" }, fulfillmentOrders: { nodes: [{ deliveryMethod: { methodType: "SHIPPING" }, destination: { location: tienda } }] } };
  assert.equal(direccionDeExportacion(envio, [{ requiresShipping: true }]).address1, "Calle Real 2");
});

test("en la recogida todos los portes van a 0 y cuadran con los 0 € cobrados", () => {
  const result = buildMhdProductLines({ lines: [aparato], destination: { country: "ES", province: "BU", postalCode: "09007" }, shippingAmount: "0.00", recogida: true });
  assert.equal(result.ok, true);
  assert.equal(result.productos[0].portes, 0);
});
