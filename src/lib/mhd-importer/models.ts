// Pieza del importador: el modelo limpio de un producto (decidido 2026-10-26; «Cambios de código que piden los datos»,
// n.º 3, en docs/IMPORTADOR_PERFILES_HALLAZGOS.md). El `ref_proved` de MHD es a menudo un código interno («HO0232210»,
// «VE10541245», «DSP0000018101»), un EAN, un texto roto («Z?MO® XT3»), lleva el color en inglés («BCS200BK BLACK»),
// referencias entre paréntesis («ADD12XB (3NDA0043)», «(2 uds)»), viene cortado a 25 caracteres («INSTAX SQUARE SQ1™
// GLACIE») o es una descripción que repite tipo y marca («TRUST VOLANTE GXT-289», «PROTECTOR APPLE IPH»).
// Regla: si el de MHD sirve, el de MHD limpio; si no y hay Icecat comprobado (identity.ts), el modelo de Icecat (o su
// código o nombre comercial); si no, a revisión con el mejor que haya. El SKU sigue siendo el `codigo` de MHD.
// Excepción (David, 2026-10-27, cola de revisión): un código interno del proveedor o la compatibilidad de un accesorio no
// van a revisión. Si la descripción de MHD nombra el modelo del fabricante (identity.ts, `findModelInText`), ese; si no,
// el producto va sin modelo: ni en el título ni en la dirección.
// Funciones puras, sin IA.
import type { IcecatSummary } from "./icecat";
import { normalizeModel } from "./identity";

export type ModelChoice = { model: string | null; source: "mhd" | "icecat" | "texto" | null; needsReview: boolean; reason: string; dropped?: "internal" | "compatibility" };
export type ModelListing = { ref_proved: string | null; titulo: string | null; nombre_marca: string | null; codigo_ean?: string | null; cod_subfamilia?: string | null };

const MHD_REF_MAX = 25; // MHD corta `ref_proved` a 25 caracteres
const words = (text: string) => text.split(/\s+/).filter(Boolean);
const plain = (text: string) => text.toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const hasDigit = (text: string) => /\d/.test(text);

// Colores al final del modelo (en inglés casi siempre; también los de MHD en español). Los matices («LIGHT», «MINT»…)
// solo se quitan delante de un color. «HERO BLACK» de GoPro es el nombre del modelo, no un color.
const COLORS = new Set(["BLACK", "WHITE", "RED", "BLUE", "GREEN", "GREY", "GRAY", "SILVER", "GOLD", "PINK", "PURPLE", "VIOLET", "YELLOW", "ORANGE", "BROWN", "BEIGE", "WOOD", "MADERA", "NEGRO", "NEGRA", "BLANCO", "BLANCA", "ROJO", "ROJA", "AZUL", "VERDE", "GRIS", "PLATA", "PLATEADO", "PLATEADA", "ROSA", "DORADO", "DORADA", "AMARILLO", "NARANJA", "MARRON", "MORADO", "LILA", "CREMA", "GRAFITO", "TITANIO", "ANTRACITA", "INOX"]);
const SHADES = new Set(["LIGHT", "DARK", "DEEP", "MINT", "SPACE", "SKY", "CANDY", "MATT", "MATTE", "GLOSSY", "PASTEL", "CLARO", "OSCURO", "MATE", "METALLIC", "JET"]);
const isColor = (word: string) => plain(word).split("/").every((part) => COLORS.has(part.replace(/[^A-Z]/g, "")));
function stripColors(text: string) {
  const list = words(text); const removed: string[] = [];
  while (list.length > 1 && isColor(list[list.length - 1]) && plain(list[list.length - 2]) !== "HERO") removed.unshift(list.pop()!);
  while (removed.length && list.length > 1 && SHADES.has(plain(list[list.length - 1]))) removed.unshift(list.pop()!);
  return { text: list.join(" "), removed: removed.join(" ") };
}

