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
  assert.deepEqual(first(computeSimilars(rows).get("base"), ["ok"]), ["ok"]);
});

test("similares: sin stock no entra y el más parecido va primero", () => {
  const rows = [base, lav("lejos", 9, 500), lav("cerca", 8, 405), lav("agotada", 8, 400, { stock: 0 })];
  assert.deepEqual(first(computeSimilars(rows).get("base"), ["cerca", "lejos"]), ["cerca", "lejos"]);
});

test("similares: como mucho 2 por marca", () => {
  const rows = [base, ...[1, 2, 3].map((i) => lav(`b${i}`, 8, 400 + i, { marca: "BOSCH" })), lav("otra", 8, 420)];
  assert.deepEqual(first(computeSimilars(rows).get("base"), ["b1", "b2", "otra"]), ["b1", "b2", "otra"]);
});

test("similares: amplía el margen si salen menos de 6", () => {
  const rows = [base, lav("x10", 10, 480), lav("x8", 8, 410)];
  assert.deepEqual(first(computeSimilars(rows).get("base"), ["x8", "x10"]), ["x8", "x10"]);
});

test("similares: «Más de 10 kg» lee los kilos del título", () => {
  const rows = [lav("g", "Más de 10 kg", 600, { title: "Lavadora LG 13 kg" }), lav("h", "Más de 10 kg", 620, { title: "Lavadora AEG 12 kg" }), lav("p", 6, 600)];
  assert.deepEqual(first(computeSimilars(rows).get("g"), ["h"]), ["h"]);
});

const item = (pid, t, title, pvp, f = {}, stock = 10) => ({ pid, t, title, pvp, stock, marca: pid, f });
// Las listas cortas se rellenan al final con otros grupos: lo que se comprueba es que lo esperado va primero.
const first = (got, expected) => (got ?? []).slice(0, expected.length);

test("similares: los tipos sin regla no reciben similares", () => {
  const rows = [item("a", "Batidoras", "Batidora A", 40), item("b", "Batidoras", "Batidora B", 41)];
  assert.equal(computeSimilars(rows, { preview: true }).get("a"), undefined);
});

test("similares: hornos pirolíticos aparte y lavavajillas de 45 cm aparte", () => {
  const hornos = [item("h", "Hornos", "Horno 71 L pirolítico", 500), item("p", "Hornos", "Horno 70 L pirolítico", 520), item("n", "Hornos", "Horno 71 L hidrolítico", 500)];
  assert.deepEqual(first(computeSimilars(hornos, { preview: true }).get("h"), ["p"]), ["p"]);
  const lav = [item("l", "Lavavajillas", "Lavavajillas 60 cm 14 servicios", 400), item("m", "Lavavajillas", "Lavavajillas 45 cm 10 servicios", 400), item("o", "Lavavajillas", "Lavavajillas 60 cm 13 servicios", 420)];
  assert.deepEqual(first(computeSimilars(lav, { preview: true }).get("l"), ["o"]), ["o"]);
});

test("similares: combis integrables con integrables y el más cercano en altura primero", () => {
  const rows = [
    item("c", "Frigoríficos combi", "Combi 330 L No Frost 186 cm", 600, { "filtro.tecnologia": "No-Frost" }),
    item("alto", "Frigoríficos combi", "Combi 335 L No Frost 203 cm", 600, { "filtro.tecnologia": "No-Frost" }),
    item("igual", "Frigoríficos combi", "Combi 335 L No Frost 186 cm", 600, { "filtro.tecnologia": "No-Frost" }),
    item("int", "Frigoríficos combi", "Combi integrable 330 L No Frost", 600, { "filtro.tecnologia": "No-Frost", "filtro.color": "Integrable" }),
  ];
  assert.deepEqual(first(computeSimilars(rows, { preview: true }).get("c"), ["igual", "alto"]), ["igual", "alto"]);
});

test("similares: sin duplicados por título ni el propio producto repetido", () => {
  const rows = [item("a", "Hornos", "Horno X 71 L", 400), item("a2", "Hornos", "Horno X 71 L", 400), item("b", "Hornos", "Horno Y 70 L", 400), item("b2", "Hornos", "Horno Y 70 L", 400)];
  assert.deepEqual(first(computeSimilars(rows, { preview: true }).get("a"), ["b"]), ["b"]);
});

test("similares: televisores de las mismas pulgadas primero y campanas de isla aparte", () => {
  const tv = (pid, inch, tech, pvp) => item(pid, "Televisores", `Televisor ${pid} ${inch}" ${tech} 4K`, pvp, { "filtro.tamano_pantalla": `${inch}"`, "filtro.tecnologia": tech });
  const tvs = [tv("a", 55, "QLED", 600), tv("b", 55, "QLED", 650), tv("c", 50, "QLED", 600), tv("d", 65, "QLED", 600)];
  assert.deepEqual(first(computeSimilars(tvs, { preview: true }).get("a"), ["b", "c", "d"]), ["b", "c", "d"]); // con pocos se amplía: la de 65" va la última
  const camp = [item("p", "Campanas extractoras", "Campana piramidal P 60 cm 600 m³/h", 300, { "filtro.tipo": "Piramidal" }), item("i", "Campanas extractoras", "Campana de isla I 60 cm 600 m³/h", 300, { "filtro.tipo": "Piramidal" }), item("q", "Campanas extractoras", "Campana piramidal Q 60 cm 650 m³/h", 310, { "filtro.tipo": "Piramidal" })];
  assert.deepEqual(first(computeSimilars(camp, { preview: true }).get("p"), ["q"]), ["q"]);
});

