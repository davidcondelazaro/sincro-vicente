// Pruebas del EPREL leído del QR de la etiqueta (src/lib/mhd-importer/eprel-qr.ts), 2026-11-18. Casos reales del piloto.
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": new URL("../src", import.meta.url).pathname } });
const { modeloCoincide } = await jiti.import("../src/lib/mhd-importer/eprel-qr.ts");

test("mismo modelo, aunque EPREL añada color o mercado", () => {
  assert.equal(modeloCoincide("VS19630(TD2223-2)", ["VS19630", "Monitor táctil ViewSonic TD2223 21,5\" VA Full HD 75 Hz"]), true);
  assert.equal(modeloCoincide("TLKC86WS", ["TLKC86W", "Frigorífico combi Telefunken TLKC86W 295 L"]), true);
  assert.equal(modeloCoincide("43E7STUK", ["Televisor Hisense 43E7S 43\" QLED 4K VIDAA"]), true);
  assert.equal(modeloCoincide("32S4K-UKX7", ["Televisor TCL 32S4K 32\" QLED HD Google TV"]), true);
  assert.equal(modeloCoincide("65MRGB87B6B", ["Televisor LG 65MRGB87B6B.AEU 65\" Mini RGB 4K webOS"]), true);
  assert.equal(modeloCoincide("900024N - Smart Monitor 24 1.1", ["Monitor SPC 900024N 23,8\" VA Full HD 60 Hz"]), true);
  assert.equal(modeloCoincide("B3RCNE415HXB1", ["Frigorífico Beko B3RCNE415HXB"]), true);
});

test("modelo hermano o de otro producto: no", () => {
  assert.equal(modeloCoincide("HLF612IADW01", ["Lavadora Hyundai HLF612IADW02 6 kg 1200 rpm clase A", "HLF612IADW02"]), false);
  assert.equal(modeloCoincide("SR185601ENFDX", ["Frigorífico 1 puerta Svan SR185602ENFD 359 L No Frost clase E"]), false);
  assert.equal(modeloCoincide("GBBSJ11EPY", ["Frigorífico combi LG GBBSJ11ESW 333 L No Frost 186 cm clase E"]), false);
  assert.equal(modeloCoincide("Smart Monitor", ["Monitor Smart 24"]), false);
  assert.equal(modeloCoincide(null, ["HCB19560NCDW00"]), false);
});
