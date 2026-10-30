// Pruebas de las reglas de Garantía3 (docs/GARANTIA3.md). El .ts se carga con jiti, como en mhd-importer-datos.test.mjs.
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { canceladoEnMhd, csvContratos, datoQueFalta, fechaEnviado, fechaPrevista, fechaRecogida, filasDePedido, interpretarRespuesta, mesAnterior, motivoParaNoPedir, normalizarTelefono, pedidoDePrueba, PREFIJO_PRUEBA, respuestaSimulada } = await jiti.import("../src/lib/garantia3.ts");

test("teléfono: prefijo único y 9 cifras, con los formatos que había en PrestaShop", () => {
  for (const entrada of ["600111222", "34600111222", "+34600111222", "34+34600111222", "34 600 11 12 22", "0034600111222", "(34) 600111222"]) assert.equal(normalizarTelefono(entrada, "ES"), "34600111222", entrada);
  assert.equal(normalizarTelefono("351912345678", "PT"), "351912345678");
  assert.equal(normalizarTelefono("340111222", "ES"), "34340111222"); // Empieza por 34 pero son las 9 cifras
  assert.equal(normalizarTelefono("6001", "ES"), null);
  assert.equal(normalizarTelefono("600111222", "FR"), null);
  assert.equal(normalizarTelefono(null, "ES"), null);
});

const pedido = { email: "a@b.es", billingAddress: { firstName: "Ana", lastName: "Núñez", phone: "600111222", countryCodeV2: "ES" }, shippingAddress: null };
const linea = (sku, quantity = 1, variantSku = "APARATO") => ({ shopify_line_id: `gid/${sku}`, sku, quantity, line_payload: { lineItemGroup: variantSku ? { variantSku } : null } });

test("una fila por unidad y solo de las 9 garantías", () => {
  const filas = filasDePedido(pedido, [linea("APARATO", 2, null), linea("G3PDES500", 2), linea("SUBIDA-1")]);
  assert.deepEqual(filas.map((fila) => [fila.sku, fila.unidad, fila.ean13]), [["G3PDES500", 1, "8033509880394"], ["G3PDES500", 2, "8033509880394"]]);
  assert.equal(filas[0].telefono, "34600111222");
  assert.equal(datoQueFalta(filas[0]), null);
});

test("sin aparato o sin teléfono queda indicado", () => {
  const [suelta] = filasDePedido(pedido, [linea("G3PDES250", 1, null)]);
  assert.match(datoQueFalta(suelta), /aparato/);
  const [sinTelefono] = filasDePedido({ ...pedido, billingAddress: { ...pedido.billingAddress, phone: null } }, [linea("G3PDES250")]);
  assert.match(datoQueFalta(sinTelefono), /teléfono/);
});

test("la fecha es el primer estado de envío de MHD", () => {
  const enviado = Date.UTC(2026, 10, 2); const finalizado = Date.UTC(2026, 10, 5);
  assert.equal(fechaEnviado({ arr_estados: [{ estado: "Pagado", fecha: 1 }, { estado: "Finalizado", fecha: finalizado }, { estado: "Enviado", fecha: enviado }] }), new Date(enviado).toISOString());
  assert.equal(fechaEnviado({ arr_estados: [{ estado: "Procesado", fecha: enviado }] }), null);
  assert.equal(fechaEnviado(null), null);
  assert.equal(fechaPrevista("2026-11-02T00:00:00.000Z", 14), "2026-11-16T00:00:00.000Z");
  assert.equal(canceladoEnMhd({ id_estado_cliente: 13 }), true);
  assert.equal(canceladoEnMhd({ id_estado_cliente: 10, estado_cliente: "Enviado" }), false);
});

const vivo = (cambios = {}) => ({ cancelledAt: null, displayFinancialStatus: "PAID", fulfillmentOrders: { nodes: [] }, fulfillments: [], lineItems: { nodes: [
  { id: "gar", sku: "G3PDES500", currentQuantity: 2, lineItemGroup: { variantSku: "APARATO" } }, { id: "apa", sku: "APARATO", currentQuantity: 2, lineItemGroup: null },
] }, ...cambios });
const fila = { shopify_line_id: "gar", unidad: 2, sku_aparato: "APARATO" };

