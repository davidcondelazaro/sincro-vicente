import assert from "node:assert/strict";
import test from "node:test";
import { buildMhdProductLines as buildExacto, direccionDeExportacion, precioNetoUnitario, rebajarPortes, estadoDeEnvio, pedidoSinEnvio, puntoDeRecogida } from "../src/lib/mhd-order-lines.ts";
import { debeCancelarEnShopify, erroresDeMhd, otrosVigentes, reconciliar, referenciaParaExportar, resultadoDeEnvio } from "../src/lib/mhd-order-reconcile.ts";

// Por defecto lo cobrado es lo que suman las líneas y los portes; las pruebas del total lo pasan a propósito
const buildMhdProductLines = (input) => buildExacto({ totalCobrado: (input.lines.reduce((total, line) => total + Math.round(Number(line.unitPrice) * 100) * line.quantity, 0) + Math.round(Number(input.shippingAmount) * 100)) / 100, ...input });
const destination = { country: "ES", province: "SA", postalCode: "37900" };
const tarjeta = (sku, quantity = 1, unitPrice = "25.00") => ({ sku, quantity, unitPrice, payload: { requiresShipping: false, product: { metafield: null }, lineItemGroup: null } });
const aparato = { sku: "32A4Q", quantity: 1, unitPrice: "199.00", payload: { requiresShipping: true, product: { metafield: { value: JSON.stringify({ gastos_envio_peninsula_particulares: 9.99 }) } }, lineItemGroup: null } };

test("una tarjeta regalo sola se exporta como un SKU con su precio, con portes mínimos y sin aviso", () => {
  const result = buildMhdProductLines({ lines: [tarjeta("10153333")], destination, shippingAmount: "0.00" });
  assert.equal(result.ok, true);
  assert.equal(result.warning, null);
  assert.deepEqual(result.productos.map(({ codigo, cantidad, precio, portes }) => ({ codigo, cantidad, precio, portes })), [{ codigo: "10153333", cantidad: 1, precio: 25, portes: 0.01 }]);
});

test("varias tarjetas de distinto importe van en líneas independientes", () => {
  const result = buildMhdProductLines({ lines: [tarjeta("10153333", 2), tarjeta("10153335", 1, "100.00")], destination, shippingAmount: 0 });
  assert.deepEqual(result.productos.map(({ codigo, cantidad, precio }) => [codigo, cantidad, precio]), [["10153333", 2, 25], ["10153335", 1, 100]]);
});

test("con otros artículos, los portes salen solo de los aparatos", () => {
  const result = buildMhdProductLines({ lines: [aparato, tarjeta("10153334", 1, "50.00")], destination, shippingAmount: "9.99" });
  assert.equal(result.ok, true);
  assert.equal(result.warning, null);
  assert.deepEqual(result.productos.map(({ codigo, portes }) => [codigo, portes]), [["32A4Q", 9.99], ["10153334", 0.01]]);
});

test("cualquier línea sin envío se trata igual, aunque su producto tenga portes", () => {
  const conPortes = { sku: "DIGITAL-1", quantity: 1, unitPrice: "10.00", payload: { requiresShipping: false, product: aparato.payload.product, lineItemGroup: null } };
  const result = buildMhdProductLines({ lines: [conPortes], destination, shippingAmount: 0 });
  assert.equal(result.ok, true);
  assert.equal(result.productos[0].portes, 0.01);
});

const otroAparato = (sku, unitPrice = "450.00") => ({ sku, quantity: 1, unitPrice, payload: { requiresShipping: true, product: { metafield: { value: JSON.stringify({ gastos_envio_peninsula_particulares: 5 }) } }, lineItemGroup: null } });
const garantia = (sku, deAparato, unitPrice = "42.09", quantity = 1) => ({ sku, quantity, unitPrice, payload: { requiresShipping: false, product: { vendor: "GARANTIA3", metafield: null }, lineItemGroup: deAparato ? { variantSku: deAparato } : null } });
const resumen = (result) => result.productos.map(({ codigo, cantidad, precio, portes }) => [codigo, cantidad, precio, portes]);

