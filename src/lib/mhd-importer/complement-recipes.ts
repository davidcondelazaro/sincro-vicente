// Recetas de complementos por familia (David, 2026-10-31; docs/SINCRONIZACIONES_MHD.md). Funciones puras: reciben los
// productos con sus datos de Icecat y devuelven, por cada aparato, un complemento por hueco. Sin IA. Filtro duro de
// compatibilidad (sin dato no hay sugerencia), stock mínimo de 5 para entrar y nota sobre 100: precio proporcionado 50,
// stock 30, misma marca 20. Lo que ya está sugerido se queda mientras siga siendo válido y tenga stock, para que las
// fichas no cambien cada día porque se mueva el stock. Se cruza siempre por producto, nunca por título: hay títulos repetidos.
export type RecipeProduct = { pid: string; t: string; title: string; pvp: number; stock: number; marca: string | null; txt: string | null; a: Record<string, string> | null };
export type Slot = { slot: string; pid: string };
type Item = RecipeProduct & { a: Record<string, string>; txt: string; lower: string };
type Pair = [number, number];
type Mount = Item & { ma: Pair; mi: Pair; list: Set<string> | null; minMax: boolean; cap: number; ti: number; ta: number; lockedBrand: string | null };

export const RECIPES = { minStock: 5, keepStock: 1, maxList: 10 };
export const RECIPE_TYPES = ["Televisores", "Portátiles", "Monitores", "Soportes de TV y monitor", "Barras de sonido", "Cables", "Regletas", "Fundas y maletines para portátiles", "Mochilas para portátiles", "Ratones", "Bases y replicadores de puertos", "Packs de teclado y ratón", "Limpieza para electrónica"];

const TV_BRANDS = /samsung|\blg\b|sony|philips|hisense|tcl|panasonic|xiaomi/;
const LAPTOP_BRANDS = /\b(hp|lenovo|dell|asus|acer|apple|samsung|lg|msi|microsoft|medion|gigabyte|huawei)\b/;
const MONITOR_BRANDS = /\b(hp|lenovo|dell|asus|acer|apple|samsung|lg|msi|philips|benq|aoc|viewsonic|gigabyte|iiyama|sony|xiaomi)\b/;
const GAMING = /gaming|\brog\b|\btuf\b|nitro|legion|victus|omen|katana|predator|\bloq\b|cyborg/;

