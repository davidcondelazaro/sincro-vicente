// Pruebas de las funciones puras del importador de MHD: modelo limpio, tabla de marcas, hoja de datos y cifras,
// descartes y cola de revisión (2026-10-26). Los .ts se cargan con jiti, como en scripts/procesar-productos.mjs.
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { resolveModel } = await jiti.import("../src/lib/mhd-importer/models.ts");
const { resolveBrand, writtenBrand } = await jiti.import("../src/lib/mhd-importer/brands.ts");
const { buildFactSheet, numbersIn, unsupportedNumbers, relativeDifference, sourceDisagreements } = await jiti.import("../src/lib/mhd-importer/facts.ts");
const { applyProfile, discardReason, exclusionReason } = await jiti.import("../src/lib/mhd-importer/rules.ts");
const { energyClassReason, median, priceReason } = await jiti.import("../src/lib/mhd-importer/review.ts");

const model = (ref, brand = "X", titulo = "", icecat = null, extra = {}) => resolveModel({ ref_proved: ref, nombre_marca: brand, titulo, codigo_ean: "8445123456789", ...extra }, icecat);
const icecat = (modelName, partCode, brand = "X") => ({ modelName, partCode, brand });

test("modelo: el de MHD limpio cuando sirve", () => {
  assert.equal(model("WAN24272ES", "Bosch").model, "WAN24272ES");
  assert.equal(model("BCS200BK BLACK", "Kodak").model, "BCS200BK");
  assert.equal(model("RDPF700B BLACK", "Kodak").model, "RDPF700B");
  assert.equal(model("INSTAX MINI 13 MINT GREEN", "Fujifilm").model, "INSTAX MINI 13");
  assert.equal(model("VENU® 4 PLATEADO", "Garmin").model, "VENU 4");
  assert.equal(model("ADD12XB (3NDA0043)", "LG").model, "ADD12XB");
  assert.equal(model("TAPO P110(2-PACK)", "Tp-Link").model, "TAPO P110");
  assert.equal(model("TRUST VOLANTE GXT-289", "Trust").model, "GXT-289");
  assert.equal(model("SET DLSC500 500ML", "Delonghi").model, "DLSC500");
  assert.equal(model("FILTRO P1000 PACK 1", "Brita").model, "P1000");
  assert.equal(model("MONARCH PRO / APPLE IPHON", "UAG").model, "MONARCH PRO");
  assert.equal(model("INSTAX SQUARE SQ1™ GLACIE", "Fujifilm").model, "INSTAX SQUARE SQ1");
  assert.equal(model("LIT HERO BLACK", "GoPro").model, "LIT HERO BLACK"); // «HERO Black» es el nombre, no un color
  assert.equal(model("00184184", "Hama").model, "00184184");              // número de artículo de Hama, no un EAN
  for (const ref of ["729R", "9655N", "531", "EX 60.1 4G AI AL DR CI", "B650 GAMING X AX V2 G10"]) assert.deepEqual([model(ref).model, model(ref).needsReview], [ref, false], ref);
  assert.equal(model("MOUSE CARVE", "Trust").model, "CARVE");
  assert.equal(model("MIG 2325 EN 23 L INOX", "Orbegozo").model, "MIG 2325 EN");
  assert.equal(model("PROTECTOR MOTOROLA MOTO G", "JC").needsReview, true);
  const game = model("THE LAST OF US PART I", "Sony", "Videojuego Sony The Last of Us Part I");
  assert.equal(game.model, "THE LAST OF US PART I"); assert.equal(game.needsReview, false);
  const clean = model("BCS200BK BLACK", "Kodak");
  assert.equal(clean.source, "mhd"); assert.equal(clean.needsReview, false);
});