test("la garantía va detrás de su aparato, como un producto más y sin portes", () => {
  const result = buildMhdProductLines({ lines: [aparato, garantia("10040604", "32A4Q", "35.44")], destination, shippingAmount: "9.99" });
  assert.equal(result.ok, true);
  assert.deepEqual(resumen(result), [["32A4Q", 1, 199, 9.99], ["10040604", 1, 35.44, 0.01]]);
});

test("una garantía repetida en varios aparatos va una sola vez con la suma de unidades", () => {
  const lines = [aparato, garantia("10040586", "32A4Q"), otroAparato("10000449"), garantia("10040586", "10000449"), garantia("10040591", "10000449", "64.24")];
  const result = buildMhdProductLines({ lines, destination, shippingAmount: "14.99" });
  assert.equal(result.ok, true);
  assert.deepEqual(resumen(result), [["32A4Q", 1, 199, 9.99], ["10040586", 2, 42.09, 0.01], ["10000449", 1, 450, 5], ["10040591", 1, 64.24, 0.01]]);
});

test("una garantía comprada sola se exporta sola", () => {
  const result = buildMhdProductLines({ lines: [garantia("10040586", null)], destination, shippingAmount: 0 });
  assert.equal(result.ok, true);
  assert.deepEqual(resumen(result), [["10040586", 1, 42.09, 0.01]]);
});

test("las garantías sueltas van al final y se suman a la misma garantía de un aparato", () => {
  const lines = [garantia("10040600", null, "24.37"), aparato, garantia("10040586", "32A4Q"), garantia("10040586", null)];
  const result = buildMhdProductLines({ lines, destination, shippingAmount: "9.99" });
  assert.deepEqual(resumen(result), [["32A4Q", 1, 199, 9.99], ["10040586", 2, 42.09, 0.01], ["10040600", 1, 24.37, 0.01]]);
});

test("los pedidos anteriores al cambio de SKU mandan el código de MHD de la garantía", () => {
  const antigua = { sku: "G3PDES250", quantity: 1, unitPrice: "30.00", payload: { requiresShipping: false, product: { metafield: null }, lineItemGroup: { variantSku: "32A4Q" } } };
  const result = buildMhdProductLines({ lines: [aparato, antigua], destination, shippingAmount: "9.99" });
  assert.deepEqual(resumen(result), [["32A4Q", 1, 199, 9.99], ["10040604", 1, 30, 0.01]]);
});

test("una garantía sin código de MHD o con dos precios no se exporta", () => {
  const sinCodigo = buildMhdProductLines({ lines: [aparato, garantia("G3XX", "32A4Q")], destination, shippingAmount: "9.99" });
  assert.equal(sinCodigo.ok, false);
  assert.match(sinCodigo.reason, /no lleva un código de MHD/);
  const dosPrecios = buildMhdProductLines({ lines: [aparato, garantia("10040586", "32A4Q"), garantia("10040586", null, "40.00")], destination, shippingAmount: "9.99" });
  assert.equal(dosPrecios.ok, false);
  assert.match(dosPrecios.reason, /precios distintos/);
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
  assert.deepEqual([direccion.firstName, direccion.lastName, direccion.address1, direccion.zip, direccion.provinceCode, direccion.phone, direccion.company], ["Yois", "Ana Pérez 600111222", "Calle Vitoria, 160", "09007", "BU", "+34947225750", ""]);
});

test("sin recogida se usa la dirección de envío", () => {
  const envio = { ...recogida, shippingAddress: { address1: "Calle Real 2" }, fulfillmentOrders: { nodes: [{ deliveryMethod: { methodType: "SHIPPING" }, destination: { location: tienda } }] } };
  assert.equal(direccionDeExportacion(envio, [{ requiresShipping: true }]).address1, "Calle Real 2");
});

test("en la recogida todos los portes van a 0 y cuadran con los 0 € cobrados", () => {
  const result = buildMhdProductLines({ lines: [aparato], destination: { country: "ES", province: "BU", postalCode: "09007" }, shippingAmount: "0.00", recogida: true });
  assert.equal(result.ok, true);
  assert.equal(result.productos[0].portes, 0.01);
});

