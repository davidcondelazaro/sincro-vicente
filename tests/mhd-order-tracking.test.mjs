import assert from "node:assert/strict";
import test from "node:test";
import { accionEnShopify, debeMirarEntrega, enviadoDesde, estadoDeTexto, htmlALineas, LECTORES, madridAIso } from "../src/lib/mhd-order-tracking.ts";

// Entregas y recogidas (docs/PEDIDOS_MHD_FASE_1.md › Entregas y recogidas). Páginas inventadas con la forma de las reales.

test("nunca se mira antes de 24 h del «Enviado» y a los 10 días se deja", () => {
  const regla = (horas) => debeMirarEntrega({ enviadoAt: "2026-11-18T10:00:00Z", ahora: new Date(Date.parse("2026-11-18T10:00:00Z") + horas * 3_600_000), horasEspera: 24, diasMaximo: 10 });
  assert.equal(regla(23.9), "esperar");
  assert.equal(regla(24), "mirar");
  assert.equal(regla(240), "mirar");
  assert.equal(regla(240.1), "caducado");
  assert.equal(debeMirarEntrega({ enviadoAt: null, ahora: new Date(), horasEspera: 24, diasMaximo: 10 }), "esperar");
});

test("la hora de Madrid pasa a UTC con el horario de invierno y de verano", () => {
  assert.equal(madridAIso(2026, 11, 19, 10, 41), "2026-11-19T09:41:00.000Z");
  assert.equal(madridAIso(2026, 7, 1, 10, 0), "2026-07-01T08:00:00.000Z");
});

test("el texto del transportista da el estado; «no entregado» y ausente son incidencia", () => {
  assert.equal(estadoDeTexto("Entregado"), "entregado");
  assert.equal(estadoDeTexto("Entregada"), "entregado");
  assert.equal(estadoDeTexto("No entregado - ausente"), "incidencia");
  assert.equal(estadoDeTexto("Devuelto al remitente"), "incidencia");
  assert.equal(estadoDeTexto("En reparto"), "en_reparto");
  assert.equal(estadoDeTexto("En tránsito"), "en_transito");
  assert.equal(estadoDeTexto("Envío creado"), "en_preparacion");
  assert.equal(estadoDeTexto("Otra cosa"), "desconocido");
});

test("el HTML queda en líneas, sin scripts y con las entidades decodificadas", () => {
  const lineas = htmlALineas("<html><script>var x=1;</script><style>p{}</style><p>Entregado&nbsp;en&nbsp;delegaci&oacute;n</p><div>Le&#243;n</div><br>  <span> </span></html>");
  assert.deepEqual(lineas, ["Entregado en delegación", "León"]);
});

test("TDN: la línea «estado - lugar - fecha hora»", () => {
  const lectura = LECTORES.TDN(["Seguimiento", "Entregado - 099 CIUDAD - 19/11/2026 10:41", "En reparto - 099 CIUDAD - 19/11/2026 08:02"]);
  assert.deepEqual(lectura, { estado: "entregado", texto: "Entregado", fecha: "2026-11-19T09:41:00.000Z", lugar: "099 CIUDAD" });
  assert.equal(LECTORES.TDN(["Página cambiada"]), null);
});

test("ON TIME: tras «Tracking», fecha, hora, estado y delegación", () => {
  const lectura = LECTORES.ONTIME(["Cabecera", "Tracking", "20 noviembre 2026", "11:43", "Entregada", "DELEGACIÓN X", "19 noviembre 2026"]);
  assert.deepEqual(lectura, { estado: "entregado", texto: "Entregada", fecha: "2026-11-20T10:43:00.000Z", lugar: "DELEGACIÓN X" });
  assert.equal(LECTORES.ONTIME(["Tracking", "sin fecha"]), null);
});

test("el «Enviado» sale del historial de MHD; si no está, del último cambio", () => {
  assert.equal(enviadoDesde({ mhd_status_payload: { arr_estados: [{ estado: "Procesado", fecha: 1763460000000 }, { estado: "Enviado", fecha: 1763546400000 }] }, mhd_status_updated_at: "2026-11-20T00:00:00Z" }), new Date(1763546400000).toISOString());
  assert.equal(enviadoDesde({ mhd_status_payload: { arr_estados: [] }, mhd_status_updated_at: "2026-11-20T00:00:00Z" }), "2026-11-20T00:00:00Z");
});

const orden = (extra) => ({ id: "fo1", status: "OPEN", deliveryMethod: { methodType: "PICK_UP" }, assignedLocation: { location: { id: "almacen" } }, destination: { location: { id: "tienda", name: "Tienda" } }, ...extra });
test("recogida asignada al almacén: se transfiere a la tienda elegida y se marca «Listo para recoger»", () => {
  const accion = accionEnShopify({ displayFulfillmentStatus: "UNFULFILLED", fulfillmentOrders: { nodes: [orden()] }, fulfillments: [] });
  assert.deepEqual(accion, { tipo: "listo_recoger", ids: ["fo1"], mover: [{ id: "fo1", destino: "tienda", tienda: "Tienda" }] });
});
test("recogida ya en la tienda: no se transfiere", () => {
  const accion = accionEnShopify({ displayFulfillmentStatus: "UNFULFILLED", fulfillmentOrders: { nodes: [orden({ assignedLocation: { location: { id: "tienda" } } })] }, fulfillments: [] });
  assert.deepEqual(accion.mover, []);
});
test("recogida ya preparada o recogida: no se toca", () => {
  const accion = accionEnShopify({ displayFulfillmentStatus: "FULFILLED", fulfillmentOrders: { nodes: [orden({ status: "CLOSED" })] }, fulfillments: [] });
  assert.equal(accion.tipo, "ya_hecho");
});

const envio = (eventos) => ({ id: "f1", status: "SUCCESS", events: { nodes: eventos.map((status) => ({ status })) } });
const domicilio = { id: "fo2", status: "CLOSED", deliveryMethod: { methodType: "SHIPPING" }, assignedLocation: null, destination: null };
test("a domicilio: evento «Entregado» en el envío; sin envío marcado se espera; si ya lo tiene, nada", () => {
  assert.deepEqual(accionEnShopify({ displayFulfillmentStatus: "FULFILLED", fulfillmentOrders: { nodes: [domicilio] }, fulfillments: [envio(["IN_TRANSIT"])] }), { tipo: "entregado", ids: ["f1"] });
  assert.equal(accionEnShopify({ displayFulfillmentStatus: "UNFULFILLED", fulfillmentOrders: { nodes: [{ ...domicilio, status: "OPEN" }] }, fulfillments: [] }).tipo, "esperar");
  assert.equal(accionEnShopify({ displayFulfillmentStatus: "FULFILLED", fulfillmentOrders: { nodes: [domicilio] }, fulfillments: [envio(["DELIVERED"])] }).tipo, "ya_hecho");
});