test("modelo: códigos internos, EAN, caracteres rotos y descripciones van a Icecat o a revisión", () => {
  for (const ref of ["HO0232210", "HO21253017", "VE10541245", "TV90504220", "DSP0000018101", "8445123456789", "Z?MO® XT3", "PROTECTOR APPLE IPH", "DISPENSADOR DE JABON", "TAPADERA 20 CM", "APPLE IPHONE 17 AIR"]) {
    const choice = model(ref, ref.startsWith("APPLE") ? "JC" : "Xiaomi");
    assert.equal(choice.needsReview, true, ref); assert.ok(choice.reason.length > 10, ref);
  }
  assert.equal(model("Z?MO® XT3", "Garmin").model, "ZMO XT3"); // sin Icecat: el de MHD sin símbolos, para la dirección
  assert.equal(model("AU278120", "Denver", "", icecat("TR-51W", "111101000680", "Denver")).model, "TR-51W");
  assert.equal(model("AU278265", "Denver", "", icecat("BTV-223B BLACK", "BTV-223B BLACK", "Denver")).model, "BTV-223B");
  assert.equal(model("HD2215827", "Toshiba", "", icecat("Canvio Ready", "HDTP310EK3AA", "Toshiba")).model, "HDTP310EK3AA");
  assert.equal(model("Z?MO® XT3", "Garmin", "", icecat("zūmo XT3", "010-03862-10", "Garmin")).model, "zūmo XT3");
  const same = model("HX404241", "Philips", "", icecat("HX4042/41", "HX4042/41", "Philips"));
  assert.deepEqual([same.model, same.source, same.needsReview], ["HX4042/41", "icecat", false]);
  // Un ASIN o un nombre con guion delante en Icecat no sirven.
  assert.equal(model("VE10541245", "Amazon", "", icecat("-KINDLE CW", "B0DJGCX6Q2", "Amazon")).needsReview, true);
});

test("marca: tabla de equivalencias, licencias, siglas y correcciones", () => {
  const brand = (mhd, icecatBrand, titulo = "", ref = "") => resolveBrand({ nombre_marca: mhd, titulo, ref_proved: ref }, icecatBrand === null ? null : { brand: icecatBrand });
  assert.equal(brand("Sony", "Sony Interactive Entertainment").brand, "Sony");
  assert.deepEqual([brand("HP", "PNY").brand, brand("HP", "PNY").needsReview], ["HP", false]);
  assert.equal(brand("Honeywell", "Origin Storage").brand, "Honeywell");
  assert.equal(brand("Jata", "JATA").brand, "Jata");
  assert.equal(brand("Cata", "CATA").brand, "Cata");
  assert.equal(brand("NOX", "NOX").brand, "Nox");
  assert.equal(brand("Krom", "NOX").brand, "Krom");
  assert.equal(brand("AEG", "AEG").brand, "AEG");
  assert.equal(brand("Kingston", "Kingston Technology").brand, "Kingston");
  assert.equal(brand("Delonghi", "De'Longhi").brand, "De'Longhi");
  const wrong = brand("Zanussi", "Electrolux", "Lavadora ZANUSSI ZWF8");
  assert.deepEqual([wrong.brand, wrong.vendor, wrong.needsReview], ["Zanussi", "ZANUSSI", true]);
  const fixed = brand("Marshall", "Savio", "Cable Savio CL-1");
  assert.deepEqual([fixed.brand, fixed.vendor, fixed.needsReview], ["Savio", "SAVIO", false]);
  assert.deepEqual([brand("Brother", null, "Cartucho Impresora DAYMA M-LC223C", "M-LC223C").brand, brand("HP", null, "Tóner", "M-CE505A/280A").vendor], ["Dayma", "DAYMA"]);
  assert.equal(brand("Muse", null, "Radio Muse", "M-187 MC").brand, "Muse"); // «M-» solo es Dayma en marcas de impresora
  assert.equal(brand("UAG", "Yashica", "Cámara", "YAS-DGM100-GM").brand, "Yashica");
  assert.equal(brand("BOSCH", null).vendor, "BOSCH");
  for (const [raw, written] of [["HYUNDAI", "Hyundai"], ["LG", "LG"], ["JBL", "JBL"], ["HP", "HP"], ["WMF", "WMF"], ["DELL", "Dell"], ["Tamashii nations", "Tamashii Nations"], ["smartGyro", "smartGyro"], ["Tp-Link", "TP-Link"]]) assert.equal(writtenBrand(raw), written, raw);
});