test("antes de pedir el contrato se mira el pedido real", () => {
  assert.equal(motivoParaNoPedir(vivo(), fila), null);
  assert.equal(motivoParaNoPedir(vivo({ displayFinancialStatus: "PARTIALLY_REFUNDED" }), fila), null); // Un reembolso de otro artículo no la bloquea
  assert.match(motivoParaNoPedir(null, fila), /no existe/);
  assert.match(motivoParaNoPedir(vivo({ cancelledAt: "2026-11-01" }), fila), /cancelado/);
  assert.match(motivoParaNoPedir(vivo({ displayFinancialStatus: "REFUNDED" }), fila), /no pagado/);
  const reembolsada = vivo(); reembolsada.lineItems.nodes[0].currentQuantity = 1;
  assert.match(motivoParaNoPedir(reembolsada, fila), /Garantía/);
  assert.equal(motivoParaNoPedir(reembolsada, { ...fila, unidad: 1 }), null);
  const sinAparato = vivo(); sinAparato.lineItems.nodes[1].currentQuantity = 0;
  assert.match(motivoParaNoPedir(sinAparato, fila), /Aparato/);
});

test("recogida en tienda: cuenta desde que se da por entregado", () => {
  assert.equal(fechaRecogida(vivo()), null);
  const recogida = { fulfillmentOrders: { nodes: [{ deliveryMethod: { methodType: "PICK_UP" } }] } };
  assert.equal(fechaRecogida(vivo(recogida)), null);
  assert.equal(fechaRecogida(vivo({ ...recogida, fulfillments: [{ status: "SUCCESS", createdAt: "2026-11-01", deliveredAt: null }] })), "2026-11-01");
  assert.equal(fechaRecogida(vivo({ ...recogida, fulfillments: [{ status: "SUCCESS", createdAt: "2026-11-01", deliveredAt: "2026-11-02" }] })), "2026-11-02");
});

test("respuestas: solo hay contrato si está claro y lo dudoso no se repite", () => {
  const real = { data: [{ transaction: "1520860821_G3PDES500_972-457c7982", pin: "394014120" }], code: 200, message: "OK" };
  assert.deepEqual(interpretarRespuesta(200, real), { estado: "creado", contrato: real.data[0].transaction, pin: "394014120" });
  assert.equal(interpretarRespuesta(200, { message: "OK", data: [] }).estado, "dudoso");
  assert.equal(interpretarRespuesta(200, null).estado, "dudoso");
  assert.deepEqual(interpretarRespuesta(401, {}).parar, true);
  assert.equal(interpretarRespuesta(401, {}).estado, "error");
  assert.equal(interpretarRespuesta(404, {}).estado, "error");
  assert.equal(interpretarRespuesta(503, { proxy: "no_enviado" }).estado, "error");
  assert.equal(interpretarRespuesta(503, {}).estado, "dudoso");
  assert.equal(interpretarRespuesta(504, { proxy: "resultado_desconocido" }).estado, "dudoso");
  assert.equal(interpretarRespuesta(400, {}).estado, "dudoso");
  assert.equal(interpretarRespuesta(0, null).estado, "dudoso");
});

test("el CSV no lleva PIN y escapa comillas; el mes es el anterior", () => {
  const csv = csvContratos([{ fecha_alta: "2026-11-02T10:00:00Z", shopify_order_name: '#1"7', sku: "G3PDES500", ean13: "1", sku_aparato: null, contrato: "C", estado: "creado", pin: "SECRETO" }]);
  assert.ok(!csv.includes("SECRETO"));
  assert.ok(csv.includes('"2026-11-02";"#1""7"'));
  assert.equal(mesAnterior(new Date("2026-01-01T08:00:00Z")).etiqueta, "2025-12");
});

test("el pedido de prueba es inventado y se distingue de los reales", () => {
  const fila = pedidoDePrueba(1700000000000);
  assert.ok(fila.shopify_order_id.startsWith(PREFIJO_PRUEBA));
  assert.ok(fila.email.endsWith("@example.com"));
  assert.equal(fila.modo, "test");
  assert.equal(datoQueFalta(fila), null);
  assert.equal(interpretarRespuesta(200, respuestaSimulada(fila)).estado, "creado");
});
