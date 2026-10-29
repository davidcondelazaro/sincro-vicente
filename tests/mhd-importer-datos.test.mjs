// Pruebas de las funciones puras del importador de MHD: modelo limpio, tabla de marcas, hoja de datos y cifras,
// descartes y cola de revisión (2026-10-26). Los .ts se cargan con jiti, como en scripts/procesar-productos.mjs.
import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { resolveModel } = await jiti.import("../src/lib/mhd-importer/models.ts");
const { fixBrandText, resolveBrand, writtenBrand } = await jiti.import("../src/lib/mhd-importer/brands.ts");
const { buildFactSheet, numbersIn, unsupportedNumbers, relativeDifference, sourceDisagreements } = await jiti.import("../src/lib/mhd-importer/facts.ts");
const { applyProfile, discardReason, exclusionReason } = await jiti.import("../src/lib/mhd-importer/rules.ts");
const { energyClassReason, median } = await jiti.import("../src/lib/mhd-importer/review.ts");

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
  assert.deepEqual([model("PROTECTOR MOTOROLA MOTO G", "JC").model, model("PROTECTOR MOTOROLA MOTO G", "JC").dropped], [null, "compatibility"]);
  const game = model("THE LAST OF US PART I", "Sony", "Videojuego Sony The Last of Us Part I");
  assert.equal(game.model, "THE LAST OF US PART I"); assert.equal(game.needsReview, false);
  const clean = model("BCS200BK BLACK", "Kodak");
  assert.equal(clean.source, "mhd"); assert.equal(clean.needsReview, false);
});

test("modelo: EAN, caracteres rotos y descripciones van a Icecat o a revisión", () => {
  for (const ref of ["8445123456789", "Z?MO® XT3", "DISPENSADOR DE JABON", "TAPADERA 20 CM"]) {
    const choice = model(ref, "Xiaomi");
    assert.equal(choice.needsReview, true, ref); assert.ok(choice.reason.length > 10, ref);
  }
  assert.equal(model("Z?MO® XT3", "Garmin").model, "ZMO XT3"); // sin Icecat: el de MHD sin símbolos, para la dirección
  assert.equal(model("AU278120", "Denver", "", icecat("TR-51W", "111101000680", "Denver")).model, "TR-51W");
  assert.equal(model("AU278265", "Denver", "", icecat("BTV-223B BLACK", "BTV-223B BLACK", "Denver")).model, "BTV-223B");
  assert.equal(model("HD2215827", "Toshiba", "", icecat("Canvio Ready", "HDTP310EK3AA", "Toshiba")).model, "HDTP310EK3AA");
  assert.equal(model("Z?MO® XT3", "Garmin", "", icecat("zūmo XT3", "010-03862-10", "Garmin")).model, "zūmo XT3");
  const same = model("HX404241", "Philips", "", icecat("HX4042/41", "HX4042/41", "Philips"));
  assert.deepEqual([same.model, same.source, same.needsReview], ["HX4042/41", "icecat", false]);
  // Un ASIN o un nombre con guion delante en Icecat no sirven: sin modelo.
  assert.deepEqual([model("VE10541245", "Amazon", "", icecat("-KINDLE CW", "B0DJGCX6Q2", "Amazon")).model, model("VE10541245", "Amazon", "", icecat("-KINDLE CW", "B0DJGCX6Q2", "Amazon")).needsReview], [null, false]);
});