// Palabras de tipo de producto que MHD pone delante del modelo («PROTECTOR …», «SET …», «REAC. MV …»).
const TYPE_WORDS = new Set(["PROTECTOR", "FUNDA", "CARCASA", "CRISTAL", "LENTE", "CABLE", "SET", "PACK", "KIT", "DISPENSADOR", "DOSIFICADOR", "MOUSE", "RATON", "VOLANTE", "TECLADO", "TEC", "CORREA", "SOPORTE", "CARGADOR", "ADAPTADOR", "AURICULAR", "AURICULARES", "ALTAVOZ", "TELEFONO", "MANDO", "FILTRO", "TAPADERA", "TAPA", "BOLSA", "BOLSAS", "ESTUCHE", "MALETIN", "MOCHILA", "ACCESORIO", "ACCESORIOS", "REAC.", "REAC", "MV", "DE", "DEL"]);
const CONNECTORS = new Set(["DE", "DEL"]);
// Medidas al final que son datos, no modelo («SET DLSC500 500ML», «SIMPLY VS1010 6,5 BARES»). Los mm se quedan
// («GALAXY WATCH8 44MM»: el tamaño distingue el modelo).
const TRAILING_MEASURE = /\s+\d+(?:[.,]\d+)?\s*(?:ML|CL|L|LITROS|BAR|BARES|W|KG|G|CM|V)$/i;
// Marcas de otros aparatos: si aparecen, el «modelo» es la compatibilidad de un accesorio («PROTECTOR APPLE IPH»).
const DEVICE_WORDS: Record<string, string> = { APPLE: "APPLE", APPL: "APPLE", IPHONE: "APPLE", IPHON: "APPLE", IPH: "APPLE", IPAD: "APPLE", AIRPODS: "APPLE", MACBOOK: "APPLE", SAMSUNG: "SAMSUNG", GALAXY: "SAMSUNG", XIAOMI: "XIAOMI", REDMI: "XIAOMI", HUAWEI: "HUAWEI", OPPO: "OPPO", MOTOROLA: "MOTOROLA", MOTO: "MOTOROLA", PIXEL: "GOOGLE", HONOR: "HONOR", REALME: "REALME", ONEPLUS: "ONEPLUS", NOKIA: "NOKIA", PS5: "SONY", PS4: "SONY", PLAYSTATION: "SONY", XBOX: "MICROSOFT", NINTENDO: "NINTENDO", PARA: "" };
const foreignDevice = (text: string, brand: string) => words(plain(text)).some((word) => { const owner = DEVICE_WORDS[word.replace(/[^A-Z0-9]/g, "")]; return owner !== undefined && (!owner || !plain(brand).replace(/[^A-Z0-9]/g, "").includes(owner)); });

// Códigos que no son modelos: internos de MHD (dos letras y 6-9 cifras, «DSP…»), ASIN de Amazon, EAN o números largos.
export function isInternalCode(text: string, ean?: string | null) {
  const code = text.trim().toUpperCase();
  return /^[A-Z]{2}\d{6,9}$/.test(code) || /^DSP\d{6,}$/.test(code) || /^MGS\d{4,}$/.test(code) || (/^B0[0-9A-Z]{8}$/.test(code) && /[A-Z]/.test(code.slice(2)))
    || /^\d{12,14}$/.test(code) || Boolean(ean && normalizeModel(code) === normalizeModel(ean));
}