test("cifras: unidades, cifras pegadas, pulgadas y versiones de norma", () => {
  assert.deepEqual(numbersIn("500GB").map((item) => [item.n, item.unit]), [[500, "gb"]]);
  assert.deepEqual(numbersIn("1 TB y 300 MB/s").map((item) => [item.unit, item.base]), [["gb", 1000], ["mb/s", 300]]);
  for (const text of ["5000 mAh", "4000 DPI", "2000 VA", "800 lm", "15 bar", "12 L/min", "500 m³/h", "30 m²", "250 hojas", "48 MP", "1 Gbps", "20 km"]) assert.notEqual(numbersIn(text)[0].unit, null, text);
  const sheet = new Map([["icecat:pantalla|diagonal de la pantalla", "39,6 cm (15.6\")"], ["mhd:capacidad", "512GB"]]);
  assert.deepEqual(unsupportedNumbers({ title: "Portátil de 15,6 pulgadas con 512 GB, USB 3.2, HDMI 2.1, Wi-Fi 6 y Bluetooth 5.3" }, sheet), []);
  assert.equal(unsupportedNumbers({ title: "Portátil de 17,3\"" }, sheet).length, 1);
});

const profile = (filters = [], keyData = []) => ({ product: { singular: "", plural: "", distinctions: [] }, title: { template: "", key_data: keyData, examples: [], avoid: [] }, meta_title: { template: "", examples: [] }, filters, descriptions: { short: "", long: "", highlight: [], avoid: [] }, subfamily_exceptions: [], questions: [] });
const rule = (metafield, sources, extra = {}) => ({ metafield, label: "", sources, method: "numero_exacto", format: "{n} W", ranges: [], table: [], note: "", ...extra });

test("hoja de datos: límites de las reglas y medidas de MHD frente a Icecat", () => {
  const power = profile([rule("filtro.potencia", ["mhd:Potencia", "icecat:Potencia|Potencia"], { min: "100", max: "4000" })]);
  const sheet = buildFactSheet(power, new Map([["mhd:potencia", "2W"], ["icecat:potencia|potencia", "2000 W"]]));
  assert.equal(sheet.has("mhd:potencia"), false); assert.equal(sheet.get("icecat:potencia|potencia"), "2000 W");
  // Medidas: si cuadran, Icecat (en mm); si no cuadran, MHD; una cifra absurda no gana.
  const dims = (mhd, ice) => buildFactSheet(profile(), new Map([["mhd:altura", mhd], ["icecat:peso y dimensiones|altura", ice]]));
  assert.deepEqual([...dims("85cm", "850 mm").keys()], ["icecat:peso y dimensiones|altura"]);
  assert.deepEqual([...dims("85cm", "8500 mm").keys()], ["mhd:altura"]);
  assert.deepEqual([...dims("845cm", "845 mm").keys()], ["icecat:peso y dimensiones|altura"]);
  assert.deepEqual([...dims("72cm", "45 mm").keys()], ["mhd:altura"]);
  const weight = buildFactSheet(profile(), new Map([["mhd:peso", "1Kg"], ["icecat:peso y dimensiones|peso", "250 g"]]));
  assert.deepEqual([...weight.keys()], ["icecat:peso y dimensiones|peso"]); // 1 kg de MHD es un redondeo
});

test("diferencias de más de un 20 % entre MHD e Icecat", () => {
  assert.equal(relativeDifference("1400 rpm", "1351 rpm") < 0.2, true);
  assert.equal(relativeDifference("60cm", "598 mm") < 0.01, true);
  assert.equal(relativeDifference("9 kg", "7 kg") > 0.2, true);
  assert.equal(relativeDifference("9 kg", "60 cm"), null);
  const p = profile([rule("filtro.capacidad", ["mhd:Capacidad", "icecat:Rendimiento|Capacidad"], { format: "{n} kg", min: "1", max: "30" })], [{ name: "Centrifugado", sources: ["mhd:Centrifugado", "icecat:Rendimiento|Velocidad"], format: "" }]);
  const found = sourceDisagreements(p, new Map([["mhd:capacidad", "9Kg"], ["icecat:rendimiento|capacidad", "7 kg"], ["mhd:centrifugado", "1400 rpm"], ["icecat:rendimiento|velocidad", "1351 rpm"]]));
  assert.deepEqual(found.map((item) => item.name), ["filtro.capacidad"]);
  // Un valor fuera de los límites de la regla no cuenta como diferencia (ya se descarta en la hoja).
  assert.deepEqual(sourceDisagreements(p, new Map([["mhd:capacidad", "90Kg"], ["icecat:rendimiento|capacidad", "9 kg"]])), []);
});