test("modelo: código interno o compatibilidad sin Icecat, sin modelo o el de la descripción (2026-10-27)", () => {
  for (const ref of ["HO0232210", "HO21253017", "VE10541245", "TV90504220", "DSP0000018101", "MGS0000028700", "CA20504928"]) {
    const choice = model(ref, "Xiaomi");
    assert.deepEqual([choice.model, choice.needsReview, choice.dropped], [null, false, "internal"], ref);
  }
  for (const ref of ["PROTECTOR APPLE IPH", "APPLE IPHONE 17 AIR", "SAMSUNG GALAXY A57", "PROTECTOR DE LENTE / APPL"]) assert.deepEqual([model(ref, "JC").model, model(ref, "JC").needsReview, model(ref, "JC").dropped], [null, false, "compatibility"], ref);
  // Referencias reales con forma de código interno (grupo SEB y BSH): son el modelo.
  for (const [ref, brand] of [["LS340800", "Moulinex"], ["XA254010", "Tefal"], ["EA870810", "Krups"], ["WB406120", "Rowenta"], ["HZ638070", "Siemens"]]) assert.deepEqual([model(ref, brand).model, model(ref, brand).needsReview], [ref, false], ref);
  assert.equal(model("AB123014", "Abysm").model, null);
  const found = resolveModel({ ref_proved: "UK505445", nombre_marca: "Unykach", titulo: "", codigo_ean: "8445123456789" }, null, "MK212 PRO");
  assert.deepEqual([found.model, found.source, found.needsReview], ["MK212 PRO", "texto", false]);
  // Lo que encuentre la IA también se limpia y tiene que ser un modelo: sin cifras o una compatibilidad, no vale.
  assert.equal(resolveModel({ ref_proved: "UK505445", nombre_marca: "Unykach", titulo: "" }, null, "SLIM").model, null);
  assert.equal(resolveModel({ ref_proved: "JC123456", nombre_marca: "JC", titulo: "" }, null, "IPHONE 15").model, null);
});

