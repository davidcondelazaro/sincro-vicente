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

const item = (pid, t, title, pvp, f = {}, stock = 10) => ({ pid, t, title, pvp, stock, marca: pid, f });

test("similares: los tipos sin regla no reciben similares", () => {
  const rows = [item("a", "Batidoras", "Batidora A", 40), item("b", "Batidoras", "Batidora B", 41)];
  assert.equal(computeSimilars(rows, { preview: true }).get("a"), undefined);
});

test("similares: hornos pirolíticos aparte y lavavajillas de 45 cm aparte", () => {
  const hornos = [item("h", "Hornos", "Horno 71 L pirolítico", 500), item("p", "Hornos", "Horno 70 L pirolítico", 520), item("n", "Hornos", "Horno 71 L hidrolítico", 500)];
  assert.deepEqual(computeSimilars(hornos, { preview: true }).get("h"), ["p"]);
  const lav = [item("l", "Lavavajillas", "Lavavajillas 60 cm 14 servicios", 400), item("m", "Lavavajillas", "Lavavajillas 45 cm 10 servicios", 400), item("o", "Lavavajillas", "Lavavajillas 60 cm 13 servicios", 420)];
  assert.deepEqual(computeSimilars(lav, { preview: true }).get("l"), ["o"]);
});

test("similares: combis integrables con integrables y el más cercano en altura primero", () => {
  const rows = [
    item("c", "Frigoríficos combi", "Combi 330 L No Frost 186 cm", 600, { "filtro.tecnologia": "No-Frost" }),
    item("alto", "Frigoríficos combi", "Combi 335 L No Frost 203 cm", 600, { "filtro.tecnologia": "No-Frost" }),
    item("igual", "Frigoríficos combi", "Combi 335 L No Frost 186 cm", 600, { "filtro.tecnologia": "No-Frost" }),
    item("int", "Frigoríficos combi", "Combi integrable 330 L No Frost", 600, { "filtro.tecnologia": "No-Frost", "filtro.color": "Integrable" }),
  ];
  assert.deepEqual(computeSimilars(rows, { preview: true }).get("c"), ["igual", "alto"]);
});

test("similares: sin duplicados por título ni el propio producto repetido", () => {
  const rows = [item("a", "Hornos", "Horno X 71 L", 400), item("a2", "Hornos", "Horno X 71 L", 400), item("b", "Hornos", "Horno Y 70 L", 400), item("b2", "Hornos", "Horno Y 70 L", 400)];
  assert.deepEqual(computeSimilars(rows, { preview: true }).get("a"), ["b"]);
});

test("similares: televisores de las mismas pulgadas primero y campanas de isla aparte", () => {
  const tv = (pid, inch, tech, pvp) => item(pid, "Televisores", `Televisor ${pid} ${inch}" ${tech} 4K`, pvp, { "filtro.tamano_pantalla": `${inch}"`, "filtro.tecnologia": tech });
  const tvs = [tv("a", 55, "QLED", 600), tv("b", 55, "QLED", 650), tv("c", 50, "QLED", 600), tv("d", 65, "QLED", 600)];
  assert.deepEqual(computeSimilars(tvs, { preview: true }).get("a"), ["b", "c", "d"]); // con pocos se amplía: la de 65" va la última
  const camp = [item("p", "Campanas extractoras", "Campana piramidal P 60 cm 600 m³/h", 300, { "filtro.tipo": "Piramidal" }), item("i", "Campanas extractoras", "Campana de isla I 60 cm 600 m³/h", 300, { "filtro.tipo": "Piramidal" }), item("q", "Campanas extractoras", "Campana piramidal Q 60 cm 650 m³/h", 310, { "filtro.tipo": "Piramidal" })];
  assert.deepEqual(computeSimilars(camp, { preview: true }).get("p"), ["q"]);
});

test("similares: las cifras del título no confunden «L» con «LED»", () => {
  const rows = [item("a", "Hornos", "Horno A 71 L LED", 400), item("b", "Hornos", "Horno B 72 LED", 410), item("c", "Hornos", "Horno C 70 L", 405)];
  assert.deepEqual(computeSimilars(rows, { preview: true }).get("a"), ["c"]);
});