test("descartes: maquetas, unidades sueltas de aire y salud sexual", () => {
  const base = { codigo: "1", codigo_ean: "1", nombre_marca: "X", nombre_subfamilia: null, pvp: 1, stock: 1, imagen: "https://x/a.jpg", letra_eficiencia: null, img_ficha_eficiencia: null, descripcion_ampliada: "x".repeat(200) };
  const reason = (extra) => discardReason({ ...base, ref_proved: "A1", titulo: "", cod_subfamilia: "S01", ...extra }, null, null);
  assert.match(reason({ ref_proved: "DUMMY S26 MAQUETA", titulo: "Merchandising Samsung DUMMY S26 MAQUETA" }), /Maqueta/);
  assert.match(reason({ titulo: "Maqueta Galaxy A57" }), /Maqueta/);
  assert.match(reason({ cod_subfamilia: "B1528" }), /Salud sexual/);
  assert.match(reason({ cod_familia: "K01", cod_subfamilia: "K0101", ref_proved: "PUZ-SM100VKA", titulo: "Aire Acondicionado de Instalación Unidad exterior 62dB Mitsubishi PUZ-SM100VKA" }), /Unidad suelta/);
  assert.match(reason({ cod_familia: "K01", cod_subfamilia: "K0101", ref_proved: "ABC35X", titulo: "Aire Acondicionado 54dB Marca ABC35X", descripcion: "La unidad interior Marca ABC35X combina potencia y silencio." }), /Unidad suelta/);
  // Equipos completos que hablan de su unidad interior: se importan.
  assert.equal(reason({ cod_familia: "K01", ref_proved: "KC70BT2B", titulo: "Aire Acondicionado de Instalación Split 1x1 65dB HISENSE KC70BT2B", descripcion: "El split 1x1 Hisense KC70BT2B… su unidad interior mide 103 cm." }), null);
  assert.equal(reason({ cod_familia: "K01", ref_proved: "HB35XU0A", titulo: "Aire Acondicionado de Instalación Hisense HB35XU0A", descripcion: "El aire Hisense HB35XU0A (con unidad interior HB35XU0AG). La unidad interior HB35XU0AG combina estilo." }), null);
  assert.equal(reason({ cod_familia: "K01", ref_proved: "DS-12KTP-6", titulo: "Aire Acondicionado 54dB Daitsu DS-12KTP-6", descripcion: "La unidad interior DAITSU DS-12KTP-6 combina potencia. La unidad exterior completa el conjunto." }), null);
  assert.equal(exclusionReason({ ref_proved: "WAN24272ES", titulo: "Lavadora Bosch", cod_subfamilia: "G0101" }), null);
});

test("filtros de lista sin dato no son «sin dato»", () => {
  const p = profile([rule("filtro.conectividad", ["mhd:Wifi"], { method: "tabla", table: [{ source: "Sí", value: "WiFi" }] }), rule("filtro.capacidad", ["mhd:Capacidad"], { format: "{n} kg" })]);
  assert.deepEqual(applyProfile(p, new Map()).missing, ["filtro.capacidad"]);
});

test("cola de revisión: clase energética y precio", () => {
  const withClass = (value) => ({ specifications: { "Control de energía": { "Clase de eficiencia energética": value } } });
  assert.equal(energyClassReason("A", withClass("A")), null);
  assert.equal(energyClassReason("Nueva B", withClass("B")), null);
  assert.match(energyClassReason("A", withClass("C")), /Clase energética distinta/);
  assert.match(energyClassReason("A", withClass("A+++")), /Clase energética distinta/);
  assert.equal(energyClassReason("A", { specifications: { x: { "Clase de eficiencia energética (SDR)": "F", "Clase de eficiencia energética (HDR)": "G" } } }) !== null, true);
  assert.equal(energyClassReason(null, withClass("A")), null);
  assert.equal(median([300, 100, 0, null, 200]), 200);
  assert.match(priceReason(0, 200, 10), /Sin precio/);
  assert.match(priceReason(null, 200, 10), /Sin precio/);
  assert.match(priceReason(1001, 200, 10), /más de 5 veces/);
  assert.match(priceReason(39, 200, 10), /quinta parte/);
  assert.equal(priceReason(250, 200, 10), null);
  assert.equal(priceReason(5000, 200, 2), null); // con pocos precios en la subfamilia no se compara
});