test("cancelados en MHD: se cancelan en Shopify solo con el interruptor y después del corte", () => {
  const cancelado = { id: 62670, id_estado_cliente: 13, estado_cliente: "Cancelado" };
  const base = { activo: true, desde: "2026-11-14T10:00:00Z", pedido: cancelado, canceladoEn: "2026-11-14T11:00:00Z", yaIntentado: false, canceladoEnShopify: false };
  assert.equal(debeCancelarEnShopify(base), true);
  assert.equal(debeCancelarEnShopify({ ...base, activo: false }), false);
  assert.equal(debeCancelarEnShopify({ ...base, canceladoEn: "2026-11-14T08:47:00Z" }), false);
  assert.equal(debeCancelarEnShopify({ ...base, yaIntentado: true }), false);
  assert.equal(debeCancelarEnShopify({ ...base, canceladoEnShopify: true }), false);
  assert.equal(debeCancelarEnShopify({ ...base, pedido: { id: 62670, id_estado_cliente: 7, estado_cliente: "Pendiente de revisión" } }), false);
});

test("cancelados en MHD: no se cancela en Shopify si se reexportó y hay otro vigente", () => {
  const found = [{ id: 62670, id_estado_cliente: 13 }, { id: 62700, id_estado_cliente: 7 }];
  assert.deepEqual(otrosVigentes(found, 62670).map((order) => order.id), [62700]);
  assert.equal(otrosVigentes([{ id: 62670, id_estado_cliente: 13 }], 62670).length, 0);
});

test("precio neto: el cupón de pedido repartido por Shopify se descuenta del unitario (EV99344)", () => {
  assert.deepEqual(precioNetoUnitario({ quantity: 1, originalUnitPrice: "104.00", allocations: ["5.20"] }), { precio: 98.8, redondeoCentimos: 0 });
  assert.deepEqual(precioNetoUnitario({ quantity: 2, originalUnitPrice: "50.00", allocations: ["5.00"] }), { precio: 47.5, redondeoCentimos: 0 });
  assert.deepEqual(precioNetoUnitario({ quantity: 1, originalUnitPrice: "25.00", allocations: [] }), { precio: 25, redondeoCentimos: 0 });
  assert.deepEqual(precioNetoUnitario({ quantity: 3, originalUnitPrice: "10.00", allocations: ["1.00"] }), { precio: 9.67, redondeoCentimos: -1 });
});

test("total: se exporta si lo que recibe MHD suma exactamente lo cobrado en Shopify", () => {
  const result = buildExacto({ lines: [{ ...aparato, unitPrice: 189.05 }], destination, shippingAmount: "9.99", totalCobrado: "199.04" });
  assert.equal(result.ok, true);
  assert.equal(result.productos[0].precio, 189.05);
});

test("total: si no cuadra con lo cobrado no se exporta y se dice por qué", () => {
  const sinDescuento = buildExacto({ lines: [{ ...aparato, unitPrice: "199.00" }], destination, shippingAmount: "9.99", totalCobrado: "199.04" });
  assert.equal(sinDescuento.ok, false);
  assert.match(sinDescuento.reason, /suma 208,99 € y en Shopify se cobraron 199,04 €/);
  const redondeo = buildExacto({ lines: [tarjeta("10153333", 3, 9.67)], destination, shippingAmount: 0, totalCobrado: "29.00" });
  assert.equal(redondeo.ok, false);
});

test("total: los servicios y las garantías también cuentan", () => {
  const subida = { sku: "SUBIDA-1", quantity: 1, unitPrice: "19.00", payload: { requiresShipping: false, product: { metafield: null }, lineItemGroup: { variantSku: "32A4Q" } } };
  const conServicio = buildExacto({ lines: [aparato, subida], destination, shippingAmount: "9.99", totalCobrado: "227.99" });
  assert.equal(conServicio.ok, true, conServicio.reason);
});

