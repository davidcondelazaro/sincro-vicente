import assert from "node:assert/strict";
import test from "node:test";
import { buildMhdOrderObservations, SHIP_TOGETHER_NOTE } from "../src/lib/mhd-order-notes.ts";

const shipTogether = [{ key: "Enviar todo junto", value: "Sí" }];

test("sin el atributo, las observaciones no cambian", () => {
  assert.equal(buildMhdOrderObservations({ orderNote: "Llamar antes", discountSummary: "VERANO10" }), "Observaciones del pedido: Llamar antes\nDetalle de los descuentos aplicados: VERANO10");
  assert.equal(buildMhdOrderObservations({ orderNote: "Llamar antes", customAttributes: [{ key: "Otro", value: "Sí" }] }), "Observaciones del pedido: Llamar antes");
  assert.equal(buildMhdOrderObservations({ orderNote: null, customAttributes: [] }), "");
});

test("con «Enviar todo junto: Sí» se añade en línea aparte tras la nota del cliente", () => {
  assert.equal(buildMhdOrderObservations({ orderNote: "Llamar antes", discountSummary: "VERANO10", customAttributes: shipTogether }), `Observaciones del pedido: Llamar antes\n${SHIP_TOGETHER_NOTE}\nDetalle de los descuentos aplicados: VERANO10`);
});

test("con la nota vacía, el comentario es solo el aviso", () => {
  assert.equal(buildMhdOrderObservations({ orderNote: "  ", customAttributes: shipTogether }), SHIP_TOGETHER_NOTE);
});

test("un valor vacío o distinto de «Sí» no añade nada", () => {
  for (const value of ["", null, "No", "Si"]) assert.equal(buildMhdOrderObservations({ customAttributes: [{ key: "Enviar todo junto", value }] }), "");
});

test("acepta «Sí» con la tilde descompuesta (NFD)", () => {
  assert.equal(buildMhdOrderObservations({ customAttributes: [{ key: "Enviar todo junto", value: "Sí" }] }), SHIP_TOGETHER_NOTE);
});

test("no se duplica aunque se recalcule o el atributo venga repetido", () => {
  const input = { orderNote: "Llamar antes", customAttributes: [...shipTogether, ...shipTogether] };
  const first = buildMhdOrderObservations(input);
  assert.equal(first, buildMhdOrderObservations(input));
  assert.equal(first.split(SHIP_TOGETHER_NOTE).length - 1, 1);
});