test("reglas de revisión del perfil", async () => {
  const { reviewReasons } = await jiti.import("../src/lib/mhd-importer/rules.ts");
  const profile = { filters: [], review: [
    { label: "Categoría de Icecat ajena a la familia", sources: ["icecat:categoria"], method: "fuera_de_lista", table: [{ source: "fundas", value: "" }, { source: "protectores", value: "" }], ranges: [] },
    { label: "Maqueta o réplica", sources: ["mhd:titulo"], method: "contiene", table: [{ source: "réplica", value: "Réplica" }], ranges: [] },
    { label: "Precio de pack", sources: ["mhd:Unidades"], method: "tramos", table: [], ranges: [{ from: "10", to: "", value: "Pack grande" }], subfamilies: ["S4001"] },
  ] };
  const values = new Map([["icecat:categoria", "Smartphones"], ["mhd:titulo", "Funda transparente iPhone"], ["mhd:unidades", "12"]]);
  const reasons = reviewReasons(profile, values, "S4050");
  assert.equal(reasons.length, 1);
  assert.match(reasons[0], /Categoría de Icecat ajena/);
  assert.equal(reviewReasons(profile, new Map([["icecat:categoria", "Fundas para teléfonos móviles"]]), "S4001").length, 0);
  assert.equal(reviewReasons(profile, new Map([["mhd:unidades", "12"]]), "S4001").length, 1);
  assert.equal(reviewReasons({ filters: [] }, values, null).length, 0);
});

test("regla de revisión «distinto» (MHD frente a Icecat)", async () => {
  const { reviewReasons } = await jiti.import("../src/lib/mhd-importer/rules.ts");
  const profile = { filters: [], review: [{ label: "Integrable según MHD y libre instalación según Icecat", sources: ["mhd:integrable", "icecat:diseño|tipo de instalación"], method: "distinto", table: [{ source: "sí", value: "integrable" }, { source: "integrado", value: "integrable" }, { source: "independiente", value: "libre" }, { source: "no", value: "libre" }], ranges: [] }] };
  assert.equal(reviewReasons(profile, new Map([["mhd:integrable", "Sí"], ["icecat:diseño|tipo de instalación", "Independiente"]]), null).length, 1);
  assert.equal(reviewReasons(profile, new Map([["mhd:integrable", "Sí"], ["icecat:diseño|tipo de instalación", "Completamente integrado"]]), null).length, 0);
  assert.equal(reviewReasons(profile, new Map([["mhd:integrable", "Sí"]]), null).length, 0);
});

test("diferencias MHD/Icecat: la misma cifra en otra unidad no cuenta", () => {
  const profile = { title: { key_data: [{ name: "Potencia", sources: ["mhd:Potencia", "icecat:Desempeño|Potencia"], format: "{n} W" }] }, filters: [] };
  assert.equal(sourceDisagreements(profile, new Map([["mhd:potencia", "1,45W"], ["icecat:desempeño|potencia", "1450 W"]])).length, 0);
  assert.equal(sourceDisagreements(profile, new Map([["mhd:potencia", "2000W"], ["icecat:desempeño|potencia", "1500 W"]])).length, 1);
});

test("negritas de la descripción larga: como mucho 4, datos cortos, sin etiquetas ni repetidas", async () => {
  const { normalizeBold } = await jiti.import("../src/lib/mhd-importer/content.ts");
  const html = "<p>Lavadora de <strong>9 kg</strong> con <strong>motor Inverter</strong> y <b>clase A</b>.</p><ul><li><strong>Peso:</strong> 70 kg</li></ul><p><strong>Es una lavadora muy completa para toda la familia</strong>, con <strong>9 kg</strong>, <strong>1400 rpm</strong>, <strong>vapor</strong> y <strong>WiFi</strong>.</p>";
  const out = normalizeBold(html);
  assert.equal((out.match(/<strong>/g) ?? []).length, 4);
  assert.match(out, /<strong>9 kg<\/strong>/);
  assert.match(out, /<strong>clase A<\/strong>/);
  assert.match(out, /<li>Peso: 70 kg<\/li>/);
  assert.match(out, /<p>Es una lavadora muy completa/);
  assert.match(out, /, vapor y WiFi\./);
  assert.equal(normalizeBold("<p>Sin negritas.</p>"), "<p>Sin negritas.</p>");
});
