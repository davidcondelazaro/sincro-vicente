// Pruebas de los similares por familia (2026-11-15): grupo obligatorio, margen por escalones, marcas y stock.
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": new URL("../src", import.meta.url).pathname } });
const { computeSimilars } = await jiti.import("../src/lib/mhd-importer/similar-recipes.ts");

const lav = (pid, kg, pvp, { stock = 10, marca = pid, color = "Blanco", car = [], rpm = "1400 rpm", title } = {}) => ({
  pid, t: "Lavadoras", title: title ?? `Lavadora ${pid} ${kg} kg`, pvp, stock, marca,
  f: { "filtro.capacidad": typeof kg === "number" ? `${kg} kg` : kg, "filtro.color": color, "filtro.caracteristicas": car, "filtro.centrifugado": rpm, "features.eficiencia_energ_tica": "Nueva A" },
});
const base = lav("base", 8, 400);

test("similares: integrables solo con integrables y carga superior aparte", () => {
  const rows = [base, lav("int", 8, 400, { color: "Integrable" }), lav("sup", 8, 400, { car: ["Carga superior"] }), lav("ok", 8, 410)];
  assert.deepEqual(computeSimilars(rows).get("base"), ["ok"]);
});

test("similares: sin stock no entra y el más parecido va primero", () => {
  const rows = [base, lav("lejos", 9, 500), lav("cerca", 8, 405), lav("agotada", 8, 400, { stock: 0 })];
  assert.deepEqual(computeSimilars(rows).get("base"), ["cerca", "lejos"]);
});

test("similares: como mucho 2 por marca", () => {
  const rows = [base, ...[1, 2, 3].map((i) => lav(`b${i}`, 8, 400 + i, { marca: "BOSCH" })), lav("otra", 8, 420)];
  assert.deepEqual(computeSimilars(rows).get("base"), ["b1", "b2", "otra"]);
});

test("similares: amplía el margen si salen menos de 6", () => {
  const rows = [base, lav("x10", 10, 480), lav("x8", 8, 410)];
  assert.deepEqual(computeSimilars(rows).get("base"), ["x8", "x10"]);
});

test("similares: «Más de 10 kg» lee los kilos del título", () => {
  const rows = [lav("g", "Más de 10 kg", 600, { title: "Lavadora LG 13 kg" }), lav("h", "Más de 10 kg", 620, { title: "Lavadora AEG 12 kg" }), lav("p", 6, 600)];
  assert.deepEqual(computeSimilars(rows).get("g"), ["h"]);
});
