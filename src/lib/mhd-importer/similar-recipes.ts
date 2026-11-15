// Similares por familia (David, 2026-11-15; docs/SINCRONIZACIONES_MHD.md). Funciones puras: reciben los productos de
// mhd_similar_source y devuelven, por producto, hasta 10 relacionados de su misma familia, lo más parecidos posible.
//
// Una regla común y, por familia, dos cosas: el «grupo» que no puede cambiar nunca (en lavadoras, carga e instalación)
// y el «dato principal» que tiene que parecerse (en lavadoras, los kilos). Después: precio parecido, como mucho 2 de la
// misma marca y solo lo que tiene stock. Si salen menos de 6, se amplía el margen por escalones.

export type SimilarProduct = { pid: string; t: string; title: string; pvp: number; stock: number; marca: string | null; f: Record<string, unknown> | null };

type Rule = {
  live: boolean; // false: solo se calcula para revisarlo (muestra), no se escribe en la tienda
  group: (p: SimilarProduct) => string;
  main: (p: SimilarProduct) => number | null;
  mainWeight: number; // puntos por unidad de diferencia del dato principal
  steps: [mainTol: number, priceTol: number][];
  extra?: (a: SimilarProduct, b: SimilarProduct) => number;
  // Tope por marca según el grupo, cuando un grupo es de una sola marca (Mac). Por defecto SIMILAR.perBrand.
  perBrand?: (group: string) => number;
  // true: el relleno de listas cortas no sale del grupo (cápsulas de un sistema no valen en otro).
  strict?: boolean;
  // Condición obligatoria entre el producto y cada candidato (un cartucho solo con los de su misma serie).
  match?: (a: SimilarProduct, b: SimilarProduct) => boolean;
};

// minFallback, otherGroup y fallbackPrice: el relleno de las listas cortas (ver computeSimilars).
export const SIMILAR = { maxList: 10, minList: 6, perBrand: 2, priceWeight: 80, minFallback: 3, otherGroup: 60, fallbackPrice: 1 };

