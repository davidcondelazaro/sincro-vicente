// Pieza del importador: la tabla de marcas (decidida 2026-10-26; «Cambios de código que piden los datos», n.º 13, y
// regla de David del 2026-10-23: siglas en mayúsculas, el resto como la marca en texto corrido, con el «Brand» de
// Icecat de referencia). Icecat escribe a veces en mayúsculas lo que no son siglas («CATA», «JATA», «NOX»), con el nombre
// de la empresa («Sony Interactive Entertainment», «Kingston Technology») o con la marca del licenciatario o del
// distribuidor («PNY» en memorias HP, «Origin Storage» en Honeywell). MHD, a su vez, pone a veces la marca de otra
// empresa del grupo o una equivocada (Dayma como «Brother» o «HP», Yashica como «UAG» o «Sangean»).
// El proveedor (`vendor`) de Shopify sigue en mayúsculas (de él cuelgan las colecciones de marca actuales): es la marca
// de MHD salvo que esta tabla la corrija por otra empresa. Funciones puras, sin IA.
import type { IcecatSummary } from "./icecat";

export type BrandChoice = { brand: string; vendor: string; needsReview: boolean; reason: string | null; replaces?: string };
export type BrandListing = { codigo?: string | null; nombre_marca: string | null; titulo?: string | null; ref_proved?: string | null };