// Limpieza sin decidir nada: símbolos, paréntesis, color final, palabras de tipo, marca repetida y medidas al final.
// Devuelve el texto limpio y por qué no sirve (null si sirve).
export function cleanModelText(raw: string, brand: string, options: { title?: string | null; ean?: string | null; game?: boolean } = {}): { text: string; problem: string | null; notes: string[] } {
  const notes: string[] = [];
  let text = raw.trim();
  if (isInternalCode(text, options.ean)) return { text, problem: /^\d+$/.test(text) ? "es un EAN o un número largo" : "es un código interno del proveedor", notes };
  const broken = /[?�]/.test(text);
  text = text.replace(/[®™©]/g, "").replace(/[?�]/g, "");
  if (options.game) return { text: text.replace(/\s+/g, " ").trim(), problem: null, notes: ["nombre del juego"] };
  // Cortado a 25 caracteres: se completa con el título si lo trae entero; si no, se quita la última palabra si es solo
  // letras (trozo de color o de nombre: «GLACIE», «CLA»), salvo que sea un color entero.
  if (raw.trim().length >= MHD_REF_MAX) {
    const at = options.title ? plain(options.title).indexOf(plain(raw.trim())) : -1;
    const rest = at >= 0 ? options.title!.slice(at + raw.trim().length).match(/^[\p{L}\d-]+/u)?.[0] : undefined;
    if (rest) { text += rest; notes.push("completado con el título"); }
    else { const list = words(text); const last = list[list.length - 1] ?? ""; if (list.length > 1 && /^[\p{L}-]+$/u.test(last) && !isColor(last)) { list.pop(); text = list.join(" "); notes.push(`cortado en MHD: sin «${last}»`); } }
  }
  // Paréntesis (cerrados o cortados): referencias de otro código o unidades («(3NDA0043)», «(2 uds)», «(ÚLTIMA»).
  if (/\(/.test(text)) { text = text.replace(/\s*\([^)]*\)?/g, " "); notes.push("sin paréntesis"); }
  text = text.replace(/[*]+/g, " ").replace(/\s+/g, " ").replace(/[\s/+-]+$/, "").trim();
  // Compatibilidad tras « / » («MONARCH PRO / APPLE IPHON»): se queda lo de delante.
  const slash = text.split(/\s+\/\s+/);
  const slashCompat = slash.length > 1 && foreignDevice(slash.slice(1).join(" "), brand);
  if (slashCompat) { text = slash[0]; notes.push("sin la compatibilidad"); }
  // El corte a 25 caracteres puede haberse llevado ya la compatibilidad («PROTECTOR DE LENTE / APPL»).
  const rawSlash = raw.trim().split(/\s+\/\s+/); const cutCompat = slashCompat || (rawSlash.length > 1 && foreignDevice(rawSlash.slice(1).join(" "), brand));
  // Palabras de tipo y marca al principio («TRUST VOLANTE GXT-289» → «GXT-289»; «PACK 6 MXPRO PURE» → «MXPRO PURE»).
  const brandWords = words(plain(brand).replace(/[^A-Z0-9 ]/g, " "));
  let list = words(text); let typed = false; let connector = false;
  for (;;) {
    const head = plain(list[0] ?? "").replace(/[^A-Z0-9.]/g, "");
    if (list.length > 1 && brandWords.length && brandWords.every((word, index) => plain(list[index] ?? "").replace(/[^A-Z0-9]/g, "") === word) && list.length > brandWords.length) { list = list.slice(brandWords.length); continue; }
    if (list.length > 1 && TYPE_WORDS.has(head)) { list = list.slice(1); typed = true; connector ||= CONNECTORS.has(head); if ((head === "PACK" || head === "SET") && /^\d+$/.test(list[0] ?? "") && list.length > 1) list = list.slice(1); continue; }
    break;
  }
  if (list.join(" ") !== text) notes.push("sin tipo ni marca delante");
  text = list.join(" ");
  // «FILTRO P1000 PACK 1» → «P1000».
  text = text.replace(/\s+PACK\s+\d+$/i, "");
  const colors = stripColors(text);
  if (colors.removed) { text = colors.text; notes.push(`sin el color «${colors.removed}»`); }
  while (TRAILING_MEASURE.test(text) && hasDigit(text.replace(TRAILING_MEASURE, ""))) { text = text.replace(TRAILING_MEASURE, ""); notes.push("sin medidas al final"); }
  if (broken) return { text, problem: "tiene caracteres rotos («?»)", notes };
  if (!text || !/[\p{L}\d]{2,}/u.test(text)) return { text, problem: "no queda modelo tras limpiarlo", notes };
  if (foreignDevice(text, brand)) return { text, problem: "es la compatibilidad de un accesorio, no un modelo", notes };
  // «DISPENSADOR DE JABON» es una descripción; «MOUSE CARVE» (Trust Carve), un nombre comercial.
  // Con la compatibilidad detrás («PROTECTOR DE LENTE / APPL»), es un accesorio sin modelo propio.
  if (typed && connector && !hasDigit(text)) return { text, problem: cutCompat ? "es la compatibilidad de un accesorio, no un modelo" : "es una descripción («tipo de producto»), no un modelo", notes };
  if (/^\d+(?:[.,]\d+)?\s*(?:CM|MM|ML|CL|L|W|KG|G|V|GB|TB|M|BAR|BARES|UDS?)$/i.test(text)) return { text, problem: "es solo una medida", notes };
  return { text, problem: null, notes };
}

