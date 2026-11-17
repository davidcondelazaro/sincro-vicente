import assert from "node:assert/strict";
import test from "node:test";
import { GARANTIA3_PRODUCTS, refurbishedTitle, warrantyTypeOf, warrantyTypesFromBlock } from "../src/lib/mhd-importer/warranty-types.ts";

// Bloques tal como los manda MHD en /products/:codigo (recortados).
const portatil = [
  { codigo: "10040588", ref_proved: "G3PDES2000", titulo: "Extensión de garantía 2 AÑOS MAS" },
  { codigo: "10040612", ref_proved: "G3PD3ES2000", titulo: "Extensión de garantía 3 AÑOS MAS" },
  { codigo: "10040633", ref_proved: "G3CPDES2000", titulo: "GARANTÍA3 COVER WEBSHOP - 12 meses" },
  { codigo: "10052434", ref_proved: "G3E1212000", titulo: "Garantía3 COMBI - Maximal 250" },
];

test("tipos de las 22 garantías por su referencia de Garantía3", () => {
  assert.equal(warrantyTypeOf({ ref_proved: "G3PDES250" }), "ampliacion_2");
  assert.equal(warrantyTypeOf({ ref_proved: "G3PD3ES1000" }), "ampliacion_3");
  assert.equal(warrantyTypeOf({ ref_proved: "G3CPDES500" }), "cover");
  assert.equal(warrantyTypeOf({ ref_proved: "G3DPDES150" }), "display");
  assert.equal(warrantyTypeOf({ ref_proved: "G3E120250" }), "combi");
  assert.equal(warrantyTypeOf({ ref_proved: "G3E1212000" }), "combi");
  // Sin referencia, por el código de MHD.
  assert.equal(warrantyTypeOf({ codigo: 10040628 }), "display");
  assert.equal(warrantyTypeOf({ codigo: "99999999", ref_proved: "OTRA" }), null);
  assert.equal(GARANTIA3_PRODUCTS.size, 22);
});

test("bloque con garantías: tipos ordenados y sin repetir", () => {
  const result = warrantyTypesFromBlock([...portatil, { codigo: "10040587", ref_proved: "G3PDES1000" }]);
  assert.deepEqual(result.types, ["ampliacion_2", "ampliacion_3", "combi", "cover"]);
  assert.deepEqual(result.unknown, []);
});

test("bloque vacío: sin garantía (se borra el metacampo)", () => {
  assert.deepEqual(warrantyTypesFromBlock([]).types, []);
});

test("ficha sin bloque (leída antes del 12-11): no se toca", () => {
  assert.equal(warrantyTypesFromBlock(null).types, null);
  assert.equal(warrantyTypesFromBlock(undefined).types, null);
});

test("reacondicionados: nunca llevan garantía, aunque MHD la mande", () => {
  assert.deepEqual(warrantyTypesFromBlock(portatil, { refurbished: true }).types, []);
  assert.equal(refurbishedTitle("Portátil HP EliteBook 840 G5 REAC. grado A"), true);
  assert.equal(refurbishedTitle("Portátil HP EliteBook 840 G5"), false);
});

test("garantía que no se reconoce: se avisa y no se ofrece", () => {
  const result = warrantyTypesFromBlock([{ codigo: "10040624", ref_proved: "G3CASA3", titulo: "Casa Nueva 3" }, portatil[0]]);
  assert.deepEqual(result.types, ["ampliacion_2"]);
  assert.equal(result.unknown.length, 1);
  assert.match(result.unknown[0], /10040624/);
});