export const brandKey = (name: string | null | undefined) => (name ?? "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Z0-9]/g, "");

// Grafía de las marcas que no sale de la regla general, y nombres de empresa que equivalen a la marca. Clave: brandKey.
const WRITTEN: Record<string, string> = {
  SONYINTERACTIVEENTERTAINMENT: "Sony", DELONGHI: "De'Longhi", DELONGHIDELONGHI: "De'Longhi", IROBOT: "iRobot", ROOMBA: "iRobot",
  TPLINK: "TP-Link", RASPBERRY: "Raspberry Pi", RASPBERRYPI: "Raspberry Pi", STARTECH: "StarTech.com", STARTECHCOM: "StarTech.com",
  URBANARMORGEAR: "UAG", TENDACOLTD: "Tenda", FONESTARSISTEM: "Fonestar", PHILIPSBYSIGNIFY: "Philips", SOLERPALAU: "S&P", SP: "S&P",
  KINGSTONTECHNOLOGY: "Kingston", DCUADVANCETECNOLOGIC: "DCU", UNYKA: "Unykach", UNYKACH: "Unykach", SMARTGYRO: "smartGyro",
  WESTERNDIGITALWD: "Western Digital", IPCOM: "IP-COM", DAHUATECHNOLOGY: "Dahua", PHOENIXTECHNOLOGIES: "Phoenix", FMCALEFACCION: "FM",
  NOX: "Nox", CATA: "Cata", JATA: "Jata", BEQUIET: "be quiet!", OK: "OK.",
};
// Siglas o marcas que se escriben en mayúsculas aunque tengan vocales y más de tres letras.
const UPPER = new Set(["QNAP", "ADATA", "IMAX"]);
// Palabras de tres letras o menos que no son siglas.
const NOT_ACRONYMS = new Set(["NOX", "BOX", "SUN", "SOL", "MIO"]);

// Licencias y distribuidores: con estas marcas en Icecat manda la de MHD sin revisión («*» = con cualquier marca de MHD).
const LICENSES: Record<string, string[] | "*"> = {
  PNY: ["HP"], ORIGINSTORAGE: "*", OMADA: ["TPLINK"], NOX: ["KROM"], ENGELAXIL: ["YOUIN", "ENGEL"], SUPERIORELECTRONICS: ["YOUIN"],
  SILVERELECTRONICS: ["SILVERSANZ"], POSIFLEX: ["10POS"], ARDISTEL: "*",
  // Misma casa o submarca (cola de revisión, David, 2026-10-27): la de MHD está bien.
  KEEPOUT: ["APPROX"], ALIENWARE: ["DELL"], BEATSBYDRDRE: ["APPLE"], BEATS: ["APPLE"], CABLEXPERT: ["GEMBIRD"], XPG: ["ADATA"],
  MONIX: ["BRA"], NESCAFE: ["DOLCEGUSTO", "NESTLE"], NESTLE: ["DOLCEGUSTO", "NESCAFE"], ACT: ["ATC"], HYPER: ["TARGUS"],
  TARGUS: ["HYPER"], TPLINK: ["MERCUSYS"], FRANKE: ["MEPAMSA"], ELECTROLUX: ["ZANUSSI", "AEG"], ORALB: ["BRAUN"], SHARK: ["NINJA"],
  GIGABYTE: ["AORUS"], ASTROGAMING: ["LOGITECH"], KASASMART: ["TPLINK"], GAMERSTORM: ["DEEPCOOL"], LACIE: ["SEAGATE"],
  DEEPGAMING: ["COOLBOX"], MARSGAMING: ["TACENS"], GEORGEFOREMAN: ["RUSSELLHOBBS"], SMARTWARES: ["TRISTAR"], BELLISSIMA: ["IMETEC"],
  LOR: ["PHILIPS"],
};
// Marca equivocada en MHD (cola de revisión, David, 2026-10-27): con Icecat comprobado y una de estas marcas, manda la de
// Icecat («Philips» en planchas Remington, «Apple» en memorias Emtec, «Canon» en tintas HP). Clave: marca de MHD.
const MHD_MISTAKES: Record<string, string[] | "*"> = {
  PHILIPS: ["REMINGTON"], JBL: ["REMINGTON"], JC: ["REMINGTON"], APPLE: ["EMTEC", "FRITZ"], CANON: ["HP"], GIGABYTE: ["ASUS"],
  TRUST: ["BELKIN"], EPOSSENNHEISER: ["TUCANO"], PNY: ["HP"], OEM: "*",
};
// Marcas de impresora con las que MHD da de alta los cartuchos compatibles de Dayma (modelo «M-…»).
const PRINTER_BRANDS = new Set(["BROTHER", "HP", "EPSON", "CANON", "SAMSUNG", "LEXMARK", "KYOCERA", "XEROX", "RICOH", "OKI", "DAYMA"]);

// Siglas en mayúsculas (AEG, LG, HP, JBL, NZXT); el resto como en texto corrido (CATA → Cata, HYUNDAI → Hyundai); lo que
// ya viene con minúsculas se respeta (iRobot, smartGyro, Oral-B).
export function writtenBrand(name: string) {
  const trimmed = name.trim().replace(/\s+/g, " ");
  const key = brandKey(trimmed);
  if (WRITTEN[key]) return WRITTEN[key];
  if (UPPER.has(key)) return key;
  if ((/\p{Ll}/u.test(trimmed) && /\p{Lu}/u.test(trimmed.slice(1))) || /^\p{Ll}/u.test(trimmed)) return trimmed; // grafía propia
  return trimmed.split(" ").map((word) => word.split("-").map((part) => {
    const letters = part.replace(/[^\p{L}]/gu, "");
    if (!letters) return part;
    const upper = part.toUpperCase();
    if (/\d/.test(part) || (letters.length <= 3 && !NOT_ACRONYMS.has(letters.toUpperCase())) || !/[AEIOUÁÉÍÓÚY]/i.test(letters)) return upper;
    return upper.charAt(0) + upper.slice(1).toLowerCase();
  }).join("-")).join(" ");
}

const titleKey = (text: string | null | undefined) => ` ${(text ?? "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Z0-9]+/g, " ").trim()} `;
const inTitle = (brand: string, title: string | null | undefined) => { const words = titleKey(brand).trim(); return Boolean(words) && titleKey(title).includes(` ${words} `); };

// Marcas que MHD pone mal y que se corrigen siempre, haya Icecat o no (sesión de logos de marca, aprobado por David el
// 2026-10-29, comprobado por EAN y web del fabricante): toda la marca de MHD…
const MHD_BRAND_FIXES: Record<string, string> = { EPOSSENNHEISER: "Sennheiser", PLAY: "Playmarket", DUET: "Duett", MADCOWENTERTAINMENT: "Teknofun" };
// …o productos sueltos, por su código de MHD (el resto de su marca está bien).
const PRODUCT_BRAND_FIXES: Record<string, string> = { "10039156": "Ruby", "10039823": "Ruby", "10022318": "Ruby", "10013300": "Hyper", "10141269": "Medisana" };

// La IA copia en el título la marca que trae MHD («Play Go Up», «Kayami Ruby Bero 1»): se cambia por la buena y se
// quita la repetición que queda («Ruby Ruby»).
export function fixBrandText(text: string, wrong: string, brand: string) {
  const words = wrong.trim().split(/\s+/).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  const fixed = text.replace(new RegExp(`(^|[^\\p{L}\\p{N}])${words}(?=$|[^\\p{L}\\p{N}])`, "giu"), (_match, before: string) => before + brand);
  const twice = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return fixed.replace(new RegExp(`(^|[^\\p{L}\\p{N}])${twice}\\s+${twice}(?=$|[^\\p{L}\\p{N}])`, "giu"), (_match, before: string) => before + brand);
}

export function resolveBrand(listing: BrandListing, icecat: IcecatSummary | null): BrandChoice {
  const mhd = (listing.nombre_marca ?? "").trim(); const mhdKey = brandKey(mhd);
  const fixed = PRODUCT_BRAND_FIXES[listing.codigo ?? ""] ?? MHD_BRAND_FIXES[mhdKey];
  if (fixed) return { brand: fixed, vendor: fixed.toUpperCase(), needsReview: false, replaces: mhd, reason: `MHD pone «${mhd}», pero la marca es «${fixed}» (corrección comprobada por EAN y web del fabricante): va en el informe para MHD.` };
  const vendor = mhd.toUpperCase(); const ref = (listing.ref_proved ?? "").trim().toUpperCase();
  // Marcas que MHD pone mal y se reconocen por el modelo o el título.
  if (mhdKey !== "DAYMA" && (/\bDAYMA\b/i.test(listing.titulo ?? "") || (ref.startsWith("M-") && PRINTER_BRANDS.has(mhdKey))))
    return { brand: "Dayma", vendor: "DAYMA", needsReview: false, reason: `MHD pone «${mhd}» en un consumible compatible de Dayma.` };
  if (mhdKey !== "YASHICA" && ref.startsWith("YAS-")) return { brand: "Yashica", vendor: "YASHICA", needsReview: false, reason: `MHD pone «${mhd}» en un modelo de Yashica (YAS-).` };
  const fromMhd = writtenBrand(mhd);
  if (!icecat?.brand?.trim()) return { brand: fromMhd, vendor, needsReview: false, reason: null };
  const fromIcecat = writtenBrand(icecat.brand); const icecatKey = brandKey(icecat.brand);
  const a = brandKey(fromMhd); const b = brandKey(fromIcecat);
  // La misma marca (o una contiene a la otra: «Kingston» / «Kingston Technology»): la grafía de Icecat o la más corta.
  if (a === b) return { brand: fromIcecat, vendor, needsReview: false, reason: null };
  if (a && b && (a.includes(b) || b.includes(a))) return { brand: a.length <= b.length ? fromMhd : fromIcecat, vendor, needsReview: false, reason: null };
  const license = LICENSES[icecatKey];
  if (license === "*" || license?.includes(mhdKey)) return { brand: fromMhd, vendor, needsReview: false, reason: `Icecat pone «${icecat.brand}» (licencia o distribuidor): manda la marca de MHD.` };
  const mistake = MHD_MISTAKES[mhdKey];
  if (mistake === "*" || mistake?.includes(icecatKey)) return { brand: fromIcecat, vendor: fromIcecat.toUpperCase(), needsReview: false, reason: `MHD pone «${mhd}», pero es de «${fromIcecat}» según Icecat: va en el informe para MHD.` };
  // MHD con una marca equivocada y la de Icecat en el título («Marshall» en un Savio): la de Icecat.
  if (inTitle(icecat.brand, listing.titulo) || inTitle(fromIcecat, listing.titulo)) return { brand: fromIcecat, vendor: fromIcecat.toUpperCase(), needsReview: false, reason: `MHD pone «${mhd}», pero el título y Icecat dicen «${fromIcecat}».` };
  return { brand: fromMhd, vendor, needsReview: true, reason: `La marca de Icecat («${icecat.brand}») no aparece en la marca ni en el título de MHD («${mhd}»): se deja la de MHD.` };
}
