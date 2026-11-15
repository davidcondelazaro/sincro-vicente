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
  const rows = [item("a", "Fundas para móvil", "Funda A", 40), item("b", "Fundas para móvil", "Funda B", 41)];
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

test("similares: cafeteras de cápsulas no se mezclan ni al rellenar, y aspiradores de mano por el título", () => {
  const caf = (pid, title) => item(pid, "Cafeteras", title, 100);
  assert.deepEqual(computeSimilars([caf("base", "Cafetera de cápsulas Nespresso Inissia"), caf("dg", "Cafetera de cápsulas Dolce Gusto Mini Me"), caf("ne", "Cafetera Nespresso Vertuo")]).get("base"), ["ne"]);
  const asp = (pid, title, car = []) => item(pid, "Aspiradores", title, 80, { "filtro.caracteristicas": car });
  const rows = [asp("base", "Aspirador de mano Sogo", ["Aspira líquidos"]), asp("mano", "Aspirador de mano Ufesa"), asp("liq", "Aspirador de sólidos y líquidos Kärcher"), asp("mano2", "Aspirador de mano Taurus"), asp("mano3", "Aspirador de mano Tristar")];
  assert.deepEqual(first(computeSimilars(rows).get("base"), ["mano", "mano2", "mano3"]).sort(), ["mano", "mano2", "mano3"]);
});

test("similares: lavasecadoras integrables no se mezclan ni al rellenar, y fregaderos bajo encimera aparte", () => {
  const ls = (pid, title) => item(pid, "Lavadoras secadoras", title, 600, { "filtro.color": /integrable/i.test(title) ? "Integrable" : "Blanco" });
  assert.deepEqual(computeSimilars([ls("base", "Lavasecadora LG 9 kg / 6 kg"), ls("int", "Lavasecadora integrable AEG 9 kg / 6 kg"), ls("ok", "Lavasecadora Bosch 9 kg / 5 kg")]).get("base"), ["ok"]);
  const fr = (pid, title) => item(pid, "Fregaderos", title, 100, { "filtro.tipo": "1 Cubeta", "filtro.material": "Acero inoxidable" });
  const rows = [fr("base", "Fregadero bajo encimera Teka BE 1 cubeta"), fr("sobre", "Fregadero Teka 1 cubeta"), fr("bajo", "Fregadero bajo encimera Cata 1 cubeta")];
  assert.deepEqual(first(computeSimilars(rows).get("base"), ["bajo"]), ["bajo"]);
});

test("similares: estufas de gas, de exterior y eléctricas aparte, y tostadoras por ranuras del título", () => {
  const es = (pid, title) => item(pid, "Estufas", title, 100);
  const rows = [es("base", "Estufa de gas Orbegozo 4200 W"), es("ext", "Estufa de gas de exterior Sogo 4200 W"), es("cuarzo", "Estufa de cuarzo FM 1200 W"), es("gas", "Estufa de gas Svan 4200 W")];
  assert.deepEqual(first(computeSimilars(rows).get("base"), ["gas"]), ["gas"]);
  const to = (pid, title) => item(pid, "Tostadoras", title, 30, { "filtro.zonas_fuegos": "2 ranuras" });
  const tost = [to("base", "Tostadora Moulinex 1 ranura extra-larga"), to("dos", "Tostadora Jata 2 ranuras"), to("una", "Tostadora Princess 1 ranura")];
  assert.deepEqual(first(computeSimilars(tost).get("base"), ["una"]), ["una"]);
});

test("similares: proyectores de oficina, de cine y portátiles aparte", () => {
  const pr = (pid, title) => item(pid, "Proyectores", title, 500);
  const rows = [pr("base", "Proyector Epson XGA 3600 lúmenes"), pr("cine", "Proyector Acer Full HD 3600 lúmenes"), pr("mini", "Proyector TCL Full HD 600 lúmenes"), pr("ofi", "Proyector Acer WXGA 4000 lúmenes")];
  assert.deepEqual(first(computeSimilars(rows).get("base"), ["ofi"]), ["ofi"]);
});