test("referencia: si todo lo de MHD con esa referencia está cancelado se usa la siguiente (EV99344-2)", async () => {
  const mhd = { EV99344: [{ id: 62862, id_estado_cliente: 13 }] };
  const buscar = async (referencia) => mhd[referencia] ?? [];
  assert.deepEqual(await referenciaParaExportar("EV99344", buscar), { referencia: "EV99344-2", encontrados: [], cancelados: 1 });
  assert.deepEqual(await referenciaParaExportar("EV1", buscar), { referencia: "EV1", encontrados: [], cancelados: 0 });
  const vigente = { EV2: [{ id: 1, id_estado_cliente: 13 }], "EV2-2": [{ id: 2, id_estado_cliente: 10 }] };
  const conVigente = await referenciaParaExportar("EV2", async (referencia) => vigente[referencia] ?? []);
  assert.equal(conVigente.referencia, "EV2-2");
  assert.equal(conVigente.encontrados[0].id, 2);
});

test("cupón de pedido con portes y varios cupones en productos distintos: cuadra con lo cobrado", () => {
  // 5 % del pedido repartido en dos aparatos + 10 € de otro cupón solo en el segundo; portes 9,99 cobrados aparte
  const uno = { ...aparato, unitPrice: precioNetoUnitario({ quantity: 1, originalUnitPrice: "199.00", allocations: ["9.95"] }).precio };
  const dos = { ...aparato, sku: "40B5K", unitPrice: precioNetoUnitario({ quantity: 1, originalUnitPrice: "300.00", allocations: ["15.00", "10.00"] }).precio };
  const result = buildExacto({ lines: [uno, dos], destination, shippingAmount: "19.98", totalCobrado: "484.03" });
  assert.equal(result.ok, true, result.reason);
  assert.deepEqual(result.productos.map((p) => p.precio), [189.05, 275]);
});

test("portes rebajados: cupón de envío gratis, portes a 0 (luego el mínimo de 0,01) y el total cuadra", () => {
  const result = buildExacto({ lines: [aparato], destination, shippingAmount: "0.00", totalCobrado: "199.00" });
  assert.equal(result.ok, true, result.reason);
  assert.equal(result.productos[0].portes, 0.01);
  assert.match(result.warning, /Portes rebajados por descuento de envío: 9,99 € → 0,00 €/);
});

test("portes rebajados: a mitad entre dos productos, en céntimos exactos", () => {
  const otro = { ...aparato, sku: "40B5K", payload: { ...aparato.payload, product: { metafield: { value: JSON.stringify({ gastos_envio_peninsula_particulares: 14.99 }) } } } };
  const result = buildExacto({ lines: [aparato, otro], destination, shippingAmount: "12.49", totalCobrado: "410.49" });
  assert.equal(result.ok, true, result.reason);
  const portes = result.productos.reduce((suma, p) => suma + Math.round(p.portes * 100) * p.cantidad, 0);
  assert.equal(portes, 1249);
});

test("rebajarPortes: decimales y unidades", () => {
  assert.deepEqual(rebajarPortes([{ unidad: 999, cantidad: 1 }], 500), [500]);
  assert.deepEqual(rebajarPortes([{ unidad: 999, cantidad: 1 }, { unidad: 1499, cantidad: 1 }], 1249), [500, 749]);
  assert.deepEqual(rebajarPortes([{ unidad: 1000, cantidad: 3 }], 1500), [500]);
  assert.equal(rebajarPortes([{ unidad: 1000, cantidad: 3 }], 1501), null); // 15,01 € no se divide entre 3 unidades
  const mezcla = rebajarPortes([{ unidad: 1000, cantidad: 3 }, { unidad: 500, cantidad: 1 }], 1501); // la línea de 1 unidad absorbe los céntimos
  assert.deepEqual(mezcla, [428, 217]);
  assert.equal(mezcla[0] * 3 + mezcla[1], 1501);
  assert.equal(rebajarPortes([{ unidad: 999, cantidad: 1 }], 1200), null); // cobrado más que las fichas
});

test("portes: si se cobró más de lo que dicen las fichas, se bloquea", () => {
  const result = buildExacto({ lines: [aparato], destination, shippingAmount: "12.00", totalCobrado: "211.00" });
  assert.equal(result.ok, false);
  assert.match(result.reason, /Los portes por producto suman 9,99 € y en Shopify se cobraron 12,00 €/);
});