test("similares: las cifras del título no confunden «L» con «LED»", () => {
  const rows = [item("a", "Hornos", "Horno A 71 L LED", 400), item("b", "Hornos", "Horno B 72 LED", 410), item("c", "Hornos", "Horno C 70 L", 405)];
  assert.deepEqual(first(computeSimilars(rows, { preview: true }).get("a"), ["c"]), ["c"]);
});

test("similares: portátiles Mac, gráfica dedicada y monitores ultrapanorámicos aparte", () => {
  const pc = (pid, ram, f = {}) => item(pid, "Portátiles", `Portátil ${pid}`, 800, { "filtro.tamano_pantalla": '15,6"', "filtro.memoria_ram": ram, "filtro.mas_especificaciones": ["Procesador Intel Core Ultra 5"], "filtro.sistema_operativo": "Windows 11", ...f });
  const rows = [pc("base", "16 GB"), pc("mac", "16 GB", { "filtro.mas_especificaciones": ["Procesador Apple M"] }), pc("gaming", "16 GB", { "filtro.caracteristicas": ["Gráfica dedicada"] }), pc("ram8", "8 GB"), pc("ram16", "16 GB")];
  assert.deepEqual(first(computeSimilars(rows, { preview: true }).get("base"), ["ram16", "ram8"]), ["ram16", "ram8"]);
  const mon = (pid, inches, car = []) => item(pid, "Monitores", `Monitor ${pid}`, 200, { "filtro.tamano_pantalla": `${inches}"`, "filtro.caracteristicas": car, "filtro.resolucion": "QHD" });
  const monitors = [mon("m27", 27), mon("ultra", 27, ["Ultrapanorámico"]), mon("port", 15.6), mon("m27b", 27), mon("m24", 23.8)];
  assert.deepEqual(first(computeSimilars(monitors, { preview: true }).get("m27"), ["m27b", "m24"]), ["m27b", "m24"]);
  assert.deepEqual(first(computeSimilars(rows).get("base"), ["ram16", "ram8"]), ["ram16", "ram8"]);
});

test("similares: sobremesa por tipo (el título manda) y misma gama de procesador primero", () => {
  const pc = (pid, title, f = {}) => item(pid, "Ordenadores de sobremesa", title, 700, { "filtro.memoria_ram": "16 GB", ...f });
  const rows = [
    pc("base", "Ordenador de sobremesa Dell Intel Core i5-14400 16 GB 512 GB"),
    pc("i5", "Ordenador HP Pro Intel Core i5-12500 16 GB 512 GB", { "filtro.tipo": "Torre" }),
    pc("i7", "Ordenador Lenovo Intel Core i7-14700 16 GB 512 GB"),
    pc("mini", "Mini PC Acer Intel Core i5 16 GB", { "filtro.tipo": "Torre" }),
    pc("mac", "Ordenador de sobremesa Apple Mac mini M5 16 GB", { "filtro.tipo": "Portátil" }),
    pc("gaming", "Ordenador gaming MSI Intel Core i5-14400F 16 GB"),
  ];
  assert.deepEqual(first(computeSimilars(rows, { preview: true }).get("base"), ["i5", "i7"]), ["i5", "i7"]);
});

test("similares: frigoríficos bajo encimera aparte y placas portátiles aparte", () => {
  const fr = (pid, l, alto, f = {}) => item(pid, "Frigoríficos de 1 puerta", `Frigorífico 1 puerta ${pid} ${l} L`, 300, { "filtro.alto": alto, "filtro.tecnologia": "Cíclico", ...f });
  const rows = [fr("base", 120, "Menos de 85 cm"), fr("alto", 120, "De 185 cm a 199 cm"), fr("bajo", 110, "Menos de 85 cm"), fr("nf", 120, "Menos de 85 cm", { "filtro.tecnologia": "No-Frost" })];
  assert.deepEqual(first(computeSimilars(rows).get("base"), ["bajo", "nf"]), ["bajo", "nf"]);
  const pl = (pid, car = []) => item(pid, "Placas de inducción", `Placa de inducción ${pid} 60 cm`, 300, { "filtro.ancho": "60 cm", "filtro.zonas_fuegos": "3 zonas", "filtro.caracteristicas": car });
  assert.deepEqual(first(computeSimilars([pl("base"), pl("port", ["Portátil"]), pl("ok")]).get("base"), ["ok"]), ["ok"]);
});

test("similares: impresoras de tinta y láser aparte, y relojes infantiles aparte", () => {
  const pr = (pid, tech, pvp = 100) => item(pid, "Impresoras", `Impresora multifunción ${pid}`, pvp, { "filtro.tecnologia": tech, "filtro.caracteristicas": ["Multifunción", "Impresión en color"] });
  assert.deepEqual(first(computeSimilars([pr("base", "Inyección de tinta"), pr("laser", "Láser"), pr("tinta", "Inyección de tinta", 110)]).get("base"), ["tinta"]), ["tinta"]);
  const w = (pid, title) => item(pid, "Smartwatches", title, 100, { "filtro.tamano_pantalla": "44 mm" });
  assert.deepEqual(first(computeSimilars([w("base", "Smartwatch Xiaomi 44 mm"), w("kid", "Smartwatch infantil SPC 44 mm"), w("ok", "Smartwatch Huawei 44 mm")]).get("base"), ["ok"]), ["ok"]);
});

test("similares: las listas de menos de 3 se completan con otros grupos de la familia, detrás", () => {
  const rows = [base, lav("ok", 8, 410), lav("int1", 8, 400, { color: "Integrable" }), lav("int2", 9, 420, { color: "Integrable" }), lav("lejos", 8, 2000, { color: "Integrable" })];
  const list = computeSimilars(rows).get("base");
  assert.equal(list[0], "ok");
  assert.deepEqual([...list].sort(), ["int1", "int2", "ok"]);
});