test("marca: tabla de equivalencias, licencias, siglas y correcciones", () => {
  const brand = (mhd, icecatBrand, titulo = "", ref = "") => resolveBrand({ nombre_marca: mhd, titulo, ref_proved: ref }, icecatBrand === null ? null : { brand: icecatBrand });
  assert.equal(brand("Sony", "Sony Interactive Entertainment").brand, "Sony");
  assert.deepEqual([brand("HP", "PNY").brand, brand("HP", "PNY").needsReview], ["HP", false]);
  assert.equal(brand("Honeywell", "Origin Storage").brand, "Honeywell");
  // Cola de revisión, 2026-10-27: misma casa (manda MHD) y marca equivocada en MHD (manda Icecat).
  assert.deepEqual([brand("Dell", "Alienware").brand, brand("Dell", "Alienware").needsReview], ["Dell", false]);
  assert.deepEqual([brand("Apple", "Beats by Dr. Dre").brand, brand("Apple", "Beats by Dr. Dre").needsReview], ["Apple", false]);
  assert.deepEqual([brand("Philips", "Remington").brand, brand("Philips", "Remington").vendor, brand("Philips", "Remington").needsReview], ["Remington", "REMINGTON", false]);
  assert.deepEqual([brand("OEM", "Medisana").brand, brand("OEM", "Medisana").needsReview], ["Medisana", false]);
  assert.equal(brand("Vivanco", "Titan").needsReview, true);
  assert.equal(brand("Jata", "JATA").brand, "Jata");
  assert.equal(brand("Cata", "CATA").brand, "Cata");
  assert.equal(brand("NOX", "NOX").brand, "Nox");
  assert.equal(brand("Krom", "NOX").brand, "Krom");
  assert.equal(brand("AEG", "AEG").brand, "AEG");
  assert.equal(brand("Kingston", "Kingston Technology").brand, "Kingston");
  assert.equal(brand("Delonghi", "De'Longhi").brand, "De'Longhi");
  const wrong = brand("Zanussi", "Beko", "Lavadora ZANUSSI ZWF8");
  assert.deepEqual([wrong.brand, wrong.vendor, wrong.needsReview], ["Zanussi", "ZANUSSI", true]);
  assert.deepEqual([brand("Zanussi", "Electrolux").brand, brand("Zanussi", "Electrolux").needsReview], ["Zanussi", false]); // mismo grupo (2026-10-27)
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
  // 2026-10-27: unidades, listas, ceros y datos que no son el mismo.
  assert.equal(relativeDifference("12 meses", "1 año(s)"), 0);
  assert.equal(relativeDifference("4,000 GB", "4 TB"), 0);
  assert.equal(relativeDifference("800 ppp / 1200 ppp / 1600 ppp", "1600 DPI"), 0);
  assert.equal(relativeDifference("4 TB", "0 GB"), null);
  assert.equal(relativeDifference("5 dispositivos", "1 licencia(s)"), null);
  assert.equal(relativeDifference("1,007 m³/h", "1007 m³/h"), 0);
  assert.equal(relativeDifference("802 m³/h", "340 m³/h") > 0.2, true);
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

test("cifras: valen también las de los textos de MHD e Icecat (masivo, 2026-10-26)", () => {
  const sheet = new Map([["mhd:resolución", "4K Ultra HD"]]);
  const texto = { long_description_html: "<p>Resolución 3840 x 2160 y distancia de proyección desde 1,9 m.</p>" };
  assert.equal(unsupportedNumbers(texto, sheet).length, 3); // 3840, 2160 y 1,9 m
  assert.deepEqual(unsupportedNumbers(texto, sheet, [], ["su resolución 4K Ultra HD (3840 x 2160)", "<p>distancia de proyección desde 1,9 m hasta 9,7 m</p>"]), []);
  assert.equal(unsupportedNumbers({ short_description: "Pantalla de 159,4 cm" }, sheet, [], ["distancia desde 1,9 m"]).length, 1);
});

test("título: vale la referencia de MHD o el modelo comercial de Icecat (masivo, 2026-10-26)", async () => {
  const { validateContent } = await jiti.import("../src/lib/mhd-importer/content.ts");
  const ficha = (title) => ({ title, meta_title: "x", short_description: "x", meta_description: "y".repeat(140), long_description_html: "<p>x</p><h2>x</h2>", elvi_tip: { text: "", sources: [] } });
  const modelo = (errors) => errors.filter((error) => error.startsWith("El título no lleva el modelo"));
  assert.equal(modelo(validateContent(ficha("Proyector Acer X1827 4K"), "Acer", "MR.JQG11.001", [], new Map())).length, 1);
  assert.deepEqual(modelo(validateContent(ficha("Proyector Acer X1827 4K"), "Acer", "MR.JQG11.001", [], new Map(), ["X1827", "MR.JQG11.001"])), []);
  assert.deepEqual(modelo(validateContent(ficha("Monitor Dell P2424HT de 24\""), "Dell", "DELL-P2424HT", [], new Map(), ["P2424HT"])), []);
  assert.deepEqual(modelo(validateContent(ficha("Lavadora Bosch WAN 24272 ES"), "Bosch", "WAN24272ES", [], new Map())), []);
});

test("título: los datos clave solo se exigen si son una cifra (masivo, 2026-10-26)", async () => {
  const { missingKeyData } = await jiti.import("../src/lib/mhd-importer/content.ts");
  const perfil = { title: { key_data: [{ name: "Conexión", sources: ["mhd:Conexión"] }, { name: "Capacidad", sources: ["mhd:Capacidad"] }] } };
  const datos = (conexion, capacidad) => new Map([["mhd:conexión", conexion], ["mhd:capacidad", capacidad]]);
  assert.deepEqual(missingKeyData("Auriculares JBL Tune 520BT", perfil, datos("Cableada (USB Tipo C), cable de 2,1 m", "")), []);
  assert.deepEqual(missingKeyData("Auriculares JBL Tune 520BT", perfil, datos("Inalámbrica (Bluetooth Class 1)", "")), []);
  assert.deepEqual(missingKeyData("Auriculares JBL Tune 520BT", perfil, datos("5,2", "")), []);
  assert.equal(missingKeyData("Lavadora Bosch WAN24272ES", perfil, datos("", "9 kg")).length, 1);
  assert.deepEqual(missingKeyData("Lavadora Bosch WAN24272ES de 9 kg", perfil, datos("", "9 kg")), []);
});

test("redirecciones: ruta vieja y a qué apunta (2026-10-26)", async () => {
  const { originPath, keyFor, parseCsv } = await jiti.import("../src/lib/redirects/load.ts");
  assert.equal(originPath("https://www.electronicavicente.com/lavadoras/lavadora-bosch-1.html?x=1"), "/lavadoras/lavadora-bosch-1.html");
  assert.equal(originPath("/marca/aeg-2/"), "/marca/aeg-2");
  const ids = new Map([["lavadora-bosch-wan24272es", "gid://shopify/Product/1"]]);
  assert.deepEqual(keyFor("/lavadoras/lavadora-bosch-1.html", "/products/lavadora-bosch-wan24272es", "producto", ids).shopify_product_id, "gid://shopify/Product/1");
  assert.equal(keyFor("/lavadoras-12", "/collections/lavadoras", "categoría", ids).key_type, "coleccion");
  assert.equal(keyFor("/marca/aeg-2", "/collections/aeg", "marca", ids).key_value, "aeg");
  assert.deepEqual([keyFor("/combis/combi-balay-3kfd-13968.html", null, null, ids).key_type, keyFor("/combis/combi-balay-3kfd-13968.html", null, null, ids).key_value], ["producto_viejo", "13968"]);
  assert.equal(keyFor("/pulseras-de-actividad", null, null, ids).key_type, "categoria_vieja");
  assert.deepEqual(parseCsv('a,b\n"x, y",2\n'), [{ a: "x, y", b: "2" }]);
});

test("título: modelo con sufijo de país, nombre comercial corto y marca sin mayúsculas (masivo, 2026-10-26)", async () => {
  const { validateContent } = await jiti.import("../src/lib/mhd-importer/content.ts");
  const ficha = (title) => ({ title, meta_title: "x", short_description: "x", meta_description: "y".repeat(140), long_description_html: "<p>x</p><h2>x</h2>", elvi_tip: { text: "", sources: [] } });
  const fallos = (errors) => errors.filter((error) => error.startsWith("El título no lleva"));
  assert.deepEqual(fallos(validateContent(ficha("Portátil HP DG0N0ET de 16\""), "HP", "DG0N0ET#ABE", [], new Map())), []);
  assert.deepEqual(fallos(validateContent(ficha("Portátil HP EliteBook 8 G2i de 16\""), "HP", "DG0N0ET#ABE", [], new Map(), ["EliteBook 8 G2i 16 inch Notebook Next Gen AI PC", "DG0N0ET"])), []);
  assert.deepEqual(fallos(validateContent(ficha("Portátil ASUS Vivobook 15 X1504"), "Asus", "X1504", [], new Map())), []);
  assert.equal(fallos(validateContent(ficha("Portátil HP de 16\""), "HP", "DG0N0ET#ABE", [], new Map(), ["EliteBook 8 G2i 16 inch Notebook"])).length, 1);
});

test("Icecat: referencia interna de MHD que no sale en su título (masivo, 2026-10-27)", async () => {
  const { looksInternal } = await jiti.import("../src/lib/mhd-importer/identity.ts");
  assert.equal(looksInternal("TV9032318", { partCode: "MS-D1-01", modelName: "MS-D1-01" }), true);
  assert.equal(looksInternal("VC321239", { partCode: "WM-A-VESA200200-01", modelName: null }), true);
  assert.equal(looksInternal("DT80T-053", { partCode: "DT80F-305", modelName: null }), false);
  assert.equal(looksInternal(null, { partCode: "X", modelName: null }), false);
  // Modelo del fabricante en el título: no es interno aunque no se parezca al de Icecat.
  assert.equal(looksInternal("WAN24272ES", { partCode: "WGG244A0ES", modelName: null }, "Lavadora Bosch WAN24272ES 9 kg"), false);
  assert.equal(looksInternal("VC321239", { partCode: "WM-A-VESA200200-01", modelName: null }, "Soporte Gembird VC321239"), true);
});

test("descartes: sin fotos en MHD pero con galería en Icecat no se descarta (masivo, 2026-10-27)", () => {
  const base = { codigo: "1", codigo_ean: "1", nombre_marca: "X", nombre_subfamilia: null, pvp: 1, stock: 1, imagen: "", letra_eficiencia: null, img_ficha_eficiencia: null, descripcion_ampliada: "x".repeat(200), ref_proved: "A1", titulo: "", cod_subfamilia: "S01" };
  assert.equal(discardReason(base, null, null), "Sin imagen");
  assert.equal(discardReason(base, null, { gallery: [{ url: "https://icecat/a.jpg" }], specifications: {} }), null);
});

test("precio: solo se descarta con precio 0 o sin precio (David, 2026-10-27)", () => {
  const base = { codigo: "1", codigo_ean: "1", nombre_marca: "X", nombre_subfamilia: null, stock: 1, imagen: "https://x/a.jpg", letra_eficiencia: null, img_ficha_eficiencia: null, descripcion_ampliada: "x".repeat(200), ref_proved: "A1", titulo: "", cod_subfamilia: "S01" };
  assert.equal(discardReason({ ...base, pvp: 0 }, null, null), "Sin precio o con precio 0");
  assert.equal(discardReason({ ...base, pvp: null }, null, null), "Sin precio o con precio 0");
  assert.equal(discardReason({ ...base, pvp: 4 }, null, null), null);
});

test("marca oficial en el título: solo la primera aparición y sin tocar el modelo (2026-10-28)", async () => {
  const { withOfficialBrand } = await jiti.import("../src/lib/mhd-importer/shopify-draft.ts");
  assert.equal(withOfficialBrand("Placa base Asrock A520M-HDV AM4", "ASRock"), "Placa base ASRock A520M-HDV AM4");
  assert.equal(withOfficialBrand("Adaptador USB-C a RJ-45 Dell DELL-SA224-BK", "Dell"), "Adaptador USB-C a RJ-45 Dell DELL-SA224-BK");
  assert.equal(withOfficialBrand("Teléfono inalámbrico Fritz! 20003009", "FRITZ!"), "Teléfono inalámbrico FRITZ! 20003009");
  assert.equal(withOfficialBrand("Cable USB Nanocable 10.01", "NOX"), "Cable USB Nanocable 10.01");
  assert.equal(withOfficialBrand("Heladera Corbero CMICE12 1,3 L", "Corberó"), "Heladera Corberó CMICE12 1,3 L");
});

test("marcas que MHD pone mal siempre: por marca o por producto, haya Icecat o no (2026-10-29)", () => {
  assert.equal(resolveBrand({ nombre_marca: "EPOS SENNHEISER", titulo: "Auriculares ACCENTUM" }, null).brand, "Sennheiser");
  assert.equal(resolveBrand({ nombre_marca: "PLAY", titulo: "Carro We Go" }, null).vendor, "PLAYMARKET");
  assert.equal(resolveBrand({ codigo: "10039156", nombre_marca: "KAYAMI", titulo: "Ruby Bero 1" }, null).brand, "Ruby");
  assert.equal(resolveBrand({ codigo: "10142490", nombre_marca: "KAYAMI", titulo: "Humidificador HM140U" }, null).brand, "Kayami");
  assert.equal(fixBrandText("Carrito de la compra Play Go Up Olive 2 ruedas", "Play", "Playmarket"), "Carrito de la compra Playmarket Go Up Olive 2 ruedas");
  assert.equal(fixBrandText("Carrito Playmarket We Go", "Play", "Playmarket"), "Carrito Playmarket We Go");
  assert.equal(fixBrandText("Carrito Duet 24925D3 290", "Duet", "Duett"), "Carrito Duett 24925D3 290");
  assert.equal(fixBrandText("Termoventilador Kayami Ruby Bero 1 1500 W", "Kayami", "Ruby"), "Termoventilador Ruby Bero 1 1500 W");
  assert.equal(fixBrandText("Auriculares EPOS Sennheiser ACCENTUM", "Epos Sennheiser", "Sennheiser"), "Auriculares Sennheiser ACCENTUM");
  assert.equal(resolveBrand({ nombre_marca: "Atc", titulo: "Adaptador AC7022" }, { brand: "ACT" }).brand, "ACT");
  assert.equal(resolveBrand({ codigo: "10000906", nombre_marca: "Youin", titulo: "Soporte AC0591E" }, { brand: "Engel Axil" }).brand, "Engel");
  assert.equal(resolveBrand({ codigo: "10040953", nombre_marca: "Youin", titulo: "Inflador MA1018" }, null).brand, "Youin");
  assert.equal(fixBrandText("Soporte de pared Youin Engel AC0591E", "Youin", "Engel"), "Soporte de pared Engel AC0591E");
  assert.equal(fixBrandText("Cápsulas Nestle Dolce Gusto Ristretto Bonka", "Nestle", "Dolce Gusto"), "Cápsulas Dolce Gusto Ristretto Bonka");
});