const decimal = (text: string) => parseFloat(text.replace(",", "."));
const key = (w: number, h: number) => `${w}x${h}`;
const brandOf = (text: string, brands: RegExp) => brands.exec(text)?.[0] ?? null;
const startsYes = (a: Record<string, string>, name: string) => String(a[name] ?? "").toLowerCase().startsWith("s");
function number(value: unknown) {
  if (value === null || value === undefined) return null;
  let text = String(value);
  if (/\d\.\d{3}\b/.test(text)) text = text.replaceAll(".", "");
  const match = /[\d.,]+/.exec(text);
  if (!match) return null;
  const parsed = decimal(match[0]);
  return Number.isNaN(parsed) ? null : parsed;
}
function pair(value: string | undefined): Pair | null {
  const match = /(\d+)\s*[x×]\s*(\d+)/.exec(value ?? "");
  return match ? [Number(match[1]), Number(match[2])] : null;
}
function diagonal(value: string | undefined) {
  const match = /\(([\d.,]+)"/.exec(value ?? "");
  return match ? decimal(match[1]) : null;
}
function titleInches(title: string) {
  const match = /(\d{1,2}(?:[.,]\d)?)"/.exec(title);
  return match ? decimal(match[1]) : null;
}
function metres(title: string) {
  const match = /([\d.,]+)\s*m\b/.exec(title);
  return match ? decimal(match[1]) : null;
}

// Nota sobre 100. `lo` y `hi` son la banda de precio razonable respecto al aparato.
function score(item: Item, target: Item, lo: number, hi: number, sameBrand: boolean) {
  const center = Math.sqrt(lo * hi);
  const price = 50 * Math.max(0, 1 - Math.abs(Math.log(item.pvp / target.pvp / center)) / Math.log(hi / center) / 2);
  return Math.round((price + 30 * Math.min(item.stock, 20) / 20 + (sameBrand ? 20 : 0)) * 10) / 10;
}

// Elige uno por hueco: lo ya sugerido si sigue siendo compatible, y si no el de mejor nota con stock suficiente.
function chooser(previous: string[]) {
  const slots: Slot[] = [];
  return {
    slots,
    pick(slot: string, candidates: Item[], rank: (item: Item) => number[]) {
      // Por orden de la lista: la receta va delante de lo de Icecat, y un hueco no debe quedarse con un extra de Icecat.
      const usable = new Map(candidates.filter((item) => item.stock >= RECIPES.keepStock).map((item) => [item.pid, item]));
      const kept = usable.get(previous.find((pid) => usable.has(pid)) ?? "");
      const best = kept ?? candidates.filter((item) => item.stock >= RECIPES.minStock)
        .map((item) => ({ item, order: rank(item) }))
        .sort((a, b) => { for (let i = 0; i < a.order.length; i += 1) if (a.order[i] !== b.order[i]) return b.order[i] - a.order[i]; return 0; })[0]?.item;
      if (best) slots.push({ slot, pid: best.pid });
    },
  };
}

function mount(item: Item): Mount | null {
  const { a } = item;
  const ma = pair(a["Compatibilidad con interfaz de montaje (max)"]) ?? pair(a["Interfaz de panel de montaje"]);
  const mi = pair(a["Compatibilidad con interfaz de montaje (min)"]) ?? ma;
  const cap = number(a["Capacidad máxima de peso (por display)"] ?? a["Capacidad máxima de peso"]);
  const ti = diagonal(a["Tamaño mínimo de pantalla"]);
  const ta = diagonal(a["Tamaño máximo de pantalla"]);
  if (!ma || !mi || cap === null || ti === null || ta === null) return null;
  const minMax = ma[0] === mi[0] && ma[1] === mi[1];
  let list: Set<string> | null = null;
  // Icecat da a veces un único VESA: se contrasta con la lista del texto de MHD.
  if (minMax) {
    const found = new Set([...item.txt.matchAll(/(\d{2,3})\s*[x×]\s*(\d{2,3})/g)].map((m) => [Number(m[1]), Number(m[2])]).filter(([w, h]) => w >= 50 && w <= 1000 && h >= 50 && h <= 1000).map(([w, h]) => key(w, h)));
    if (found.size > 1) list = found;
  }
  return { ...item, ma, mi, list, minMax, cap, ti, ta, lockedBrand: null };
}

function televisions(items: Item[], previous: Map<string, string[]>) {
  const mounts: (Mount & { articulated: boolean })[] = [];
  for (const item of items.filter((x) => x.t.startsWith("Soportes"))) {
    const { a, lower } = item;
    const type = String(a["Tipo de montaje"] ?? "");
    if (/tablet|antirrobo|proyector|barra de sonido|altavoz|port[aá]til|microondas|consola|techo/.test(lower)) continue;
    if (/escritorio|mesa|abrazadera|poste/.test(type.toLowerCase()) || lower.includes("monitor") || String(a["Número de pantallas soportadas"] ?? "1") !== "1") continue;
    if (/piso|suelo|techo/i.test(`${type} ${lower}`) || !(/pared/i.test(`${type} ${lower}`) || type === "")) continue;
    const base = mount(item);
    if (!base) continue;
    const reach = String(a["Alcance de bandeja"] ?? "");
    const articulated = startsYes(a, "Giratorio") || Boolean(a["Ángulo de giro (alcance)"]) || (Boolean(reach) && !reach.startsWith("0 - 0")) || /orientable|giratori|articulad/.test(`${lower} ${item.txt.toLowerCase().slice(0, 200)}`);
    mounts.push({ ...base, lockedBrand: brandOf(lower, TV_BRANDS), articulated });
  }
  const soundbars = items.filter((x) => x.t === "Barras de sonido" && !/soporte|mando/i.test(x.title));
  const ownBrands = new Set(soundbars.filter((x) => x.stock >= RECIPES.minStock).map((x) => brandOf(x.lower, TV_BRANDS)));
  const cables = items.filter((x) => x.t === "Cables" && /hdmi/i.test(x.title) && !/micro|mini|dvi|vga|displayport|\bdp\b|usb|adaptador|hembra|\bh\/|m\/h|f\/m|fibra|óptico|antena|extensor|splitter|conmutador|rj/i.test(x.title))
    .map((x) => ({ ...x, length: metres(x.title), for4k: /4k|8k|2\.[01]|alta velocidad|ultra/i.test(`${x.title} ${x.txt}`) })).filter((x) => x.length !== null && x.length >= 1.5 && x.length <= 2);
  const strips = items.filter((x) => x.t === "Regletas" && !/inteligente|pdu|rack|19"|c13|c20|usb/i.test(x.title) && Number(/(\d+)\s*tomas/.exec(x.title)?.[1] ?? 0) >= 4 && x.lower.startsWith("regleta"));
  const result = new Map<string, Slot[]>();
  for (const tv of items.filter((x) => x.t === "Televisores")) {
    const inches = diagonal(tv.a["Diagonal de la pantalla"]);
    const vesa = pair(tv.a["Interfaz de panel de montaje"]);
    const kg = number(tv.a["Peso (sin base)"] ?? tv.a["Peso (con soporte)"]);
    if (!inches || !vesa || !kg) continue;
    const resolution = String(tv.a["Resolución de la pantalla"] ?? "");
    const is4k = /4k|uhd|8k/i.test(`${tv.title} ${resolution}`) || (pair(resolution)?.[0] ?? 0) >= 3840;
    const brand = brandOf(tv.lower, TV_BRANDS);
    const same = (x: Item) => Boolean(x.marca && tv.marca && x.marca.toLowerCase() === tv.marca.toLowerCase());
    const fits = (s: Mount) => {
      const [w, h] = vesa;
      if (s.list) { if (!(s.list.has(key(w, h)) || (w <= s.ma[0] && h <= s.ma[1] && [...s.list].some((v) => { const [a, b] = v.split("x").map(Number); return a <= w && b <= h; })))) return false; }
      else if (s.minMax || !(s.mi[0] <= w && w <= s.ma[0] && s.mi[1] <= h && h <= s.ma[1])) return false;
      return kg * 1.2 <= s.cap && s.ti <= inches && inches <= s.ta && (!s.lockedBrand || tv.lower.includes(s.lockedBrand)) && s.pvp <= tv.pvp * 0.15;
    };
    const { slots, pick } = chooser(previous.get(tv.pid) ?? []);
    const fitting = mounts.filter(fits);
    pick("Soporte fijo o inclinable", fitting.filter((s) => !s.articulated), (x) => [score(x, tv, 0.03, 0.15, same(x))]);
    pick("Soporte articulado", fitting.filter((s) => s.articulated), (x) => [score(x, tv, 0.03, 0.15, same(x))]);
    pick("Barra de sonido", soundbars.filter((b) => {
      const maker = brandOf(b.lower, TV_BRANDS);
      const watts = /(\d[\d,]*) W\b/.exec(b.title);
      return b.pvp >= tv.pvp * 0.08 && b.pvp <= tv.pvp * 0.4 && (maker === null || maker === brand || !ownBrands.has(brand)) && watts !== null && decimal(watts[1]) >= 40;
    }), (x) => [brand !== null && x.lower.includes(brand) ? 1 : 0, score(x, tv, 0.1, 0.4, same(x))]);
    pick("Cable HDMI", cables.filter((c) => c.pvp <= 15 && (c.for4k || !is4k)), (x) => [score(x, tv, 0.002, 0.03, same(x))]);
    pick("Regleta", strips.filter((r) => r.pvp <= 35), (x) => [/protec|sobretens|interruptor/i.test(`${x.title} ${x.txt}`) ? 1 : 0, score(x, tv, 0.005, 0.06, same(x))]);
    result.set(tv.pid, slots);
  }
  return result;
}

function laptops(items: Item[], previous: Map<string, string[]>) {
  const fab = (x: Item) => brandOf(x.lower, LAPTOP_BRANDS);
  const bags = items.filter((x) => (x.t.startsWith("Fundas") || x.t.startsWith("Mochilas")) && !/tablet|ipad|ebook|móvil|kindle|consola/.test(x.lower))
    .map((x) => ({ ...x, max: diagonal(x.a["Tamaño máximo de pantalla"]) ?? titleInches(x.title), kind: x.lower.includes("mochila") ? "mochila" : /funda|maletín/.test(x.lower) ? "funda" : null, onlyMac: x.lower.includes("macbook") }))
    .filter((x): x is typeof x & { max: number } => Boolean(x.max) && x.kind !== null);
  const mice = items.filter((x) => x.t === "Ratones" && !/alfombrilla|presentador|trackball|vertical|mini |niño|lápiz|teclado/.test(x.lower))
    .map((x) => ({ ...x, wireless: /inalámbrico|bluetooth/.test(x.lower), gaming: /gaming|mars|razer|corsair|hyperx|steelseries|krom|ozone/.test(x.lower), mac: startsYes(x.a, "Sistema operativo MAC soportado"), bluetooth: `${x.lower} ${String(x.a["Interfaz del dispositivo"] ?? "").toLowerCase()}`.includes("bluetooth") }));
  const docks = items.filter((x) => x.t === "Bases y replicadores de puertos" && /^(base de conexión|docking)/.test(x.lower) && /usb-?c|thunderbolt/.test(`${x.lower} ${String(x.a["Interfaz de host"] ?? "").toLowerCase()}`) && !x.lower.includes("kvm"));
  const result = new Map<string, Slot[]>();
  for (const laptop of items.filter((x) => x.t === "Portátiles")) {
    const inches = diagonal(laptop.a["Diagonal de la pantalla"]) ?? titleInches(laptop.title);
    if (!inches) continue;
    const brand = fab(laptop);
    const isMac = brand === "apple";
    const isGaming = GAMING.test(laptop.lower);
    const json = JSON.stringify(laptop.a).toLowerCase();
    const usbC = startsYes(laptop.a, "USB Type-C DisplayPort Alternate Mode") || json.includes("thunderbolt") || laptop.lower.includes("thunderbolt");
    const usbA = Object.entries(laptop.a).some(([name, value]) => /tipo A|USB 2\.0/.test(name) && Number(/^\d+/.exec(String(value))?.[0] ?? 0) > 0);
    const allowed = (x: Item) => fab(x) === null || fab(x) === brand;
    const rank = (lo: number, hi: number) => (x: Item) => [score(x, laptop, lo, hi, Boolean(brand) && fab(x) === brand)];
    const bag = (x: (typeof bags)[number], slack: number) => allowed(x) && inches <= x.max && x.max <= inches + slack && x.pvp <= laptop.pvp * 0.08 && (!x.onlyMac || isMac);
    const { slots, pick } = chooser(previous.get(laptop.pid) ?? []);
    pick("Funda o maletín", bags.filter((x) => x.kind === "funda" && bag(x, 1.5)), rank(0.008, 0.05));
    pick("Mochila", bags.filter((x) => x.kind === "mochila" && bag(x, 3)), rank(0.01, 0.06));
    pick("Ratón", mice.filter((x) => allowed(x) && x.wireless && x.gaming === isGaming && x.pvp <= laptop.pvp * 0.08 && (!isMac || x.mac) && (usbA || x.bluetooth)), rank(0.006, 0.04));
    if (usbC) pick("Base USB-C", docks.filter((x) => allowed(x) && x.pvp >= laptop.pvp * 0.01 && x.pvp <= laptop.pvp * 0.15 && (!isMac || startsYes(x.a, "Sistema operativo MAC soportado"))), rank(0.02, 0.1));
    result.set(laptop.pid, slots);
  }
  return result;
}

function monitors(items: Item[], previous: Map<string, string[]>) {
  const fab = (x: Item) => MONITOR_BRANDS.exec(x.lower)?.[1] ?? null;
  const desk: Mount[] = [];
  const wall: Mount[] = [];
  for (const item of items.filter((x) => x.t.startsWith("Soportes"))) {
    const { a, lower } = item;
    const type = String(a["Tipo de montaje"] ?? "");
    if (/tablet|antirrobo|proyector|barra de sonido|altavoz|port[aá]til|microondas|consola|techo|doble|dual|triple|cuádruple/.test(lower) || String(a["Número de pantallas soportadas"] ?? "1") !== "1") continue;
    const base = mount(item);
    if (!base) continue;
    const row = { ...base, lockedBrand: /\b(samsung|lg|sony|philips|hisense|tcl)\b/.exec(lower)?.[1] ?? null };
    if (/escritorio|mesa|abrazadera/i.test(`${type} ${lower}`)) desk.push(row);
    else if (/pared/i.test(`${type} ${lower}`) && !/piso|suelo/i.test(`${type} ${lower}`)) wall.push(row);
  }
  const cables = items.filter((x) => x.t === "Cables" && /hdmi|displayport/.test(x.lower) && !/type c|tipo c|usb-c|micro|mini|dvi|vga|usb|adaptador|hembra|\bh\/|m\/h|f\/m|fibra|antena|extensor|splitter|conmutador|rj|displayport a hdmi|hdmi a displayport/.test(x.lower)).filter((x) => { const length = metres(x.title); return length !== null && length >= 1.5 && length <= 2; });
  const hdmi = cables.filter((x) => !x.lower.includes("displayport"));
  const displayPort = cables.filter((x) => x.lower.includes("displayport"));
  const kits = items.filter((x) => x.t.startsWith("Packs") && x.lower.startsWith("kit de teclado y ratón inalámbrico") && !/\((?!español)[a-záéíóú]+\)|gaming|mars/.test(x.lower));
  const cleaners = items.filter((x) => x.t.startsWith("Limpieza") && x.lower.includes("pantallas"));
  const result = new Map<string, Slot[]>();
  for (const monitor of items.filter((x) => x.t === "Monitores")) {
    const { a } = monitor;
    const inches = diagonal(a["Diagonal de la pantalla"]) ?? diagonal(a["Diagonal de pantalla"]) ?? titleInches(monitor.title);
    const vesa = pair(a["Interfaz de panel de montaje"]);
    const weight = a["Peso (sin base)"] ?? a["Peso (con soporte)"] ?? a["Peso del paquete"];
    let kg = number(weight);
    if (kg && !String(weight).includes("kg")) kg /= 1000;
    if (kg && inches && inches >= 20 && kg < 1.5) kg = null; // Peso imposible para ese tamaño: dato malo de la ficha
    const hz = Number(/(\d{2,3}) Hz/.exec(monitor.title)?.[1] ?? 60);
    const hasDp = (number(a["Cantidad de DisplayPorts"]) ?? 0) > 0;
    const hasHdmi = (number(a["Número de puertos HDMI"]) ?? 0) > 0 || String(a.HDMI ?? "").toLowerCase().startsWith("s");
    const brand = fab(monitor);
    const rank = (lo: number, hi: number) => (x: Item) => [score(x, monitor, lo, hi, Boolean(brand) && fab(x) === brand)];
    const fits = (s: Mount) => {
      if (!vesa || !kg || !inches || s.pvp > monitor.pvp * 0.4) return false;
      const [w, h] = vesa;
      if (s.list) { if (!s.list.has(key(w, h))) return false; }
      else if (s.minMax || !(s.mi[0] <= w && w <= s.ma[0] && s.mi[1] <= h && h <= s.ma[1])) return false;
      return kg * 1.2 <= s.cap && s.ti <= inches && inches <= s.ta && (!s.lockedBrand || s.lockedBrand === brand);
    };
    const { slots, pick } = chooser(previous.get(monitor.pid) ?? []);
    const useDp = hasDp && (hz >= 120 || !hasHdmi);
    pick("Brazo de escritorio", desk.filter(fits), rank(0.05, 0.25));
    if (useDp || hasHdmi) pick(useDp ? "Cable DisplayPort" : "Cable HDMI", (useDp ? displayPort : hdmi).filter((x) => x.pvp <= 20), rank(0.01, 0.1));
    pick("Kit de teclado y ratón", kits.filter((x) => (fab(x) === null || fab(x) === brand) && x.pvp <= monitor.pvp * 0.5), rank(0.1, 0.4));
    pick("Soporte de pared", wall.filter(fits), rank(0.04, 0.2));
    pick("Limpieza de pantalla", cleaners.filter((x) => x.pvp <= monitor.pvp * 0.1), rank(0.01, 0.06));
    result.set(monitor.pid, slots);
  }
  return result;
}

// `previous`: los complementos que tiene ahora cada aparato. La receta va delante y lo de Icecat detrás, hasta 10.
export function computeComplements(rows: RecipeProduct[], previous: Map<string, string[]> = new Map()) {
  const items: Item[] = rows.filter((row) => row.pvp > 0).map((row) => ({ ...row, a: row.a ?? {}, txt: row.txt ?? "", lower: row.title.toLowerCase() }));
  return new Map([...televisions(items, previous), ...laptops(items, previous), ...monitors(items, previous)]);
}

export function mergeComplements(recipe: Slot[], icecat: string[]) {
  return [...new Set([...recipe.map((item) => item.pid), ...icecat])].slice(0, RECIPES.maxList);
}