test("similares: procesadores y placas no salen de su zócalo ni al rellenar, y la memoria no mezcla DDR ni formato", () => {
  const cpu = (pid, title, pvp = 300) => item(pid, "Procesadores", title, pvp, {}, 10);
  const rows = [cpu("base", "Procesador AMD Ryzen 5 7500 AM5"), cpu("intel", "Procesador Intel Core Ultra 5 245KF LGA 1851"), cpu("am5", "Procesador AMD Ryzen 7 9700X", 320)];
  assert.deepEqual(computeSimilars(rows).get("base"), ["am5"]);
  const pb = (pid, title) => item(pid, "Placas base", title, 200);
  assert.deepEqual(computeSimilars([pb("base", "Placa base MSI B850 Gaming Plus WiFi ATX"), pb("am4", "Placa base MSI B550 AM4 ATX"), pb("am5", "Placa base ASRock X870 AM5 ATX")]).get("base"), ["am5"]);
  const ram = (pid, title) => item(pid, "Memoria RAM", title, 100);
  assert.deepEqual(computeSimilars([ram("base", "Memoria RAM Kingston 16 GB DDR5 SO-DIMM"), ram("dimm", "Memoria RAM Kingston 16 GB DDR5"), ram("ddr4", "Memoria RAM Crucial 16 GB DDR4 SO-DIMM"), ram("ok", "Memoria RAM Crucial 16 GB DDR5 SO-DIMM")]).get("base"), ["ok"]);
});

test("similares: teclados con otra distribución van detrás y las sartenes van por diámetro", () => {
  const te = (pid, title) => item(pid, "Teclados", title, 30);
  const rows = [te("base", "Teclado inalámbrico Logitech K270"), te("fr", "Teclado inalámbrico Logitech K270 (distribución francesa)"), te("es", "Teclado inalámbrico HP 230")];
  assert.deepEqual(computeSimilars(rows).get("base")[0], "es");
  const sa = (pid, title) => item(pid, "Sartenes", title, 30);
  const sart = [sa("base", "Sartén Bra Efficient 24 cm"), sa("g", "Sartén Tefal 32 cm"), sa("ok", "Sartén Monix 24 cm")];
  assert.deepEqual(computeSimilars(sart).get("base")[0], "ok");
});

test("similares: cartuchos de su serie, cables con los mismos extremos y soportes por sitio", () => {
  const ink = (pid, title, compat, pvp = 20) => item(pid, "Cartuchos de tinta", title, pvp, compat ? { "icecat.compatibilidad": compat } : {});
  const tintas = [
    ink("base", "Cartucho de tinta Brother LC421C cian", "DCP-J1050DW, MFC-J1010DW"),
    ink("xl", "Cartucho de tinta Brother LC421XLM magenta XL", "DCP-J1050DW, MFC-J1010DW", 30),
    ink("otra", "Cartucho de tinta Brother LC3219XLC cian XL", "MFC-J5330DW, MFC-J6530DW"),
    ink("comp", "Cartucho de tinta compatible Dayma M-LC421M magenta para Brother", null, 3),
  ];
  assert.deepEqual(computeSimilars(tintas).get("base"), ["xl"]);
  const hp = [item("a", "Tóner", "Tóner HP CF217A negro", 100, { "icecat.compatibilidad": "Los cartuchos de Tóner HP 17 funcionan con:" }), item("b", "Tóner", "Tóner HP CF210A negro", 100, { "icecat.compatibilidad": "Los cartuchos de Tóner HP 131 funcionan con:" })];
  assert.equal(computeSimilars(hp).get("a"), undefined);
  const cab = (pid, title) => item(pid, "Cables", title, 5);
  const cables = [cab("base", "Cable USB-C a USB-A Lanberg X 1 m"), cab("cc", "Cable USB-C Equip Y 1 m"), cab("ca", "Cable USB-A a USB-C Engel Z 2 m"), cab("hdmi", "Cable HDMI Aisens W 1 m")];
  assert.deepEqual(computeSimilars(cables).get("base"), ["ca"]);
  const sop = (pid, title) => item(pid, "Soportes de TV y monitor", title, 30);
  const soportes = [sop("base", 'Soporte de pared inclinable para TV A 32"-55" 30 kg'), sop("techo", 'Soporte de techo para TV B 32"-55" 30 kg'), sop("ok", 'Soporte de pared inclinable para TV C 32"-65" 35 kg')];
  assert.deepEqual(computeSimilars(soportes).get("base"), ["ok"]);
});