const text = (p: SimilarProduct, key: string) => {
  const value = p.f?.[key];
  return Array.isArray(value) ? value.join(" | ") : typeof value === "string" ? value : "";
};
const number = (value: string) => {
  const match = value.match(/(\d+(?:[.,]\d+)?)/);
  return match ? Number(match[1].replace(",", ".")) : null;
};
const ENERGY = ["A+++", "A++", "A+", "A", "B", "C", "D", "E", "F", "G"];
const energyClass = (p: SimilarProduct) => {
  const index = ENERGY.indexOf(text(p, "features.eficiencia_energ_tica").replace(/nueva/i, "").trim());
  return index < 0 ? null : index;
};
// Cifra del título delante de una unidad («375 L», «186 cm», «14 servicios»).
const fromTitle = (p: SimilarProduct, unit: string) => {
  // Detrás de la unidad no puede ir una letra ni una cifra («375 L» sí, «375 LED» no); vale para «"» y «m³/h».
  const match = p.title.match(new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*${unit.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}(?![\\p{L}\\d])`, "iu"));
  return match ? Number(match[1].replace(",", ".")) : null;
};
const integrable = (p: SimilarProduct) => text(p, "filtro.color") === "Integrable" || /integrable/i.test(p.title);
// Posición de un rango de filtro en su escala («De 55 cm a 60 cm» → 1), para penalizar saltos de hueco.
const bucket = (p: SimilarProduct, key: string, scale: RegExp[]) => {
  const value = text(p, key);
  const index = scale.findIndex((re) => re.test(value));
  return index < 0 ? null : index;
};
// Escala de panel de televisores, de menos a más gama.
const panel = (p: SimilarProduct) => {
  const index = ["LED", "QLED", "Mini LED", "OLED"].indexOf(text(p, "filtro.tecnologia"));
  return index < 0 ? null : index;
};
// Gama de procesador de portátiles (de «Procesador …» en `filtro.mas_especificaciones`): 0 básico, 1 gama 3, 2 gama 5
// (también Snapdragon y Apple M), 3 gama 7 y 4 gama 9.
const cpuTier = (p: SimilarProduct) => {
  const cpu = text(p, "filtro.mas_especificaciones").match(/Procesador ([^|]+)/)?.[1]?.trim() ?? "";
  if (!cpu) return null;
  if (/celeron|intel n$|mediatek|pentium|athlon/i.test(cpu)) return 0;
  if (/snapdragon|apple/i.test(cpu)) return 2;
  const digit = cpu.match(/(\d)$/)?.[1];
  return digit ? ({ "3": 1, "5": 2, "7": 3, "9": 4 } as Record<string, number>)[digit] ?? null : null;
};
const has = (p: SimilarProduct, key: string, value: RegExp) => value.test(text(p, key));
const mismatch = (a: SimilarProduct, b: SimilarProduct, key: string, value: RegExp, weight: number) => (has(a, key, value) === has(b, key, value) ? 0 : weight);
// Diferencia en «duplicaciones» (8 frente a 16 GB = 1), para memorias, discos y hercios.
const log2diff = (a: number | null, b: number | null, weight: number) => (a === null || b === null || a <= 0 || b <= 0 ? 0 : Math.abs(Math.log2(a / b)) * weight);
const gb = (p: SimilarProduct, key: string) => {
  const value = text(p, key);
  if (/más de 1 tb/i.test(value)) return 2048;
  const n = number(value);
  return n === null ? null : /tb/i.test(value) ? n * 1024 : n;
};
const hz = (p: SimilarProduct) => number(text(p, "filtro.caracteristicas").match(/Pantalla (\d+) Hz/i)?.[1] ?? "") ?? 60;
const RESOLUTION = ["HD", "Full HD", "QHD", "4K"];
const resolution = (p: SimilarProduct) => {
  const index = RESOLUTION.indexOf(text(p, "filtro.resolucion"));
  return index < 0 ? null : index;
};
const WEIGHT_LAPTOP = [/hasta 1,3/i, /de 1,3/i, /más de 1,8/i];
const inches = (p: SimilarProduct) => number(text(p, "filtro.tamano_pantalla")) ?? fromTitle(p, '"');
// Sobremesa: el tipo del filtro falta en uno de cada cinco y algún Mac mini dice «Portátil»: manda el título.
const desktopType = (p: SimilarProduct) => {
  const title = p.title;
  if (/tableta|raspberry/i.test(title)) return "otro";
  // Los barebone (sin procesador, memoria o disco, según el modelo) solo con barebone; los que traen pantalla, aparte.
  if (/barebone/i.test(title)) return inches(p) !== null || /todo en uno|aio/i.test(title) ? "barebone/aio" : "barebone";
  if (/mac mini|mini ?pc|barebone|\bnuc\b/i.test(title)) return "mini";
  if (/todo en uno|\bimac\b/i.test(title)) return "aio";
  const tipo = text(p, "filtro.tipo");
  if (tipo === "Todo en uno") return "aio";
  if (tipo === "Mini PC") return "mini";
  return "torre";
};
// Gama del procesador; si el filtro no lo trae, del título («Core i5-14400», «Ultra 7 265», «Ryzen 7 9700X»).
const desktopCpu = (p: SimilarProduct) => {
  const fromFilter = cpuTier(p);
  if (fromFilter !== null) return fromFilter;
  if (/celeron|broadcom|intel n\d/i.test(p.title)) return 0;
  if (/xeon/i.test(p.title)) return 4;
  if (/apple m\d|\bm\d\b/i.test(p.title)) return 2;
  // También «i5-12400», «U5-225» y «R7-7445HS».
  const digit = p.title.match(/(?:\bcore i|\bi|\bultra |\bcore |\bryzen (?:ai )?|\bu|\br)(\d)(?=[- ]|\d{3}|$)/i)?.[1];
  return digit ? ({ "3": 1, "5": 2, "7": 3, "9": 4 } as Record<string, number>)[digit] ?? null : null;
};
// Frío: No Frost o cíclico, alto por tramos del filtro (bajo encimera, menos de 85 cm, aparte) y litros del título.
const noFrost = (p: SimilarProduct) => /no.?frost/i.test(`${text(p, "filtro.tecnologia")} ${p.title}`);
const HEIGHT = [/menos de 85/i, /de 85/i, /de 140/i, /de 150/i, /de 170/i, /de 185/i, /más de 199|de 200/i];
const low = (p: SimilarProduct) => /menos de 85/i.test(text(p, "filtro.alto"));
const litres = (p: SimilarProduct) => fromTitle(p, "L") ?? number(text(p, "filtro.capacidad"));
const coldExtra = (a: SimilarProduct, b: SimilarProduct) =>
  (noFrost(a) === noFrost(b) ? 0 : 15) + diff(bucket(a, "filtro.alto", HEIGHT), bucket(b, "filtro.alto", HEIGHT), 8) + diff(energyClass(a), energyClass(b), 3);
// Placas: ancho del filtro («60 cm») y número de zonas o fuegos.
const zones = (p: SimilarProduct) => number(text(p, "filtro.zonas_fuegos"));
const hobGroup = (p: SimilarProduct) => (has(p, "filtro.caracteristicas", /portátil/i) || /portátil/i.test(p.title) ? "portatil" : "encastrable");
const microExtra = (a: SimilarProduct, b: SimilarProduct) =>
  mismatch(a, b, "filtro.caracteristicas", /grill/i, 10) + diff(number(text(a, "filtro.potencia")), number(text(b, "filtro.potencia")), 0.03);
// Impresoras: tecnología (del filtro o del título), multifunción o no, A3 aparte y plóteres aparte.
const printerTech = (p: SimilarProduct) => {
  const tech = text(p, "filtro.tecnologia");
  if (tech) return tech;
  if (/l[aá]ser/i.test(p.title)) return "Láser";
  if (/t[eé]rmica|etiquetas|tickets/i.test(p.title)) return "Térmica";
  return "Inyección de tinta";
};
const multifunction = (p: SimilarProduct) => has(p, "filtro.caracteristicas", /multifunción/i) || /multifunci[oó]n/i.test(p.title);
const PPM = [/hasta 20 ppm/i, /de 21 ppm/i, /más de 30 ppm/i];
// Auriculares: diadema o intrauditivos (del filtro o del título), con o sin cable, y los gaming aparte.
const headphoneType = (p: SimilarProduct) => {
  // Algunos «buds» vienen como diadema en el filtro: el true wireless siempre es intrauditivo.
  if (has(p, "filtro.caracteristicas", /true wireless/i) || /\bbuds\b|true wireless|\btws\b/i.test(p.title)) return "in-ear";
  const tipo = text(p, "filtro.tipo");
  if (tipo) return tipo === "Diadema" ? "diadema" : "in-ear";
  return /diadema|over.?ear|on.?ear/i.test(p.title) ? "diadema" : "in-ear";
};
const wireless = (p: SimilarProduct) => has(p, "filtro.conectividad", /bluetooth/i) || has(p, "filtro.caracteristicas", /true wireless/i) || /bluetooth|inal[aá]mbric|wireless|true wireless/i.test(p.title);
const AUTONOMY = [/menos de 6/i, /de 6 a 10/i, /de 11 a 20/i, /de 21 a 40/i, /más de 40/i];
// Cafeteras: el sistema decide (las cápsulas de una marca no valen en otra).
const coffeeKind = (p: SimilarProduct) => {
  const all = `${text(p, "filtro.tipo")} ${text(p, "filtro.caracteristicas")} ${p.title}`;
  if (/dolce gusto/i.test(all)) return "dolce-gusto";
  if (/nespresso/i.test(all)) return "nespresso";
  if (/tassimo/i.test(all)) return "tassimo";
  if (/senseo|monodosis/i.test(all)) return "monodosis";
  if (/c[aá]psula/i.test(all)) return "capsulas";
  if (/superautom/i.test(all)) return "superautomatica";
  if (/italiana|moka/i.test(all) || /inducción|gas/i.test(text(p, "filtro.tipo"))) return "italiana";
  if (/espresso|expreso|\bbar\b/i.test(all) || /presión/i.test(text(p, "filtro.mas_especificaciones"))) return "espresso";
  if (/goteo|filtro|americana/i.test(all)) return "goteo";
  return "otra";
};
// Capacidades en GB (discos) y vatios o VA del título: se comparan en «duplicaciones».
const log2 = (n: number | null) => (n === null || n <= 0 ? null : Math.log2(n));
const diskGb = (p: SimilarProduct) => gb(p, "filtro.capacidad") ?? (fromTitle(p, "TB") !== null ? fromTitle(p, "TB")! * 1024 : fromTitle(p, "GB"));
const watts = (p: SimilarProduct) => number(text(p, "filtro.potencia")) ?? fromTitle(p, "W");
const vapour = [/hasta 29/i, /de 30 a 44/i, /45 g\/min o más/i];
const WIDTH_COMBI =[/menos de 55/i, /de 55/i, /de 61/i, /de 71/i, /de 91/i];
const diff = (a: number | null, b: number | null, weight: number) => (a === null || b === null ? 0 : Math.abs(a - b) * weight);
// Kilos de secado de las lavasecadoras: el segundo del título («9 kg / 6 kg»).
const dryKg = (p: SimilarProduct) => {
  const match = p.title.match(/\/\s*(\d+(?:[.,]\d+)?)\s*kg/i);
  return match ? Number(match[1].replace(",", ".")) : number(text(p, "filtro.capacidad_secado"));
};
const pyrolytic = (p: SimilarProduct) => /pir[oó]l[ií]/i.test(`${text(p, "filtro.limpieza")} ${p.title}`);
// Gas de una cocina: butano o natural (del título o del filtro); null si no consta.
const gasKind = (p: SimilarProduct) => {
  const value = `${p.title} ${text(p, "filtro.tipo")}`;
  return /gas natural/i.test(value) ? "natural" : /butano/i.test(value) ? "butano" : null;
};
// Grupo por la primera expresión del título que encaje; si ninguna, `otherwise`.
const byTitle = (kinds: [RegExp, string][], otherwise: string) => (p: SimilarProduct) => kinds.find(([re]) => re.test(p.title))?.[1] ?? otherwise;
// Familias sin dato principal: manda el precio (±25 %, luego ±40 % y ±60 %).
const byPrice = { main: () => 0, mainWeight: 0, steps: [[0, 0.25], [0, 0.4], [0, 0.6]] as [number, number][] };
const MINUTES = [/menos de 20/i, /20-40/i, /45-60/i, /61-89/i, /90-100/i, /más de 100/i];
const GRILL_WIDTH = [/hasta 29/i, /de 30 a 40/i, /de 41 a 50/i, /más de 50/i];
// Penaliza que un filtro de valor único sea distinto (solo si los dos lo tienen).
const same = (a: SimilarProduct, b: SimilarProduct, key: string, weight: number) => (text(a, key) && text(b, key) && text(a, key) !== text(b, key) ? weight : 0);
const LUMENS = [/brillo hasta|brillo menos/i, /brillo de 2000/i, /brillo más de 3500/i];
// Zócalo del procesador o de la placa, del título («AM5», «LGA 1700», «sTR5»).
// Si el título no lo dice, se deduce del chipset de la placa (B850 → AM5, B760 → LGA 1700…).
const CHIPSET_SOCKET: [RegExp, string][] = [
  [/\b(x870e?|x670e?|b850m?|b650e?m?|b840|a620m?)\b/i, "AM5"],
  [/\b(x570|b550m?|a520m?|b450m?|x470|a320m?)\b/i, "AM4"],
  [/\b(z890|b860m?|h810m?)\b/i, "LGA 1851"],
  [/\b(z790|b760m?|h770|z690|b660m?|h610m?)\b/i, "LGA 1700"],
  // Y en procesadores, del modelo.
  [/\bryzen [3579] [789]\d{3}/i, "AM5"],
  [/\bryzen [3579] [345]\d{3}/i, "AM4"],
  [/\bcore ultra [3579] 2\d{2}/i, "LGA 1851"],
  [/\bi[3579]-1[234]\d{3}/i, "LGA 1700"],
];
const socket = (p: SimilarProduct) =>
  p.title.match(/\b(AM4|AM5|sTR5|sTRX4|sWRX8|SP3|SP5|SP6|LGA ?\d{4})\b/i)?.[1].toUpperCase().replace(/^LGA ?/, "LGA ") ?? CHIPSET_SOCKET.find(([re]) => re.test(p.title))?.[1] ?? null;
// Formato de placa base: E-ATX, ATX, micro ATX o mini ITX.
const boardFormat = (p: SimilarProduct) => (/e-atx/i.test(p.title) ? "e-atx" : /mini[ -]?itx/i.test(p.title) ? "itx" : /micro[ -]?atx|m-atx|\bmatx/i.test(p.title) ? "micro" : "atx");
// Chip de una gráfica («RTX 5060 Ti», «RX 9060 XT»), para que pese no cambiar de modelo.
const gpuChip = (p: SimilarProduct) => p.title.match(/\b(rtx|gtx|gt|rx|arc [ab])\s?(\d{3,4})\s?(ti|xt|super)?\b/i)?.slice(1).filter(Boolean).join(" ").toLowerCase() ?? null;
const wifiGen = (p: SimilarProduct) => `${text(p, "filtro.mas_especificaciones")} ${p.title}`.match(/wi-?fi ?(\d)/i)?.[1] ?? null;
// Distribución del teclado: la española salvo que el título diga otra. Un teclado francés no sustituye a uno español.
const layout = (p: SimilarProduct) => p.title.match(/(franc[eé]s|francesa|portugu[eé]s|ingl[eé]s|suiz[ao]|alem[aá]n|italian[ao]|n[oó]rdic[ao]|belga|\bUK\b|EE\. ?UU\.)/i)?.[1].toLowerCase().slice(0, 4) ?? "es";
const isWireless = (p: SimilarProduct) => /inal[aá]mbric|wireless|bluetooth/i.test(p.title) || has(p, "filtro.caracteristicas", /inalámbrico/i);
const READ_SPEED = [/hasta 50/i, /de 51/i, /de 101/i, /de 201|más de 200/i];
const PSU_CERT = [/white|standard/i, /bronze/i, /silver/i, /gold/i, /platinum/i, /titanium/i];
const fanShape = byTitle([[/torre/i, "torre"], [/de pie/i, "pie"], [/sobremesa/i, "sobremesa"]], "suelo");
const TAP_HEIGHT = [/hasta 19/i, /de 20 cm/i, /más de 30/i];
const IRON_STEAM = [/vapor continuo hasta 99/i, /vapor continuo de 100/i, /vapor continuo 130/i];

// Consumibles de impresión: el mismo cartucho en otros colores, en XL o en pack, y nada más (uno que no sirve para la
// impresora del cliente no es un similar). Originales y compatibles, cada uno con los suyos.
const CONSUMABLE_KIND: [RegExp, string][] = [
  [/tambor|fotoconductor|\bDR-?\d/i, "tambor"],
  [/colector|mantenimiento|residual/i, "mantenimiento"],
  [/cabezal/i, "cabezal"],
  [/\bcinta\b/i, "cinta"],
  [/fusor|fijador/i, "fusor"],
  [/t[oó]ner/i, "toner"],
  [/tinta|botella/i, "tinta"],
];
// Algún kit viene titulado como tóner: Icecat lo delata («Los kits de consumibles HP… funcionan con»).
const consumableKind = (p: SimilarProduct) =>
  `${/^los kits/i.test(text(p, "icecat.compatibilidad")) ? "kit" : CONSUMABLE_KIND.find(([re]) => re.test(p.title))?.[1] ?? "otro"}/${/compatible/i.test(p.title) ? "compatible" : "original"}`;
// Impresoras compatibles según Icecat («HL-L3270CDW, MFC-L3750CDW», «Stylus Pro 7800/7880»): modelos de 3 a 5 cifras,
// y en HP también el número del cartucho («Los cartuchos de Tóner HP 17 funcionan con:», a veces sin impresoras).
const printerCache = new WeakMap<SimilarProduct, Set<string>>();
const printers = (p: SimilarProduct) => {
  let set = printerCache.get(p);
  if (!set) {
    const compat = text(p, "icecat.compatibilidad").toLowerCase();
    const head = compat.match(/^(.*?)funcionan con/)?.[1] ?? "";
    const models = compat.slice(head.length).match(/[a-z]*[- ]?\d{3,5}[a-z]*/g) ?? [];
    const series = head.match(/\bhp (\d{2,4}[a-z]?)\b/)?.[1];
    set = new Set([...models.map((t) => t.replace(/[- ]/g, "")), ...(series ? [`hp${series}`] : [])]);
    printerCache.set(p, set);
  }
  return set;
};
// Serie por el código del título cuando no hay impresoras: sin el color ni el XL (LC421XLY → LC421, TN-243BK → TN243),
// los de Epson sin la cifra del color (T7892 → T789) y los de color de HP sin la suya (CF413X → CF41; el negro de HP
// se queda con su código, porque en los monocromo esa cifra es otro cartucho: CF217A no es de la serie de CF210A).
const consumableSeries = (p: SimilarProduct) => {
  const code = p.title.split(/\s+/).find((w) => /\d/.test(w) && w.replace(/\W/g, "").length >= 4 && !/^\d+(?:[.,]\d+)?$/.test(w));
  if (!code) return null;
  const clean = code.toUpperCase().replace(/#.*$/, "").replace(/^M-/, "").replace(/[^A-Z0-9]/g, "");
  const series = clean.replace(/(?:XXL|XL|BKTWIN|TWIN|PGBK|PBK|MBK|BK|BP|CMY|LC|LM|C|M|Y|K)+$/, "");
  if (/^T\d{4}$/.test(series)) return series.slice(0, 4);
  const hp = /negro/i.test(p.title) ? null : series.match(/^([A-Z]{1,3}\d{2,3})[0-3][AX]$/);
  return hp ? hp[1] : series;
};
// Misma serie: si los dos traen impresoras, que compartan al menos la mitad de las del que menos trae; si no, el código.
const sameSeries = (a: SimilarProduct, b: SimilarProduct) => {
  const pa = printers(a);
  const pb = printers(b);
  if (pa.size && pb.size) {
    let shared = 0;
    for (const x of pa) if (pb.has(x)) shared++;
    return shared > 0 && shared >= Math.min(pa.size, pb.size) / 2;
  }
  const sa = consumableSeries(a);
  return sa !== null && sa === consumableSeries(b) && /para (\S+)/i.exec(a.title)?.[1] === /para (\S+)/i.exec(b.title)?.[1];
};
const highYield = (p: SimilarProduct) => (/\bXXL\b|\bXL\b|alta capacidad|alto rendimiento/i.test(p.title) ? 1 : 0);
const consumable: Rule = {
  live: true,
  group: consumableKind,
  // Primero los otros colores de la misma capacidad; después el XL (o el normal) y los packs.
  main: highYield,
  mainWeight: 8,
  steps: [[1, 4]],
  extra: (a, b) => (/\bpack\b|multipack/i.test(a.title) === /\bpack\b|multipack/i.test(b.title) ? 0 : 10),
  perBrand: () => SIMILAR.maxList,
  strict: true,
  match: sameSeries,
};

// Cables: los dos extremos (USB-C a USB-A no sustituye a USB-C a USB-C) y, de red, las bobinas aparte; después, la
// longitud en «duplicaciones» (1 m frente a 2 m = 1), y la categoría de red y la resolución de vídeo.
const CONNECTORS: [RegExp, string][] = [
  [/fibra/i, "fibra"],
  [/cable de red|\brj-?45\b|\bcat ?[5-8]/i, "rj45"],
  [/mini ?displayport|mini ?dp\b/i, "minidp"],
  [/displayport|\bdp\b/i, "dp"],
  [/hdmi/i, "hdmi"],
  [/\bvga\b/i, "vga"],
  [/\bdvi/i, "dvi"],
  [/lightning/i, "lightning"],
  [/micro[- ]?usb/i, "microusb"],
  [/mini[- ]?usb/i, "miniusb"],
  [/usb[- ]?c\b|tipo c\b|type-?c/i, "usbc"],
  [/usb[- ]?b\b/i, "usbb"],
  [/\busb\b/i, "usba"],
  [/jack|3,5 ?mm/i, "jack"],
  [/\brca\b/i, "rca"],
  [/toslink|óptico/i, "optico"],
  [/\bsata\b/i, "sata"],
  [/molex/i, "molex"],
  [/\bpcie\b/i, "pcie"],
  [/coaxial|\biec\b|antena/i, "antena"],
  [/\bc1[34]\b|\bc[57]\b|cee ?7|schuko|alimentación/i, "corriente"],
];
const cableEnds = (p: SimilarProduct) => {
  const found = CONNECTORS.filter(([re]) => re.test(p.title)).map(([, name]) => name);
  // «USB» suelto acompaña a los demás USB («USB-A a USB-C»): solo cuenta si no hay otro.
  const ends = found.filter((name) => name !== "usba" || /usb[- ]?a\b/i.test(p.title) || !found.some((n) => ["usbc", "usbb", "microusb", "miniusb", "lightning"].includes(n)));
  return ends.length ? ends.sort().join("+") : "otro";
};
const cableLength = (p: SimilarProduct) => fromTitle(p, "m");
const cableGroup = (p: SimilarProduct) => {
  const kind = /^(cable|latiguillo)/i.test(p.title) ? "cable" : p.title.split(" ")[0].toLowerCase();
  const reel = /rj45/.test(cableEnds(p)) && (cableLength(p) ?? 0) >= 50 ? "/bobina" : "";
  return `${kind}/${cableEnds(p)}${reel}`;
};
const CAT = ["5e", "6", "6a", "7", "8"];
const netCategory = (p: SimilarProduct) => {
  const index = CAT.indexOf(p.title.match(/\bcat ?(5e|6a|6|7|8)/i)?.[1].toLowerCase() ?? "");
  return index < 0 ? null : index;
};
// Soportes: dónde va (pared, mesa, suelo, techo), para qué (TV, monitor, otra cosa) y si es de varias pantallas; después,
// el tamaño de pantalla más grande que admite, el más pequeño y si es fijo, inclinable o articulado.
const mountPlace = byTitle([[/techo/i, "techo"], [/suelo|\bpie\b|ruedas|carro/i, "suelo"], [/pared/i, "pared"], [/mesa|brazo|escritorio|abrazadera/i, "mesa"]], "otro");
const mountGroup = (p: SimilarProduct) => {
  const target = /monitor/i.test(p.title) ? "monitor" : /\btv\b|televisor|pantalla/i.test(p.title) ? "tv" : p.title.match(/para (?:la |el )?(\S+)/i)?.[1].toLowerCase() ?? "otro";
  const multi = /doble|triple|cuádruple|dos pantallas|varias|[2-6] (pantallas|monitores)/i.test(p.title) || has(p, "filtro.caracteristicas", /varias pantallas/i) ? "/varias" : "";
  return `${mountPlace(p)}/${target}${multi}`;
};
const screenRange = (p: SimilarProduct) => {
  const range = p.title.match(/(\d{2,3})(?:"|'')?\s*-\s*(\d{2,3})"/);
  if (range) return [Number(range[1]), Number(range[2])];
  const upTo = p.title.match(/hasta (\d{2,3})"/i) ?? p.title.match(/(\d{2,3})"/);
  return upTo ? [null, Number(upTo[1])] : [null, null];
};
const mountMotion = (p: SimilarProduct) => (/articulad|brazo|giratori|rotable/i.test(p.title) || text(p, "filtro.tipo") === "Rotable" ? 2 : /inclinable/i.test(p.title) || text(p, "filtro.tipo") === "Inclinable" ? 1 : 0);

const RULES: Record<string, Rule> = {
  Lavadoras: {
    live: true,
    group: (p) => {
      const carga = /carga superior/i.test(`${text(p, "filtro.caracteristicas")} ${p.title}`) ? "superior" : "frontal";
      const instalacion = integrable(p) ? "integrable" : "libre";
      return `${carga}/${instalacion}`;
    },
    // «Más de 10 kg» no da la cifra: entonces se lee del título.
    main: (p) => {
      const capacidad = text(p, "filtro.capacidad");
      const kg = /más de/i.test(capacidad) ? null : number(capacidad.replace(/\s*kg.*/i, ""));
      if (kg !== null) return kg;
      return fromTitle(p, "kg");
    },
    mainWeight: 12,
    steps: [[1, 0.3], [2, 0.45], [3, 0.7]],
    extra: (a, b) => diff(number(text(a, "filtro.centrifugado")), number(text(b, "filtro.centrifugado")), 0.03) + diff(energyClass(a), energyClass(b), 4),
  },
  // Combis: libre o integrable y No Frost o cíclico; litros cercanos. La altura (del título) y el ancho (rango del
  // filtro) pesan porque deciden si cabe en el hueco.
  "Frigoríficos combi": {
    live: true,
    group: (p) => `${integrable(p) ? "integrable" : "libre"}/${/c[ií]clico/i.test(text(p, "filtro.tecnologia")) && !/no ?frost/i.test(p.title) ? "ciclico" : "nofrost"}`,
    main: (p) => fromTitle(p, "L") ?? number(text(p, "filtro.capacidad")),
    mainWeight: 0.4,
    steps: [[30, 0.3], [50, 0.45], [80, 0.7]],
    extra: (a, b) => diff(fromTitle(a, "cm"), fromTitle(b, "cm"), 0.6) + diff(bucket(a, "filtro.ancho", WIDTH_COMBI), bucket(b, "filtro.ancho", WIDTH_COMBI), 25) + diff(energyClass(a), energyClass(b), 3),
  },
  // Lavavajillas: 45 o 60 cm y libre o integrable; servicios cercanos.
  Lavavajillas: {
    live: true,
    group: (p) => `${/45\s*cm/i.test(`${text(p, "filtro.ancho")} ${p.title}`) ? "45" : "60"}/${integrable(p) ? "integrable" : "libre"}`,
    main: (p) => fromTitle(p, "servicios") ?? number(text(p, "filtro.capacidad")),
    mainWeight: 10,
    steps: [[1, 0.3], [2, 0.45], [3, 0.7]],
    extra: (a, b) => diff(energyClass(a), energyClass(b), 4),
  },
  // Hornos: compacto (45 cm) o normal y pirolítico o no; litros cercanos.
  Hornos: {
    live: true,
    group: (p) => `${/45\s*cm/i.test(text(p, "filtro.alto")) ? "compacto" : "normal"}/${/pir[oó]l[ií]/i.test(`${text(p, "filtro.limpieza")} ${p.title}`) ? "pirolitico" : "otro"}`,
    main: (p) => fromTitle(p, "L") ?? number(text(p, "filtro.capacidad")),
    mainWeight: 1.5,
    steps: [[5, 0.3], [10, 0.45], [20, 0.7]],
    extra: (a, b) => diff(energyClass(a), energyClass(b), 4),
  },
  // Televisores: mismas pulgadas primero (luego ±8 y ±15); la tecnología de panel pesa en el orden.
  Televisores: {
    live: true,
    group: () => "tv",
    main: (p) => number(text(p, "filtro.tamano_pantalla")) ?? fromTitle(p, '"'),
    mainWeight: 3,
    steps: [[0, 0.3], [8, 0.45], [15, 0.7]],
    extra: (a, b) => diff(panel(a), panel(b), 12),
  },
  // Secadoras: bomba de calor o no; kilos cercanos.
  Secadoras: {
    live: true,
    group: (p) => (/bomba de calor/i.test(`${text(p, "filtro.caracteristicas")} ${p.title}`) ? "bomba" : "otra"),
    main: (p) => fromTitle(p, "kg") ?? number(text(p, "filtro.capacidad")),
    mainWeight: 12,
    steps: [[1, 0.3], [2, 0.45], [3, 0.7]],
    extra: (a, b) => diff(energyClass(a), energyClass(b), 4),
  },
  // Campanas: mismo tipo de montaje (las de isla aparte) y mismo ancho primero (luego ±10 y ±20 cm).
  "Campanas extractoras": {
    live: true,
    group: (p) => (/\bisla\b/i.test(p.title) ? "isla" : text(p, "filtro.tipo") || "sin tipo"),
    main: (p) => fromTitle(p, "cm") ?? number(text(p, "filtro.ancho")),
    mainWeight: 2,
    steps: [[0, 0.3], [10, 0.45], [20, 0.7]],
    extra: (a, b) => diff(fromTitle(a, "m³/h"), fromTitle(b, "m³/h"), 0.04) + diff(energyClass(a), energyClass(b), 3),
  },
  // Placas de inducción: encastrable o portátil y las de extractor aparte; mismo ancho primero; pesan zonas y zona flexible.
  "Placas de inducción": {
    live: true,
    group: (p) => `${hobGroup(p)}/${/extractor/i.test(`${text(p, "filtro.tipo")} ${p.title}`) ? "extractor" : "normal"}`,
    main: (p) => number(text(p, "filtro.ancho")) ?? fromTitle(p, "cm"),
    mainWeight: 2,
    steps: [[0, 0.3], [10, 0.45], [20, 0.7]],
    extra: (a, b) => diff(zones(a), zones(b), 8) + mismatch(a, b, "filtro.caracteristicas", /zona flexible/i, 6),
  },
  // Placas de gas: encastrable o portátil; mismo ancho; pesan los fuegos y el tipo de gas (butano o natural).
  "Placas de gas": {
    live: true,
    group: hobGroup,
    main: (p) => number(text(p, "filtro.ancho")) ?? fromTitle(p, "cm"),
    mainWeight: 2,
    steps: [[0, 0.3], [15, 0.45], [30, 0.7]],
    extra: (a, b) =>
      diff(zones(a), zones(b), 8) +
      (/butano y natural/i.test(text(a, "filtro.mas_especificaciones")) || /butano y natural/i.test(text(b, "filtro.mas_especificaciones")) ? 0 : mismatch(a, b, "filtro.mas_especificaciones", /gas butano/i, 30)),
  },
  "Placas vitrocerámicas": {
    live: true,
    group: hobGroup,
    main: (p) => number(text(p, "filtro.ancho")) ?? fromTitle(p, "cm"),
    mainWeight: 2,
    steps: [[0, 0.3], [10, 0.45], [30, 0.7]],
    extra: (a, b) => diff(zones(a), zones(b), 8),
  },
  // Microondas de libre instalación: los de convección (hacen de horno) aparte; litros cercanos; pesan grill y potencia.
  Microondas: {
    live: true,
    group: (p) => (has(p, "filtro.caracteristicas", /convección/i) ? "conveccion" : "normal"),
    main: litres,
    mainWeight: 2,
    steps: [[2, 0.3], [4, 0.45], [8, 0.7]],
    extra: microExtra,
  },
  // Microondas integrables: por el hueco, los de 38 a 40 cm de alto aparte de los demás altos.
  "Microondas integrables": {
    live: true,
    group: (p) => (/de 38/i.test(text(p, "filtro.alto")) ? "38-40" : text(p, "filtro.alto") || "sin alto"),
    main: litres,
    mainWeight: 2,
    steps: [[2, 0.3], [4, 0.45], [8, 0.7]],
    extra: (a, b) => microExtra(a, b) + mismatch(a, b, "filtro.caracteristicas", /convección/i, 15),
  },
  // Frigoríficos de 1 puerta y congeladores verticales: libre o integrable y bajo encimera aparte; litros cercanos.
  "Frigoríficos de 1 puerta": {
    live: true,
    group: (p) => `${integrable(p) ? "integrable" : "libre"}/${low(p) ? "bajo" : "alto"}`,
    main: litres,
    mainWeight: 0.4,
    steps: [[30, 0.3], [60, 0.45], [100, 0.7]],
    extra: coldExtra,
  },
  "Congeladores verticales": {
    live: true,
    group: (p) => `${integrable(p) ? "integrable" : "libre"}/${low(p) ? "bajo" : "alto"}`,
    main: litres,
    mainWeight: 0.4,
    steps: [[30, 0.3], [60, 0.45], [100, 0.7]],
    extra: coldExtra,
  },
  "Frigoríficos de 2 puertas": {
    live: true,
    group: (p) => (integrable(p) ? "integrable" : "libre"),
    main: litres,
    mainWeight: 0.4,
    steps: [[30, 0.3], [60, 0.45], [100, 0.7]],
    extra: coldExtra,
  },
  // Americanos: un solo grupo (pocos y el tipo falta en muchos); pesan el tipo de puertas y el dispensador.
  "Frigoríficos americanos y side by side": {
    live: true,
    group: () => "americano",
    main: litres,
    mainWeight: 0.2,
    steps: [[60, 0.3], [120, 0.45], [200, 0.7]],
    extra: (a, b) =>
      (text(a, "filtro.tipo") && text(b, "filtro.tipo") && text(a, "filtro.tipo") !== text(b, "filtro.tipo") ? 15 : 0) +
      mismatch(a, b, "filtro.caracteristicas", /dispensador/i, 10) +
      diff(energyClass(a), energyClass(b), 3),
  },
  "Arcones congeladores": {
    live: true,
    group: () => "arcon",
    main: litres,
    mainWeight: 0.3,
    steps: [[50, 0.3], [100, 0.45], [150, 0.7]],
    extra: (a, b) => mismatch(a, b, "filtro.caracteristicas", /convertible/i, 10) + diff(energyClass(a), energyClass(b), 3),
  },
  // Impresoras: sin dato principal (todo es precio dentro del grupo); pesan color, depósito de tinta, doble cara, wifi y
  // velocidad.
  Impresoras: {
    live: true,
    group: (p) => {
      const tech = printerTech(p);
      if (tech === "Térmica") return "termica";
      // Los plóteres (A0 a A2) aparte de las A3, y las A3 aparte de las A4.
      if (/pl[oó]ter/i.test(p.title) || /formato máximo a[0-2]\b/i.test(text(p, "filtro.mas_especificaciones"))) return "ploter";
      const a3 = /formato máximo a3\b/i.test(text(p, "filtro.mas_especificaciones")) || /\ba3\b/i.test(p.title);
      return `${tech}/${multifunction(p) ? "multifuncion" : "impresora"}/${a3 ? "a3" : "a4"}`;
    },
    main: () => 0,
    mainWeight: 0,
    steps: [[0, 0.25], [0, 0.4], [0, 0.6]],
    extra: (a, b) =>
      mismatch(a, b, "filtro.caracteristicas", /color/i, 20) +
      mismatch(a, b, "filtro.caracteristicas", /depósito de tinta/i, 15) +
      mismatch(a, b, "filtro.caracteristicas", /doble cara/i, 8) +
      mismatch(a, b, "filtro.conectividad", /wifi/i, 8) +
      diff(bucket(a, "filtro.mas_especificaciones", PPM), bucket(b, "filtro.mas_especificaciones", PPM), 5),
  },
  // Auriculares: diadema o intrauditivos, con o sin cable, y los gaming aparte; todo precio dentro del grupo. Pesan
  // cancelación de ruido, true wireless, deportivos y autonomía.
  Auriculares: {
    live: true,
    group: (p) => `${headphoneType(p)}/${wireless(p) ? "inalambricos" : "cable"}${/gaming/i.test(p.title) ? "/gaming" : ""}`,
    main: () => 0,
    mainWeight: 0,
    steps: [[0, 0.25], [0, 0.4], [0, 0.6]],
    extra: (a, b) =>
      mismatch(a, b, "filtro.caracteristicas", /cancelación de ruido/i, 20) +
      mismatch(a, b, "filtro.caracteristicas", /true wireless/i, 15) +
      mismatch(a, b, "filtro.caracteristicas", /deportivos/i, 8) +
      diff(bucket(a, "filtro.autonomia", AUTONOMY), bucket(b, "filtro.autonomia", AUTONOMY), 4),
  },
  // Relojes: los Apple Watch (solo van con iPhone) aparte y sin tope por marca, y los infantiles aparte; tamaño de caja cercano. Pesan 4G/5G, GPS y
  // NFC.
  Smartwatches: {
    live: true,
    group: (p) => ((p.marca ?? "").toUpperCase() === "APPLE" || /apple watch/i.test(p.title) ? "apple" : /infantil|niñ[oa]s|kids/i.test(p.title) ? "infantil" : "otros"),
    perBrand: (group) => (group === "apple" ? SIMILAR.maxList : SIMILAR.perBrand),
    main: (p) => number(text(p, "filtro.tamano_pantalla")) ?? fromTitle(p, "mm") ?? 44,
    mainWeight: 2,
    steps: [[2, 0.3], [4, 0.45], [8, 0.7]],
    extra: (a, b) =>
      mismatch(a, b, "filtro.conectividad", /4g|5g/i, 15) + mismatch(a, b, "filtro.conectividad", /gps/i, 8) + mismatch(a, b, "filtro.conectividad", /nfc/i, 5),
  },
  // Cafeteras: por sistema (cada marca de cápsulas aparte, superautomáticas, espresso, italianas, de goteo); manda el
  // precio. Pesan las tazas, el espumador y el molinillo.
  Cafeteras: {
    live: true,
    strict: true,
    group: coffeeKind,
    main: () => 0,
    mainWeight: 0,
    steps: [[0, 0.25], [0, 0.4], [0, 0.6]],
    extra: (a, b) =>
      diff(fromTitle(a, "tazas"), fromTitle(b, "tazas"), 3) +
      mismatch(a, b, "filtro.caracteristicas", /espumador/i, 10) +
      mismatch(a, b, "filtro.caracteristicas", /molinillo/i, 15),
  },
  // Aspiradores: escoba, de mano, trineo o de sólidos y líquidos; manda el precio. Pesan sin cable, sin bolsa y HEPA.
  Aspiradores: {
    live: true,
    group: (p) => {
      // Manda el título: muchos de mano y escobas dicen «aspira líquidos» en el filtro.
      if (/l[ií]quidos|industrial|cenizas/i.test(p.title)) return "liquidos";
      if (/de mano|mano\b/i.test(p.title)) return "mano";
      if (/escoba/i.test(p.title)) return "escoba";
      return has(p, "filtro.caracteristicas", /aspira líquidos/i) ? "liquidos" : "trineo";
    },
    main: () => 0,
    mainWeight: 0,
    steps: [[0, 0.25], [0, 0.4], [0, 0.6]],
    extra: (a, b) =>
      mismatch(a, b, "filtro.caracteristicas", /sin cable/i, 15) + mismatch(a, b, "filtro.caracteristicas", /sin bolsa/i, 10) + mismatch(a, b, "filtro.caracteristicas", /hepa/i, 5),
  },
  // Freidoras: de aire o de aceite; litros cercanos. Pesan doble cesta y pantalla.
  Freidoras: {
    live: true,
    group: (p) => (/de aire|sin aceite|air ?fryer|horno/i.test(p.title) ? "aire" : "aceite"),
    main: litres,
    mainWeight: 6,
    steps: [[1, 0.3], [2, 0.45], [4, 0.7]],
    extra: (a, b) => mismatch(a, b, "filtro.caracteristicas", /doble cesta/i, 15) + mismatch(a, b, "filtro.caracteristicas", /display/i, 4),
  },
  // Planchas: de vapor normales, verticales y de viaje aparte; manda el precio. Pesan vapor continuo y potencia.
  "Planchas de ropa": {
    live: true,
    group: (p) => (/vertical/i.test(`${text(p, "filtro.tipo")} ${p.title}`) ? "vertical" : /viaje/i.test(p.title) ? "viaje" : "normal"),
    main: () => 0,
    mainWeight: 0,
    steps: [[0, 0.25], [0, 0.4], [0, 0.6]],
    extra: (a, b) => diff(bucket(a, "filtro.mas_especificaciones", vapour), bucket(b, "filtro.mas_especificaciones", vapour), 6) + diff(watts(a), watts(b), 0.01),
  },
  // Termos eléctricos: los que se pueden poner en horizontal aparte; litros cercanos.
  "Termos eléctricos": {
    live: true,
    group: (p) => (/horizontal/i.test(`${text(p, "filtro.tipo")} ${p.title}`) ? "horizontal" : "vertical"),
    main: litres,
    mainWeight: 0.5,
    steps: [[0, 0.3], [20, 0.45], [50, 0.7]],
    extra: (a, b) => diff(energyClass(a), energyClass(b), 4) + mismatch(a, b, "filtro.conectividad", /wifi/i, 5),
  },
  // Altavoces: inteligentes, de fiesta (100 W o más, karaoke) y para ordenador aparte de los portátiles; potencia cercana
  // en «duplicaciones». Pesan resistencia al agua, radio y autonomía.
  Altavoces: {
    live: true,
    group: (p) => {
      if (has(p, "filtro.caracteristicas", /inteligente/i) || /alexa|google home|inteligente/i.test(p.title)) return "inteligente";
      if (/\bpc\b|ordenador|2\.1|usb/i.test(p.title) && !/bluetooth/i.test(p.title)) return "ordenador";
      if (/fiesta|karaoke|party/i.test(p.title) || (watts(p) ?? 0) >= 100) return "fiesta";
      return "portatil";
    },
    main: (p) => log2(watts(p)) ?? 0,
    mainWeight: 10,
    steps: [[0.5, 0.3], [1, 0.45], [2, 0.7]],
    extra: (a, b) =>
      mismatch(a, b, "filtro.caracteristicas", /resistente al agua/i, 8) +
      mismatch(a, b, "filtro.caracteristicas", /radio/i, 5) +
      diff(bucket(a, "filtro.autonomia", AUTONOMY), bucket(b, "filtro.autonomia", AUTONOMY), 3),
  },
  // SAI: misma tecnología (offline, línea interactiva u online) y los de rack aparte; potencia en VA cercana.
  SAI: {
    live: true,
    group: (p) => `${text(p, "filtro.tecnologia") || (/online/i.test(p.title) ? "Online" : "Línea interactiva")}/${has(p, "filtro.caracteristicas", /rack/i) || /\brack\b/i.test(p.title) ? "rack" : "torre"}`,
    main: (p) => log2(fromTitle(p, "VA")) ?? log2(number(text(p, "filtro.potencia"))),
    mainWeight: 20,
    steps: [[0.3, 0.3], [0.6, 0.45], [1, 0.7]],
    extra: (a, b) => mismatch(a, b, "filtro.caracteristicas", /senoidal/i, 10) + mismatch(a, b, "filtro.caracteristicas", /schuko/i, 5),
  },
  // Discos externos: SSD o disco duro; misma capacidad primero.
  "Discos duros externos": {
    live: true,
    group: (p) => (/\bssd\b/i.test(p.title) ? "ssd" : "hdd"),
    main: (p) => log2(diskGb(p)),
    mainWeight: 25,
    steps: [[0, 0.3], [1, 0.45], [1, 0.7]],
    extra: (a, b) => mismatch(a, b, "filtro.caracteristicas", /golpes/i, 6) + mismatch(a, b, "filtro.caracteristicas", /cifrado/i, 6),
  },
  // Discos internos: NVMe (M.2), SSD SATA, discos de 2,5" y de 3,5" y SAS de servidor aparte; misma capacidad primero.
  "Discos duros internos y SSD": {
    live: true,
    group: (p) => {
      if (/nvme|m\.2|pcie/i.test(p.title)) return "nvme";
      if (/\bsas\b/i.test(p.title)) return "sas";
      if (/\bssd\b/i.test(p.title)) return "ssd-sata";
      return /2,5"|2\.5"/i.test(p.title) ? "hdd-2,5" : "hdd-3,5";
    },
    main: (p) => log2(diskGb(p)),
    mainWeight: 25,
    steps: [[0, 0.3], [1, 0.45], [1, 0.7]],
  },
  // Portátiles: Mac, Chromebook o PC, y con gráfica dedicada aparte; pulgadas cercanas y precio más ajustado que en
  // electrodomésticos, porque hay muchos. Pesan memoria, disco, gama de procesador, peso y convertible.
  Portátiles: {
    live: true,
    group: (p) => {
      if (/macos/i.test(text(p, "filtro.sistema_operativo")) || /apple/i.test(text(p, "filtro.mas_especificaciones")) || /macbook/i.test(p.title)) return "mac";
      if (/chrome/i.test(text(p, "filtro.sistema_operativo")) || /chromebook/i.test(p.title)) return "chrome";
      return has(p, "filtro.caracteristicas", /gráfica dedicada/i) ? "pc/grafica" : "pc";
    },
    // Los Mac son todos de Apple: sin tope por marca. Los monitores grandes (40" o más) son casi todos Sony.
    perBrand: (group) => (group === "mac" ? SIMILAR.maxList : SIMILAR.perBrand),
    main: inches,
    mainWeight: 8,
    steps: [[0.5, 0.2], [1.5, 0.3], [2.5, 0.45]],
    extra: (a, b) =>
      log2diff(gb(a, "filtro.memoria_ram"), gb(b, "filtro.memoria_ram"), 12) +
      log2diff(gb(a, "filtro.capacidad"), gb(b, "filtro.capacidad"), 8) +
      diff(cpuTier(a), cpuTier(b), 10) +
      diff(bucket(a, "filtro.mas_especificaciones", WEIGHT_LAPTOP), bucket(b, "filtro.mas_especificaciones", WEIGHT_LAPTOP), 6) +
      mismatch(a, b, "filtro.caracteristicas", /convertible/i, 20) +
      mismatch(a, b, "filtro.caracteristicas", /oled/i, 6),
  },
  // Ordenadores de sobremesa: torre, mini PC, todo en uno o barebone, Mac aparte y torres con gráfica dedicada (gaming o
  // estación de trabajo) aparte; misma
  // gama de procesador primero. Pesan memoria, disco y, en los todo en uno, las pulgadas.
  "Ordenadores de sobremesa": {
    live: true,
    group: (p) => {
      const type = desktopType(p);
      const mac = /macos/i.test(text(p, "filtro.sistema_operativo")) || /apple/i.test(text(p, "filtro.mas_especificaciones")) || /\b(?:mac|imac)\b/i.test(p.title);
      if (mac) return `mac/${type}`;
      return type === "torre" && (has(p, "filtro.caracteristicas", /gráfica dedicada/i) || /gaming/i.test(p.title)) ? "torre/gaming" : type;
    },
    perBrand: (group) => (group.startsWith("mac/") ? SIMILAR.maxList : SIMILAR.perBrand),
    main: (p) => (desktopType(p).startsWith("barebone") ? 0 : desktopCpu(p)),
    mainWeight: 15,
    steps: [[0, 0.25], [1, 0.35], [1, 0.5]],
    extra: (a, b) =>
      log2diff(gb(a, "filtro.memoria_ram"), gb(b, "filtro.memoria_ram"), 12) +
      log2diff(gb(a, "filtro.capacidad"), gb(b, "filtro.capacidad"), 8) +
      diff(inches(a), inches(b), 6),
  },
  // Monitores: los portátiles (menos de 18") y los ultrapanorámicos aparte; pulgadas cercanas. Pesan resolución, hercios,
  // curva, panel, altura regulable y USB-C con carga.
  Monitores: {
    live: true,
    group: (p) => {
      const size = inches(p) ?? 0;
      if (size < 18) return "portatil";
      if (has(p, "filtro.caracteristicas", /ultrapanor/i)) return "ultra";
      return size >= 40 ? "grande" : "normal";
    },
    perBrand: (group) => (group === "grande" ? SIMILAR.maxList : SIMILAR.perBrand),
    main: inches,
    mainWeight: 4,
    steps: [[0.5, 0.3], [3.5, 0.45], [5, 0.7]],
    extra: (a, b) =>
      diff(resolution(a), resolution(b), 15) +
      log2diff(hz(a), hz(b), 15) +
      mismatch(a, b, "filtro.caracteristicas", /curva/i, 10) +
      (text(a, "filtro.tecnologia") && text(b, "filtro.tecnologia") && text(a, "filtro.tecnologia") !== text(b, "filtro.tecnologia") ? 5 : 0) +
      mismatch(a, b, "filtro.caracteristicas", /altura regulable/i, 5) +
      mismatch(a, b, "filtro.caracteristicas", /usb-c/i, 8),
  },
  // Lavasecadoras: libre o integrable; kilos de lavado cercanos (el primero del título, «9 kg / 6 kg»). Pesan los kilos
  // de secado, el centrifugado y la clase energética.
  "Lavadoras secadoras": {
    live: true,
    group: (p) => (integrable(p) ? "integrable" : "libre"),
    // Una integrable no sustituye a una de libre instalación (ni al revés), ni siquiera para rellenar.
    strict: true,
    main: (p) => fromTitle(p, "kg") ?? number(text(p, "filtro.capacidad")),
    mainWeight: 12,
    steps: [[1, 0.3], [2, 0.45], [3, 0.7]],
    extra: (a, b) =>
      diff(dryKg(a), dryKg(b), 8) + diff(number(text(a, "filtro.centrifugado")), number(text(b, "filtro.centrifugado")), 0.03) + diff(energyClass(a), energyClass(b), 4),
  },
  // Hornos compactos (45 cm): litros cercanos; pesan pirólisis, vapor y clase energética.
  "Hornos compactos": {
    live: true,
    group: () => "compacto",
    main: litres,
    mainWeight: 1.5,
    steps: [[3, 0.3], [6, 0.45], [10, 0.7]],
    extra: (a, b) =>
      (pyrolytic(a) === pyrolytic(b) ? 0 : 15) + (/vapor/i.test(a.title) === /vapor/i.test(b.title) ? 0 : 10) + diff(energyClass(a), energyClass(b), 4),
  },
  // Hornos de sobremesa: litros cercanos; pesa la convección.
  "Hornos de sobremesa": {
    live: true,
    group: () => "sobremesa",
    main: litres,
    mainWeight: 1,
    steps: [[5, 0.3], [10, 0.45], [20, 0.7]],
    extra: (a, b) => mismatch(a, b, "filtro.caracteristicas", /convección/i, 6),
  },
  // Cocinas: de gas o vitrocerámica/eléctrica (manda el título); mismo ancho primero. Pesan fuegos, butano o natural y horno.
  "Cocinas de gas y eléctricas": {
    live: true,
    group: (p) => (/vitrocer|el[eé]ctrica/i.test(p.title.replace(/horno el[eé]ctrico/i, "")) ? "electrica" : "gas"),
    main: (p) => fromTitle(p, "cm") ?? number(text(p, "filtro.ancho")),
    mainWeight: 2,
    steps: [[0, 0.3], [10, 0.45], [30, 0.7]],
    extra: (a, b) => diff(zones(a) ?? fromTitle(a, "fuegos"), zones(b) ?? fromTitle(b, "fuegos"), 8) + (gasKind(a) && gasKind(b) && gasKind(a) !== gasKind(b) ? 30 : 0),
  },
  // Fregaderos: bajo encimera o sobre encimera y número de cubetas (1, 1½ o 2); manda el precio. Pesan el material
  // (acero o sintético), el escurridor, el ancho de mueble y el color.
  Fregaderos: {
    live: true,
    group: (p) => {
      const tipo = text(p, "filtro.tipo") || p.title;
      const cubetas = /1 1\/2|1,5|1½/i.test(tipo) ? "1,5" : /2 cubetas/i.test(tipo) ? "2" : "1";
      return `${/bajo encimera/i.test(p.title) ? "bajo" : "sobre"}/${cubetas}`;
    },
    main: () => 0,
    mainWeight: 0,
    steps: [[0, 0.3], [0, 0.45], [0, 0.7]],
    extra: (a, b) =>
      (text(a, "filtro.material") === text(b, "filtro.material") ? 0 : 20) +
      (/escurridor/i.test(`${text(a, "filtro.tipo")} ${a.title}`) === /escurridor/i.test(`${text(b, "filtro.tipo")} ${b.title}`) ? 0 : 15) +
      diff(number(text(a, "filtro.ancho")), number(text(b, "filtro.ancho")), 0.8) +
      (text(a, "filtro.color") === text(b, "filtro.color") ? 0 : 8),
  },
  // Grifos de cocina: manda el precio. Pesan el color (cromo, negro…), el caño extraíble y la altura.
  "Grifos de cocina": {
    live: true,
    group: () => "grifo",
    main: () => 0,
    mainWeight: 0,
    steps: [[0, 0.3], [0, 0.45], [0, 0.7]],
    extra: (a, b) =>
      (text(a, "filtro.color") === text(b, "filtro.color") ? 0 : 15) +
      (/extra[ií]ble/i.test(`${text(a, "filtro.caracteristicas")} ${a.title}`) === /extra[ií]ble/i.test(`${text(b, "filtro.caracteristicas")} ${b.title}`) ? 0 : 10) +
      diff(bucket(a, "filtro.mas_especificaciones", TAP_HEIGHT), bucket(b, "filtro.mas_especificaciones", TAP_HEIGHT), 4),
  },
  // Vinotecas: libre o integrable; botellas cercanas en «duplicaciones». Pesa la doble zona.
  Vinotecas: {
    live: true,
    group: (p) => (integrable(p) ? "integrable" : "libre"),
    main: (p) => log2(fromTitle(p, "botellas")),
    mainWeight: 20,
    steps: [[0.5, 0.3], [1, 0.45], [2, 0.7]],
    extra: (a, b) => mismatch(a, b, "filtro.caracteristicas", /doble zona/i, 8),
  },
  // Hornillos: de gas, eléctricos, de inducción y paelleros aparte; mismos fuegos primero.
  Hornillos: {
    live: true,
    group: (p) => {
      if (/paeller/i.test(p.title)) return "paellero";
      if (/inducci[oó]n/i.test(`${text(p, "filtro.tipo")} ${p.title}`)) return "induccion";
      return /\bgas\b|butano|propano|fuegos?\b/i.test(`${text(p, "filtro.tipo")} ${p.title}`) ? "gas" : "electrico";
    },
    main: (p) => zones(p) ?? fromTitle(p, "fuegos") ?? fromTitle(p, "fuego") ?? fromTitle(p, "placas") ?? fromTitle(p, "placa"),
    mainWeight: 15,
    steps: [[0, 0.3], [1, 0.45], [2, 0.7]],
    extra: (a, b) => diff(watts(a), watts(b), 0.004),
  },
  // Centros de planchado y planchas verticales (aparte); bares de presión cercanos. Pesan el vapor continuo y la potencia.
  "Centros de planchado y planchas verticales": {
    live: true,
    group: (p) => (/vertical/i.test(p.title) ? "vertical" : "centro"),
    main: (p) => (/vertical/i.test(p.title) ? 0 : fromTitle(p, "bar") ?? (/bar/i.test(text(p, "filtro.potencia")) ? number(text(p, "filtro.potencia")) : null)),
    mainWeight: 8,
    steps: [[0.5, 0.3], [1, 0.45], [2, 0.7]],
    extra: (a, b) => diff(bucket(a, "filtro.mas_especificaciones", IRON_STEAM), bucket(b, "filtro.mas_especificaciones", IRON_STEAM), 5) + diff(fromTitle(a, "W"), fromTitle(b, "W"), 0.01),
  },
  // Pequeño electro de cocina. En casi todas manda el precio; el «grupo» sale del título, porque en estas familias hay
  // productos de otra clase (una licuadora entre las batidoras, una tostadora entre las planchas).
  Batidoras: {
    live: true,
    group: byTitle([[/de vaso|licuadora|nutribullet/i, "vaso"], [/varillas/i, "varillas"], [/amasadora/i, "amasadora"]], "mano"),
    main: (p) => log2(watts(p)),
    mainWeight: 10,
    steps: [[0.5, 0.3], [1, 0.45], [2, 0.7]],
    extra: (a, b) => mismatch(a, b, "filtro.caracteristicas", /pica hielo/i, 4) + mismatch(a, b, "filtro.caracteristicas", /accesorios/i, 3),
  },
  Tostadoras: {
    live: true,
    // Ranuras: 1 (larga), 2 o 4.
    group: (p) => (/tostadora/i.test(p.title) ? `${fromTitle(p, "ranura") ?? fromTitle(p, "ranuras") ?? zones(p) ?? 2}` : "otro"),
    ...byPrice,
    extra: (a, b) => mismatch(a, b, "filtro.mas_especificaciones", /7 o más/i, 3) + (text(a, "filtro.color") === text(b, "filtro.color") ? 0 : 3),
  },
  "Hervidores de agua": {
    live: true,
    group: () => "hervidor",
    main: (p) => number(text(p, "filtro.capacidad")) ?? fromTitle(p, "L"),
    mainWeight: 10,
    steps: [[0.2, 0.3], [0.5, 0.45], [1, 0.7]],
    extra: (a, b) => (/regulable|temperatura/i.test(`${text(a, "filtro.caracteristicas")} ${a.title}`) === /regulable|temperatura/i.test(`${text(b, "filtro.caracteristicas")} ${b.title}`) ? 0 : 8),
  },
  Exprimidores: {
    live: true,
    group: byTitle([[/palanca|brazo/i, "palanca"], [/licuadora/i, "licuadora"]], "exprimidor"),
    ...byPrice,
    extra: (a, b) => diff(log2(watts(a)), log2(watts(b)), 4),
  },
  Sandwicheras: {
    live: true,
    group: byTitle([[/gofre|crep/i, "gofrera"]], "sandwichera"),
    main: (p) => number(text(p, "filtro.capacidad")),
    mainWeight: 15,
    steps: [[0, 0.3], [1, 0.45], [2, 0.7]],
  },
  "Planchas de asar y grills eléctricos": {
    live: true,
    group: byTitle([[/tostadora/i, "tostadora"], [/raclette|fondue/i, "raclette"]], "plancha"),
    ...byPrice,
    extra: (a, b) => diff(bucket(a, "filtro.ancho", GRILL_WIDTH), bucket(b, "filtro.ancho", GRILL_WIDTH), 6),
  },
  Picadoras: {
    live: true,
    group: () => "picadora",
    main: (p) => number(text(p, "filtro.capacidad")) ?? fromTitle(p, "L"),
    mainWeight: 10,
    steps: [[0.2, 0.3], [0.5, 0.45], [1, 0.7]],
  },
  "Robots de cocina": {
    live: true,
    group: byTitle([[/robot de cocina/i, "robot"]], "otro"),
    ...byPrice,
  },
  Licuadoras: {
    live: true,
    group: byTitle([[/exprimidor/i, "exprimidor"], [/batidora/i, "batidora"]], "licuadora"),
    ...byPrice,
  },
  Arroceras: {
    live: true,
    group: () => "arrocera",
    main: (p) => number(text(p, "filtro.capacidad")) ?? fromTitle(p, "L"),
    mainWeight: 6,
    steps: [[0.3, 0.3], [0.8, 0.45], [1.5, 0.7]],
  },
  "Molinillos de café": {
    live: true,
    group: byTitle([[/pimienta|\bsal\b/i, "especias"]], "cafe"),
    ...byPrice,
  },
  // Cuidado personal: manda el precio; el tipo sale del título por la misma razón.
  Cortapelos: {
    live: true,
    group: byTitle([[/afeitadora|oneblade/i, "afeitadora"], [/nariz|oreja/i, "nariz"], [/multifunci[oó]n/i, "multifuncion"], [/barbero|barba/i, "barbero"]], "cortapelos"),
    ...byPrice,
    extra: (a, b) => diff(bucket(a, "filtro.autonomia", MINUTES), bucket(b, "filtro.autonomia", MINUTES), 3) + mismatch(a, b, "filtro.caracteristicas", /mojado/i, 4),
  },
  "Secadores de pelo": {
    live: true,
    group: byTitle([[/viaje/i, "viaje"]], "secador"),
    ...byPrice,
    extra: (a, b) => mismatch(a, b, "filtro.caracteristicas", /sin escobillas/i, 10) + mismatch(a, b, "filtro.caracteristicas", /iónica/i, 3) + diff(watts(a), watts(b), 0.01),
  },
  Afeitadoras: {
    live: true,
    group: (p) => {
      if (/depiladora/i.test(p.title)) return "depiladora";
      if (/cortapelos|barbero/i.test(p.title)) return "cortapelos";
      if (/corporal/i.test(p.title)) return "corporal";
      if (/oneblade/i.test(p.title)) return "oneblade";
      return /l[aá]minas/i.test(`${text(p, "filtro.tipo")} ${p.title}`) ? "laminas" : "rotativa";
    },
    ...byPrice,
    extra: (a, b) => mismatch(a, b, "filtro.caracteristicas", /estación de limpieza/i, 8) + diff(bucket(a, "filtro.autonomia", MINUTES), bucket(b, "filtro.autonomia", MINUTES), 3),
  },
  Depiladoras: {
    live: true,
    group: byTitle([[/de luz|ipl|luz pulsada/i, "luz"], [/facial/i, "facial"], [/cera/i, "cera"], [/afeitadora|rizador/i, "otro"]], "electrica"),
    ...byPrice,
    extra: (a, b) => mismatch(a, b, "filtro.caracteristicas", /mojado/i, 4),
  },
  "Moldeadores y rizadores de pelo": {
    live: true,
    group: byTitle([[/cepillo/i, "cepillo"], [/plancha/i, "plancha"], [/rizador/i, "rizador"]], "moldeador"),
    ...byPrice,
    extra: (a, b) => mismatch(a, b, "filtro.caracteristicas", /iónica/i, 3),
  },
  "Planchas de pelo": {
    live: true,
    group: byTitle([[/cepillo/i, "cepillo"]], "plancha"),
    ...byPrice,
    extra: (a, b) => mismatch(a, b, "filtro.mas_especificaciones", /más de 229/i, 4) + mismatch(a, b, "filtro.caracteristicas", /iónica/i, 3),
  },
  "Cepillos de dientes eléctricos": {
    live: true,
    group: (p) => (/irrigador/i.test(p.title) ? "irrigador" : /infantil|kids|niñ/i.test(`${text(p, "filtro.tipo")} ${p.title}`) ? "infantil" : "adulto"),
    ...byPrice,
    extra: (a, b) =>
      (text(a, "filtro.tecnologia") && text(b, "filtro.tecnologia") && text(a, "filtro.tecnologia") !== text(b, "filtro.tecnologia") ? 8 : 0) + mismatch(a, b, "filtro.caracteristicas", /app/i, 4),
  },
  "Recortadoras de barba": {
    live: true,
    group: byTitle([[/multifunci[oó]n/i, "multifuncion"]], "barbero"),
    ...byPrice,
    extra: (a, b) => diff(bucket(a, "filtro.autonomia", MINUTES), bucket(b, "filtro.autonomia", MINUTES), 3),
  },
  Básculas: {
    live: true,
    group: byTitle([[/cocina/i, "cocina"], [/precisi[oó]n/i, "precision"], [/equipaje|maleta/i, "equipaje"]], "baño"),
    ...byPrice,
    extra: (a, b) => mismatch(a, b, "filtro.caracteristicas", /análisis corporal/i, 10) + mismatch(a, b, "filtro.conectividad", /bluetooth|wifi/i, 5),
  },
  // Climatización: el tipo de aparato sale del título; donde la potencia decide el uso (radiadores, emisores,
  // termoventiladores), vatios cercanos.
  "Radiadores de aceite": {
    live: true,
    group: byTitle([[/mica/i, "mica"], [/plano/i, "plano"], [/emisor/i, "emisor"]], "aceite"),
    main: watts,
    mainWeight: 0.02,
    steps: [[500, 0.3], [1000, 0.45], [1500, 0.7]],
    extra: (a, b) => mismatch(a, b, "filtro.conectividad", /wifi/i, 5) + mismatch(a, b, "filtro.caracteristicas", /display/i, 3),
  },
  Termoventiladores: {
    live: true,
    group: (p) => (has(p, "filtro.caracteristicas", /montaje en pared/i) || /pared|ba[ñn]o/i.test(p.title) ? "pared" : "suelo"),
    main: watts,
    mainWeight: 0.02,
    steps: [[0, 0.3], [500, 0.45], [1000, 0.7]],
    extra: (a, b) => mismatch(a, b, "filtro.caracteristicas", /cerámico/i, 5) + mismatch(a, b, "filtro.caracteristicas", /oscilación/i, 3),
  },
  Ventiladores: {
    live: true,
    // De techo, portátiles y de ordenador aparte; los de pie, torre, sobremesa y suelo juntos, con su forma pesando.
    group: byTitle([[/techo/i, "techo"], [/port[aá]til|de mano|cuello/i, "portatil"], [/cpu|\bpc\b|disipador/i, "pc"]], "habitacion"),
    ...byPrice,
    extra: (a, b) =>
      (fanShape(a) === fanShape(b) ? 0 : 10) + mismatch(a, b, "filtro.caracteristicas", /mando/i, 3) + mismatch(a, b, "filtro.caracteristicas", /con luz/i, 4),
  },
  "Calefactores eléctricos": {
    live: true,
    group: byTitle([[/mica|radiador/i, "radiador"], [/termoventilador|cer[aá]mico/i, "ventilado"], [/infrarrojos|cuarzo|hal[oó]gen/i, "radiante"]], "calefactor"),
    ...byPrice,
    extra: (a, b) => diff(watts(a), watts(b), 0.005),
  },
  // Estufas: de gas, de exterior y eléctricas (cuarzo, halógenas, infrarrojos) aparte.
  Estufas: {
    live: true,
    group: (p) => (/exterior|terraza/i.test(p.title) || has(p, "filtro.caracteristicas", /exterior/i) ? "exterior" : /\bgas\b|butano/i.test(p.title) ? "gas" : "electrica"),
    ...byPrice,
    extra: (a, b) => diff(watts(a), watts(b), 0.003),
  },
  "Emisores térmicos": {
    live: true,
    group: () => "emisor",
    main: watts,
    mainWeight: 0.02,
    steps: [[0, 0.3], [300, 0.45], [600, 0.7]],
    extra: (a, b) => mismatch(a, b, "filtro.conectividad", /wifi/i, 6) + mismatch(a, b, "filtro.caracteristicas", /programable/i, 3),
  },
  Deshumidificadores: {
    live: true,
    group: () => "deshumidificador",
    main: (p) => fromTitle(p, "L/día") ?? fromTitle(p, "L"),
    mainWeight: 3,
    steps: [[2, 0.3], [5, 0.45], [10, 0.7]],
    extra: (a, b) => mismatch(a, b, "filtro.caracteristicas", /drenaje continuo/i, 4),
  },
  Convectores: { live: true, group: () => "convector", ...byPrice, extra: (a, b) => mismatch(a, b, "filtro.caracteristicas", /turbo/i, 3) },
  "Paneles radiantes": { live: true, group: () => "panel", ...byPrice },
  "Aire acondicionado": { live: true, group: () => "split", ...byPrice, extra: (a, b) => (text(a, "filtro.potencia") === text(b, "filtro.potencia") ? 0 : 15) },
  Humidificadores: { live: true, group: () => "humidificador", ...byPrice },
  "Purificadores de aire": { live: true, group: () => "purificador", ...byPrice, extra: (a, b) => mismatch(a, b, "filtro.caracteristicas", /hepa/i, 6) },
  // Robots aspiradores: los limpiacristales y los que no son robots aparte; pesa el autovaciado.
  "Robots aspiradores": {
    live: true,
    group: byTitle([[/limpiacristales/i, "cristales"], [/^robot/i, "robot"]], "otro"),
    ...byPrice,
    extra: (a, b) => mismatch(a, b, "filtro.caracteristicas", /autovaciado/i, 8),
  },
  Vaporetas: { live: true, group: (p) => (/de mano/i.test(p.title) || (number(text(p, "filtro.capacidad")) ?? 1) < 0.5 ? "mano" : "suelo"), ...byPrice },
  "Almohadillas eléctricas": {
    live: true,
    group: byTitle([[/bolsa de agua/i, "bolsa"]], "almohadilla"),
    ...byPrice,
    extra: (a, b) => diff(bucket(a, "filtro.ancho", GRILL_WIDTH), bucket(b, "filtro.ancho", GRILL_WIDTH), 4),
  },
  "Mantas eléctricas": { live: true, group: (p) => (/2 personas/i.test(text(p, "filtro.mas_especificaciones")) ? "2" : "1"), ...byPrice },
  Calientacamas: { live: true, group: (p) => (/2 personas/i.test(text(p, "filtro.mas_especificaciones")) || /doble/i.test(p.title) ? "2" : "1"), ...byPrice },
  // Imagen, sonido y telefonía: manda el precio y el tipo sale del título; pesan resolución y las funciones que deciden la compra.
  Proyectores: {
    live: true,
    // Tiro corto, portátiles (menos de 1000 lúmenes), de oficina (SVGA, XGA, WXGA…) y de cine en casa aparte.
    group: (p) => {
      if (has(p, "filtro.caracteristicas", /tiro corto/i) || /tiro (ultra)?corto/i.test(p.title)) return "tiro-corto";
      if (/port[aá]til|mini/i.test(p.title) || (fromTitle(p, "lúmenes") ?? 9999) < 1000) return "portatil";
      return /\b(svga|xga|wxga|wuxga)\b/i.test(p.title) ? "oficina" : "cine";
    },
    ...byPrice,
    extra: (a, b) => same(a, b, "filtro.resolucion", 10) + mismatch(a, b, "filtro.caracteristicas", /láser/i, 8) + diff(bucket(a, "filtro.mas_especificaciones", LUMENS), bucket(b, "filtro.mas_especificaciones", LUMENS), 4),
  },
  "Barras de sonido": {
    live: true,
    group: () => "barra",
    ...byPrice,
    extra: (a, b) => mismatch(a, b, "filtro.caracteristicas", /atmos/i, 8) + mismatch(a, b, "filtro.caracteristicas", /subwoofer/i, 6) + mismatch(a, b, "filtro.conectividad", /wifi/i, 3),
  },
  Webcams: {
    live: true,
    group: byTitle([[/videoconferencia/i, "videoconferencia"]], "webcam"),
    ...byPrice,
    extra: (a, b) => same(a, b, "filtro.resolucion", 8) + mismatch(a, b, "filtro.caracteristicas", /autoenfoque/i, 3),
  },
  "Cámaras de fotos": {
    live: true,
    group: byTitle([[/instant[aá]nea/i, "instantanea"], [/sin espejo|r[eé]flex/i, "objetivos"], [/anal[oó]gica/i, "analogica"], [/puente|bridge/i, "puente"]], "compacta"),
    ...byPrice,
  },
  "Cámaras deportivas": {
    live: true,
    group: byTitle([[/dron/i, "dron"], [/gimbal/i, "gimbal"], [/360/i, "360"]], "deportiva"),
    ...byPrice,
    extra: (a, b) => same(a, b, "filtro.resolucion", 6),
  },
  Videocámaras: {
    live: true,
    group: byTitle([[/nvr|grabador/i, "grabador"], [/videoconferencia/i, "videoconferencia"]], "videocamara"),
    ...byPrice,
  },
  Smartphones: {
    live: true,
    group: byTitle([[/mayores|senior/i, "mayores"], [/ranger|rugged|resistente/i, "rugerizado"]], "smartphone"),
    ...byPrice,
    extra: (a, b) => log2diff(gb(a, "filtro.capacidad"), gb(b, "filtro.capacidad"), 8),
  },
  "Smartphones reacondicionados": {
    live: true,
    group: () => "reacondicionado",
    // Todos son iPhone: sin tope por marca.
    perBrand: () => SIMILAR.maxList,
    ...byPrice,
    extra: (a, b) => log2diff(gb(a, "filtro.capacidad"), gb(b, "filtro.capacidad"), 10),
  },
  Consolas: {
    live: true,
    group: byTitle([[/retro/i, "retro"], [/^mando/i, "mando"], [/port[aá]til|switch/i, "portatil"]], "sobremesa"),
    perBrand: () => SIMILAR.maxList,
    ...byPrice,
  },
  Tocadiscos: { live: true, group: (p) => (has(p, "filtro.caracteristicas", /altavoces incluidos/i) || /con altavoces/i.test(p.title) ? "altavoces" : "hifi"), ...byPrice },
  Radios: {
    live: true,
    group: byTitle([[/bolsillo|personal/i, "bolsillo"]], "portatil"),
    ...byPrice,
    extra: (a, b) => mismatch(a, b, "filtro.caracteristicas", /dab/i, 5) + mismatch(a, b, "filtro.conectividad", /bluetooth/i, 3),
  },
  "Radios CD y radiocasetes": { live: true, group: () => "radio-cd", ...byPrice, extra: (a, b) => mismatch(a, b, "filtro.caracteristicas", /cassette/i, 6) },
  Radiodespertadores: {
    live: true,
    group: (p) => (/inteligente|echo|alexa/i.test(p.title) || has(p, "filtro.caracteristicas", /inteligente/i) ? "inteligente" : /^radio/i.test(p.title) ? "radio" : "despertador"),
    ...byPrice,
  },
  "Equipos de música": { live: true, group: () => "equipo", ...byPrice },
  "Teléfonos inalámbricos": {
    live: true,
    group: byTitle([[/\bip\b/i, "ip"], [/sobremesa/i, "sobremesa"]], "inalambrico"),
    ...byPrice,
    extra: (a, b) =>
      mismatch(a, b, "filtro.caracteristicas", /teclas grandes/i, 6) +
      mismatch(a, b, "filtro.caracteristicas", /contestador/i, 4) +
      (/\b(duo|d[uú]o|trio)\b/i.test(a.title) === /\b(duo|d[uú]o|trio)\b/i.test(b.title) ? 0 : 6),
  },
  "Teléfonos fijos": {
    live: true,
    group: byTitle([[/inal[aá]mbrico/i, "inalambrico"]], "sobremesa"),
    ...byPrice,
    extra: (a, b) => mismatch(a, b, "filtro.caracteristicas", /teclas grandes/i, 6) + mismatch(a, b, "filtro.caracteristicas", /pared/i, 3),
  },
  "Pulseras de actividad": {
    live: true,
    group: byTitle([[/apple watch/i, "apple"], [/infantil/i, "infantil"], [/smartwatch/i, "smartwatch"], [/pectoral/i, "pectoral"], [/sueño/i, "sueño"]], "pulsera"),
    perBrand: (group) => (group === "apple" ? SIMILAR.maxList : SIMILAR.perBrand),
    ...byPrice,
  },
  eBooks: {
    live: true,
    group: () => "ebook",
    ...byPrice,
    extra: (a, b) => mismatch(a, b, "filtro.caracteristicas", /pantalla a color/i, 8) + diff(inches(a), inches(b), 3),
  },
  "TV Box y sticks de TV": { live: true, group: () => "tvbox", ...byPrice, extra: (a, b) => same(a, b, "filtro.resolucion", 5) },
  "Navegadores GPS": {
    live: true,
    group: byTitle([[/cami[oó]n|autocaravana/i, "camion"], [/moto/i, "moto"], [/de mano|senderismo|outdoor/i, "mano"]], "coche"),
    ...byPrice,
    extra: (a, b) => diff(inches(a), inches(b), 3),
  },
  Micrófonos: {
    live: true,
    group: (p) => {
      const kind = `${text(p, "filtro.tipo")} ${p.title}`;
      if (/karaoke/i.test(kind)) return "karaoke";
      if (/solapa|lavalier/i.test(kind)) return "solapa";
      if (/conferencia/i.test(kind)) return "conferencias";
      return /inal[aá]mbrico|sistema de/i.test(p.title) ? "inalambrico" : "escritorio";
    },
    ...byPrice,
    extra: (a, b) => mismatch(a, b, "filtro.conectividad", /usb/i, 4),
  },
  // Videovigilancia: cámaras aparte de grabadores, kits y accesorios (soportes, paneles solares, cables); en las cámaras
  // pesan exterior/interior, resolución y wifi.
  Videovigilancia: {
    live: true,
    group: byTitle([[/^c[aá]mara/i, "camara"], [/^kit/i, "kit"], [/grabador|nvr|dvr/i, "grabador"]], "accesorio"),
    ...byPrice,
    extra: (a, b) => mismatch(a, b, "filtro.caracteristicas", /exterior/i, 10) + same(a, b, "filtro.resolucion", 5) + mismatch(a, b, "filtro.conectividad", /wifi/i, 3),
  },
  // Componentes de PC: lo que decide la compatibilidad va en el grupo y sale del título, porque los filtros casi no
  // traen datos: zócalo en procesadores y placas, DDR y formato en memoria, fabricante del chip en gráficas.
  "Tarjetas gráficas": {
    live: true,
    group: (p) => (/rtx|gtx|geforce|\bgt \d/i.test(p.title) ? "nvidia" : /radeon|\brx ?\d/i.test(p.title) ? "amd" : /\barc\b/i.test(p.title) ? "intel" : "otra"),
    ...byPrice,
    extra: (a, b) => (gpuChip(a) && gpuChip(b) && gpuChip(a) !== gpuChip(b) ? 12 : 0) + log2diff(fromTitle(a, "GB"), fromTitle(b, "GB"), 8),
  },
  // Compatibilidad: ni al rellenar se sale del zócalo; y sin tope por marca (solo hay AMD e Intel).
  Procesadores: {
    live: true,
    strict: true,
    perBrand: () => SIMILAR.maxList,
    group: (p) => socket(p) ?? "sin zócalo",
    ...byPrice,
    extra: (a, b) => log2diff(fromTitle(a, "núcleos"), fromTitle(b, "núcleos"), 8),
  },
  "Memoria RAM": {
    live: true,
    // DDR, SO-DIMM (portátil) o DIMM, y ECC (servidor): si no coinciden, no encaja.
    strict: true,
    group: (p) => `${p.title.match(/ddr\d/i)?.[0].toUpperCase() ?? "DDR?"}/${/so-?dimm/i.test(p.title) ? "sodimm" : "dimm"}/${/\becc\b|rdimm|registered/i.test(p.title) ? "ecc" : "normal"}`,
    main: (p) => log2(gb(p, "filtro.memoria_ram") ?? fromTitle(p, "GB")),
    mainWeight: 25,
    steps: [[0, 0.3], [1, 0.45], [1, 0.7]],
    extra: (a, b) => diff(fromTitle(a, "MT/s") ?? fromTitle(a, "MHz"), fromTitle(b, "MT/s") ?? fromTitle(b, "MHz"), 0.01) + mismatch(a, b, "filtro.caracteristicas", /rgb/i, 3),
  },
  "Placas base": {
    live: true,
    strict: true,
    group: (p) => (/tpm/i.test(p.title) ? "accesorio" : socket(p) ?? "sin zócalo"),
    ...byPrice,
    extra: (a, b) =>
      (boardFormat(a) === boardFormat(b) ? 0 : 15) +
      (/ddr\d/i.test(a.title) && /ddr\d/i.test(b.title) && a.title.match(/ddr\d/i)![0].toLowerCase() !== b.title.match(/ddr\d/i)![0].toLowerCase() ? 15 : 0) +
      (/wi-?fi/i.test(a.title) === /wi-?fi/i.test(b.title) ? 0 : 4),
  },
  "Fuentes de alimentación": {
    live: true,
    group: byTitle([[/\bsfx/i, "sfx"], [/adaptador/i, "adaptador"]], "atx"),
    main: watts,
    mainWeight: 0.05,
    steps: [[0, 0.3], [100, 0.45], [200, 0.7]],
    extra: (a, b) => diff(bucket(a, "filtro.mas_especificaciones", PSU_CERT), bucket(b, "filtro.mas_especificaciones", PSU_CERT), 4) + mismatch(a, b, "filtro.caracteristicas", /modular/i, 4),
  },
  "Cajas de ordenador": {
    live: true,
    group: (p) => {
      if (/e-atx|torre completa|full tower/i.test(p.title)) return "grande";
      if (/mini[ -]?itx/i.test(p.title) && !/\batx\b/i.test(p.title.replace(/mini[ -]?itx|micro atx/gi, ""))) return "itx";
      if (/micro atx|minitorre|m-atx/i.test(p.title) && !/semitorre/i.test(p.title)) return "micro";
      return "atx";
    },
    ...byPrice,
    extra: (a, b) => mismatch(a, b, "filtro.caracteristicas", /cristal/i, 4) + mismatch(a, b, "filtro.caracteristicas", /rgb/i, 3) + (text(a, "filtro.color") === text(b, "filtro.color") ? 0 : 5),
  },
  // Red: el aparato sale del título (en estas familias conviven routers, puntos de acceso, mesh, accesorios…).
  Routers: {
    live: true,
    group: byTitle([[/kit de montaje|soporte|antena/i, "accesorio"], [/punto de acceso/i, "punto-acceso"], [/mesh/i, "mesh"], [/\b[45]g\b/i, "movil"]], "router"),
    ...byPrice,
    extra: (a, b) => (wifiGen(a) && wifiGen(b) && wifiGen(a) !== wifiGen(b) ? 6 : 0) + mismatch(a, b, "filtro.caracteristicas", /poe/i, 4),
  },
  "Repetidores y sistemas wifi mesh": {
    live: true,
    group: byTitle([[/punto de acceso/i, "punto-acceso"], [/mesh/i, "mesh"], [/plc/i, "plc"], [/puente/i, "puente"], [/adaptador|usb/i, "adaptador"], [/antena/i, "antena"]], "repetidor"),
    ...byPrice,
    extra: (a, b) => (wifiGen(a) && wifiGen(b) && wifiGen(a) !== wifiGen(b) ? 6 : 0),
  },
  "Switches y hubs": {
    live: true,
    group: (p) => {
      if (/kvm/i.test(p.title)) return "kvm";
      if (/hub|concentrador/i.test(p.title)) return "hub";
      if (/sfp|transceptor/i.test(p.title) && !/switch/i.test(p.title)) return "sfp";
      if (/conversor|convertidor/i.test(p.title)) return "conversor";
      if (/inyector/i.test(p.title)) return "inyector";
      if (/hdmi|conmutador|displayport/i.test(p.title) && !/switch.*puertos/i.test(p.title)) return "video";
      return "switch";
    },
    main: (p) => log2(fromTitle(p, "puertos")),
    mainWeight: 20,
    steps: [[0, 0.3], [0.6, 0.45], [1.1, 0.7]],
    extra: (a, b) =>
      mismatch(a, b, "filtro.caracteristicas", /poe/i, 10) + (/gestionable|administrable/i.test(a.title.replace(/no (gestionable|administrado)/i, "")) === /gestionable|administrable/i.test(b.title.replace(/no (gestionable|administrado)/i, "")) ? 0 : 8) + mismatch(a, b, "filtro.caracteristicas", /rack/i, 3),
  },
  "Servidores y NAS": {
    live: true,
    group: byTitle([[/\bnas\b/i, "nas"], [/servidor/i, "servidor"], [/expansi[oó]n/i, "expansion"]], "otro"),
    main: (p) => log2(fromTitle(p, "bahías")),
    mainWeight: 15,
    steps: [[0, 0.3], [1, 0.45], [1.6, 0.7]],
    extra: (a, b) => mismatch(a, b, "filtro.caracteristicas", /rack/i, 10),
  },
  "Tarjetas de red": {
    live: true,
    group: byTitle([[/wi-?fi|bluetooth/i, "wifi"], [/sfp|qsfp|fibra/i, "fibra"], [/serie|rs-?232/i, "serie"], [/^router|^repetidor/i, "otro"], [/usb/i, "usb"]], "ethernet"),
    ...byPrice,
    extra: (a, b) => diff(fromTitle(a, "puertos"), fromTitle(b, "puertos"), 4),
  },
  Escáneres: { live: true, group: byTitle([[/port[aá]til/i, "portatil"], [/plano/i, "plano"]], "documentos"), ...byPrice },
  TPV: {
    live: true,
    group: byTitle([[/lector/i, "lector"], [/caj[oó]n/i, "cajon"], [/visor/i, "visor"], [/cinta|etiquetas/i, "consumible"], [/impresora/i, "impresora"], [/^kit/i, "kit"], [/tpv/i, "tpv"]], "otro"),
    ...byPrice,
    extra: (a, b) => diff(inches(a), inches(b), 3),
  },
  // Periféricos y gaming: gaming o no va en el grupo; pesan inalámbrico y lo que cambia el uso.
  Ratones: {
    live: true,
    group: (p) => (/gaming/i.test(p.title) || has(p, "filtro.caracteristicas", /gaming/i) ? "gaming" : "normal"),
    ...byPrice,
    extra: (a, b) => (isWireless(a) === isWireless(b) ? 0 : 8) + mismatch(a, b, "filtro.caracteristicas", /silencioso/i, 3) + mismatch(a, b, "filtro.caracteristicas", /recargable/i, 3),
  },
  Teclados: {
    live: true,
    group: (p) => (/funda/i.test(p.title) ? "funda" : /^kit|rat[oó]n/i.test(p.title) ? "kit" : /gaming|mec[aá]nico/i.test(p.title) || has(p, "filtro.caracteristicas", /gaming/i) ? "gaming" : "normal"),
    ...byPrice,
    extra: (a, b) => (layout(a) === layout(b) ? 0 : 40) + (isWireless(a) === isWireless(b) ? 0 : 8) + mismatch(a, b, "filtro.caracteristicas", /numérico/i, 4) + mismatch(a, b, "filtro.caracteristicas", /retroiluminado/i, 3),
  },
  "Packs de teclado y ratón": {
    live: true,
    group: (p) => (!/^kit|pack|rat[oó]n/i.test(p.title) ? "teclado" : /gaming/i.test(p.title) || has(p, "filtro.caracteristicas", /gaming/i) ? "gaming" : "normal"),
    ...byPrice,
    extra: (a, b) => (layout(a) === layout(b) ? 0 : 40) + (isWireless(a) === isWireless(b) ? 0 : 8) + mismatch(a, b, "filtro.caracteristicas", /silencioso/i, 3),
  },
  "Sillas gaming": {
    live: true,
    group: byTitle([[/oficina/i, "oficina"]], "gaming"),
    ...byPrice,
    extra: (a, b) => mismatch(a, b, "filtro.caracteristicas", /malla/i, 4) + mismatch(a, b, "filtro.caracteristicas", /4D/i, 3),
  },
  "Mesas gaming": {
    live: true,
    group: (p) => (/elevable|de pie/i.test(p.title) || has(p, "filtro.caracteristicas", /altura regulable/i) ? "elevable" : "fija"),
    ...byPrice,
    extra: (a, b) => same(a, b, "filtro.ancho", 5),
  },
  "Volantes gaming": { live: true, group: byTitle([[/volante/i, "volante"], [/palanca/i, "palanca"]], "mando"), ...byPrice },
  Joysticks: { live: true, group: () => "mando", ...byPrice, extra: (a, b) => (isWireless(a) === isWireless(b) ? 0 : 6) },
  // Almacenamiento portátil: misma capacidad primero.
  "Memorias USB": {
    live: true,
    group: () => "usb",
    main: (p) => log2(gb(p, "filtro.capacidad") ?? fromTitle(p, "GB")),
    mainWeight: 25,
    steps: [[0, 0.3], [1, 0.45], [1, 0.7]],
    extra: (a, b) => mismatch(a, b, "filtro.caracteristicas", /usb-c/i, 6) + diff(bucket(a, "filtro.mas_especificaciones", READ_SPEED), bucket(b, "filtro.mas_especificaciones", READ_SPEED), 3),
  },
  "Tarjetas de memoria": {
    live: true,
    group: byTitle([[/micro ?sd/i, "microsd"], [/\bsd\b/i, "sd"]], "otra"),
    main: (p) => log2(gb(p, "filtro.capacidad") ?? fromTitle(p, "GB")),
    mainWeight: 25,
    steps: [[0, 0.3], [1, 0.45], [1, 0.7]],
    extra: (a, b) => diff(bucket(a, "filtro.mas_especificaciones", READ_SPEED), bucket(b, "filtro.mas_especificaciones", READ_SPEED), 3),
  },
  "Pantallas táctiles": { live: true, group: () => "pantalla", main: inches, mainWeight: 1, steps: [[0, 0.3], [10, 0.45], [20, 0.7]] },
  // Oficina y varios.
  Calculadoras: { live: true, group: (p) => text(p, "filtro.tipo") || byTitle([[/cient[ií]fica/i, "Científica"], [/impresora/i, "Impresora"], [/bolsillo/i, "Bolsillo"]], "Sobremesa")(p), ...byPrice },
  "Destructoras de papel": { live: true, group: () => "destructora", ...byPrice, extra: (a, b) => same(a, b, "filtro.tipo", 5) },
  "Walkie-talkies": { live: true, group: () => "walkie", ...byPrice },
  "Reproductores MP3 y MP4": { live: true, group: byTitle([[/^reproductor/i, "reproductor"]], "otro"), ...byPrice },
  // Menaje y pequeño electro restante.
  Sartenes: {
    live: true,
    group: (p) => (/wok/i.test(`${text(p, "filtro.tipo")} ${p.title}`) ? "wok" : /grill|parrilla/i.test(`${text(p, "filtro.tipo")} ${p.title}`) ? "grill" : "sarten"),
    main: (p) => fromTitle(p, "cm") ?? number(text(p, "filtro.ancho")),
    mainWeight: 3,
    steps: [[0, 0.3], [2, 0.45], [4, 0.7]],
    extra: (a, b) => mismatch(a, b, "filtro.caracteristicas", /inducción/i, 8) + same(a, b, "filtro.material", 5),
  },
  "Ollas, cacerolas y cazos": {
    live: true,
    group: byTitle([[/presi[oó]n|r[aá]pida/i, "presion"]], "olla"),
    main: (p) => fromTitle(p, "L") ?? number(text(p, "filtro.capacidad")),
    mainWeight: 6,
    steps: [[0.5, 0.3], [1.5, 0.45], [3, 0.7]],
    extra: (a, b) => mismatch(a, b, "filtro.caracteristicas", /inducción/i, 8) + same(a, b, "filtro.material", 4),
  },
  "Baterías de cocina": { live: true, group: () => "bateria", main: (p) => fromTitle(p, "piezas") ?? number(text(p, "filtro.capacidad")), mainWeight: 5, steps: [[1, 0.3], [2, 0.45], [4, 0.7]] },
  Paelleras: {
    live: true,
    group: byTitle([[/el[eé]ctrica/i, "electrica"]], "recipiente"),
    main: (p) => fromTitle(p, "cm") ?? number(text(p, "filtro.ancho")),
    mainWeight: 1,
    steps: [[4, 0.3], [10, 0.45], [20, 0.7]],
  },
  Termos: { live: true, group: () => "termo", main: (p) => number(text(p, "filtro.capacidad")) ?? fromTitle(p, "L"), mainWeight: 20, steps: [[0, 0.3], [0.5, 0.45], [1, 0.7]] },
  "Carros de la compra": { live: true, group: (p) => (/ruedas 2/i.test(text(p, "filtro.mas_especificaciones")) ? "2" : "4"), ...byPrice },
  "Envasadoras al vacío": { live: true, group: () => "envasadora", ...byPrice },
  "Gofreras y creperas": { live: true, group: byTitle([[/crep/i, "crepera"]], "gofrera"), ...byPrice },
  Cortafiambres: { live: true, group: () => "cortafiambres", ...byPrice },
  Quitapelusas: { live: true, group: () => "quitapelusas", ...byPrice },
  "Tablas de planchar": { live: true, group: byTitle([[/^tabla/i, "tabla"]], "otro"), ...byPrice },
  "Jarras purificadoras de agua": { live: true, group: () => "jarra", ...byPrice },
  // Accesorios.
  "Cartuchos de tinta": consumable,
  "Tóner": consumable,
  Cables: {
    live: true,
    group: cableGroup,
    main: (p) => log2(cableLength(p)),
    mainWeight: 15,
    steps: [[0.6, 0.5], [1.1, 0.8], [2, 1.5]],
    extra: (a, b) => diff(netCategory(a), netCategory(b), 6) + same(a, b, "filtro.resolucion", 8) + same(a, b, "filtro.color", 2),
    // Un cable con otros conectores no sirve: las listas cortas no se rellenan con otros grupos.
    strict: true,
  },
  "Soportes de TV y monitor": {
    live: true,
    group: mountGroup,
    main: (p) => screenRange(p)[1],
    mainWeight: 1.5,
    steps: [[5, 0.4], [10, 0.7], [20, 1.2]],
    extra: (a, b) => diff(screenRange(a)[0], screenRange(b)[0], 0.5) + diff(mountMotion(a), mountMotion(b), 10) + diff(fromTitle(a, "kg"), fromTitle(b, "kg"), 0.2),
    strict: true,
  },
};

export const SIMILAR_TYPES = Object.keys(RULES);

// `preview`: calcula también las familias aún no publicadas, para preparar la muestra que revisa David.
export function computeSimilars(rows: SimilarProduct[], options: { preview?: boolean } = {}) {
  const result = new Map<string, string[]>();
  const byType = new Map<string, SimilarProduct[]>();
  for (const row of rows) if (RULES[row.t] && (RULES[row.t].live || options.preview)) byType.set(row.t, [...(byType.get(row.t) ?? []), row]);
  for (const [type, products] of byType) {
    const rule = RULES[type];
    const info = new Map(products.map((p) => [p.pid, { group: rule.group(p), main: rule.main(p) }]));
    for (const p of products) {
      const me = info.get(p.pid)!;
      if (!(p.pvp > 0)) continue;
      const priceGap = (q: SimilarProduct) => Math.abs(q.pvp - p.pvp) / p.pvp;
      const mainGap = (q: SimilarProduct) => {
        const other = info.get(q.pid)!.main;
        return me.main === null || other === null ? null : Math.abs(other - me.main);
      };
      const perBrand = rule.perBrand?.(me.group) ?? SIMILAR.perBrand;
      // Rellena la lista en el orden dado: sin el propio ni títulos repetidos (hay duplicados en la tienda) y con tope por marca.
      const fill = (list: string[], pool: SimilarProduct[]) => {
        const titles = new Set([p.title, ...list.map((pid) => products.find((q) => q.pid === pid)!.title)].map((t) => t.toLowerCase()));
        const brands = new Map<string, number>();
        for (const pid of list) {
          const brand = (products.find((q) => q.pid === pid)!.marca ?? "").toUpperCase();
          brands.set(brand, (brands.get(brand) ?? 0) + 1);
        }
        for (const q of pool) {
          if (list.length === SIMILAR.maxList) break;
          if (list.includes(q.pid) || titles.has(q.title.toLowerCase())) continue;
          titles.add(q.title.toLowerCase());
          const brand = (q.marca ?? "").toUpperCase();
          if ((brands.get(brand) ?? 0) >= perBrand) continue;
          brands.set(brand, (brands.get(brand) ?? 0) + 1);
          list.push(q.pid);
        }
        return list;
      };
      const available = products.filter((q) => q.pid !== p.pid && q.stock > 0 && q.pvp > 0);
      let list: string[] = [];
      if (me.main !== null) {
        const candidates = available.filter((q) => info.get(q.pid)!.group === me.group && info.get(q.pid)!.main !== null && (!rule.match || rule.match(p, q)));
        const score = (q: SimilarProduct) => mainGap(q)! * rule.mainWeight + priceGap(q) * SIMILAR.priceWeight + (rule.extra?.(p, q) ?? 0);
        for (const [mainTol, priceTol] of rule.steps) {
          const pool = candidates
            .filter((q) => mainGap(q)! <= mainTol && priceGap(q) <= priceTol)
            .map((q) => ({ q, s: score(q) }))
            .sort((a, b) => a.s - b.s || a.q.pid.localeCompare(b.q.pid))
            .map(({ q }) => q);
          list = fill([], pool);
          if (list.length >= SIMILAR.minList) break;
        }
      }
      // Si se queda en menos de 3 (o no tiene el dato principal), se completa con lo más parecido de la misma familia,
      // primero de su grupo, aunque se salga de los márgenes: si no, Shopify rellena con productos de cualquier cosa.
      if (list.length < SIMILAR.minFallback) {
        const fallback = (q: SimilarProduct) =>
          (info.get(q.pid)!.group === me.group ? 0 : SIMILAR.otherGroup) + (mainGap(q) ?? 0) * rule.mainWeight + priceGap(q) * SIMILAR.priceWeight + (rule.extra?.(p, q) ?? 0);
        const pool = available
          .filter((q) => priceGap(q) <= SIMILAR.fallbackPrice && (!rule.strict || info.get(q.pid)!.group === me.group) && (!rule.match || rule.match(p, q)))
          .map((q) => ({ q, s: fallback(q) }))
          .sort((a, b) => a.s - b.s || a.q.pid.localeCompare(b.q.pid))
          .map(({ q }) => q);
        list = fill(list, pool);
      }
      if (list.length) result.set(p.pid, list);
    }
  }
  return result;
}