// Modelo de Icecat: el nombre del modelo si parece un modelo (cifras y letras, hasta 3 palabras: «TR-51W», «zūmo XT3»);
// si no, el código del fabricante si no es interno ni numérico («HDTP310EK3AA»); si no, el nombre comercial corto.
function icecatModel(icecat: IcecatSummary, brand: string) {
  const clean = (value: string | null) => {
    if (!value?.trim() || /^-/.test(value.trim())) return null;
    const result = cleanModelText(value, `${icecat.brand ?? ""}`.trim() || brand);
    if (result.problem && !result.problem.startsWith("es una descripción")) return null;
    if (/^\d{9,}$/.test(result.text.replace(/\s/g, ""))) return null; // códigos numéricos de Denver («111101000680»)
    return result.text;
  };
  const name = clean(icecat.modelName); const code = clean(icecat.partCode);
  const modelLike = (text: string | null) => Boolean(text && /\d/.test(text) && /\p{L}/u.test(text) && words(text).length <= 3 && text.length <= MHD_REF_MAX);
  if (modelLike(name)) return { text: name!, from: "modelo" };
  if (code) return { text: code, from: "código" };
  if (name && words(name).length <= 4) return { text: name, from: "nombre comercial" };
  return null;
}

export function resolveModel(listing: ModelListing, icecat: IcecatSummary | null, fromText: string | null = null): ModelChoice {
  const raw = (listing.ref_proved ?? "").trim(); const brand = listing.nombre_marca ?? "";
  const game = listing.cod_subfamilia === "50150" || /^videojuego/i.test(listing.titulo ?? "");
  const mhd = raw ? cleanModelText(raw, brand, { title: listing.titulo, ean: listing.codigo_ean, game }) : { text: "", problem: "está vacío", notes: [] as string[] };
  // Un código que parece interno pero es el de Icecat comprobado («HX404241» = «HX4042/41»): vale, con la grafía de Icecat.
  const fromIcecat = icecat ? icecatModel(icecat, brand) : null;
  if (mhd.problem && fromIcecat && raw && [icecat?.partCode, icecat?.modelName].some((value) => value && normalizeModel(value) === normalizeModel(raw)))
    return { model: fromIcecat.text, source: "icecat", needsReview: false, reason: "El código de MHD es el de Icecat: se escribe como Icecat." };
  if (!mhd.problem) return { model: mhd.text, source: "mhd", needsReview: false, reason: mhd.notes.length ? `Modelo de MHD limpio (${mhd.notes.join(", ")}).` : "Modelo de MHD tal cual." };
  if (fromIcecat) return { model: fromIcecat.text, source: "icecat", needsReview: false, reason: `El modelo de MHD «${raw}» ${mhd.problem}: se usa el ${fromIcecat.from} de Icecat.` };
  const dropped = mhd.problem === "es un código interno del proveedor" ? "internal" as const : mhd.problem === "es la compatibilidad de un accesorio, no un modelo" ? "compatibility" as const : null;
  if (dropped) {
    const found = fromText ? cleanModelText(fromText, brand, { ean: listing.codigo_ean }) : null;
    if (found && !found.problem && /\d/.test(found.text)) return { model: found.text, source: "texto", needsReview: false, reason: `El modelo de MHD «${raw}» ${mhd.problem}: se usa «${found.text}», que nombra la descripción de MHD.`, dropped };
    return { model: null, source: null, needsReview: false, reason: `El modelo de MHD «${raw}» ${mhd.problem}: el producto va sin modelo (ni en el título ni en la dirección).`, dropped };
  }
  // A revisión: el de MHD casi tal cual (sin símbolos), para que la dirección y la referencia no queden vacías.
  return { model: raw.replace(/[®™©?\uFFFD]/g, "").replace(/\s+/g, " ").trim() || null, source: raw ? "mhd" : null, needsReview: true, reason: `El modelo de MHD «${raw}» ${mhd.problem} y no hay Icecat comprobado: hay que revisarlo.` };
}
