// Pieza del importador: el procesador redacta título, meta título, descripciones, meta descripción y la frase de
// Elvi (la vendedora) de un producto con un modelo pequeño, siguiendo el perfil de su familia. El código valida el
// formato (y que no copie a MHD ni a Icecat), un revisor de datos comprueba cada afirmación contra las fuentes y, si
// algo falla, se pide otra vez con los errores (hasta 3 intentos). La frase de Elvi pasa además por su propia revisión
// y, desde el 2026-10-26, solo se escribe si se pide (fuera del masivo). Fuentes: solo MHD e Icecat. Decisiones del
// 2026-10-23 y del 2026-10-26 en docs/IMPORTADOR_PRODUCTOS_MHD.md.
import type Anthropic from "@anthropic-ai/sdk";
import { costUsd, PROCESSOR_MODEL, type Usage } from "./ai";
import type { IcecatSummary } from "./icecat";
import type { ListingProduct } from "./family";
import type { FamilyProfile } from "./profile";
import { resolveBrand } from "./brands";
import { buildFactSheet, numbersIn, unsupportedNumbers } from "./facts";
import type { SourceValues } from "./rules";
import type { MhdProductDetail } from "./sources";

export type ElviTip = { text: string; sources: { source: string; value: string }[] };
export type ProductContent = { title: string; meta_title: string; short_description: string; meta_description: string; long_description_html: string; elvi_tip: ElviTip };
export const TITLE_MAX = 75;          // objetivo ~70
export const META_TITLE_MAX = 65;     // objetivo ~60
export const SHORT_MAX = 300;
export const META_DESCRIPTION = { min: 120, max: 160 }; // objetivo 140-155, lo esencial en los primeros 120
const COPY_WORDS = 8;                 // secuencia de palabras seguidas que no puede coincidir con MHD ni con Icecat
const FORBIDDEN = [/mihogardigital/i, /\bmhd\b/i, /mi hogar digital/i];

const str = { type: "string" };
const elviSchema = { type: "object", additionalProperties: false, required: ["text", "sources"], properties: { text: str, sources: { type: "array", items: { type: "object", additionalProperties: false, required: ["source", "value"], properties: { source: str, value: str } } } } };
const TEXT_FIELDS = ["title", "meta_title", "short_description", "meta_description", "long_description_html"];
const schemaFor = (withElvi: boolean) => ({ type: "object", additionalProperties: false, required: withElvi ? [...TEXT_FIELDS, "elvi_tip"] : TEXT_FIELDS, properties: {
  ...Object.fromEntries(TEXT_FIELDS.map((field) => [field, str])), ...(withElvi ? { elvi_tip: elviSchema } : {}),
} });

const SYSTEM = `Redactas fichas de producto para Electrónica Vicente, tienda de electrodomésticos de Burgos con tienda online. Escribes en español de España, de tú, con tono cercano y experto, como un buen dependiente que conoce el producto: frases cortas y claras, datos concretos («368 L», «39 dB») en vez de adjetivos («increíble», «revolucionaria»), sin exageraciones ni preguntas retóricas.
Reglas:
- «datos_con_clave» es la hoja de datos del producto, ya depurada (un solo valor por dato). Toda cifra que escribas tiene que estar ahí, con la misma unidad o su equivalente (59 cm = 590 mm): el código lo comprueba y rechaza la ficha si no. Los textos de referencia sirven solo para entender el producto, no como fuente de cifras. Medidas: las grandes (alto, ancho, fondo de más de unos 10 cm) en centímetros aunque la hoja las dé en milímetros (845 mm → 84,5 cm); las pequeñas (grosores, diámetros, cables cortos) en milímetros (5,9 mm). Nunca la misma medida en dos unidades («2030 mm (203 cm)»).
- Usa SOLO los datos que te doy (MHD e Icecat). No inventes cifras, funciones, garantías ni compatibilidades. Si un dato no está, no lo menciones. No menciones lo que el producto NO tiene («no tiene tapa desmontable»).
- Nombra las tecnologías y funciones tal como vienen en los datos y con su alcance exacto (si hay «No Frost» en el frigorífico y en el congelador, es No Frost en los dos; si solo en uno, solo en ese). NO expliques qué hacen ni qué consigues con ellas («para no descongelar a mano», «ahorra agua», «lava más rápido») salvo que esa explicación esté en los textos de referencia. No saques consecuencias ni comparaciones propias de los datos. Cada afirmación de la ficha tiene que poder señalarse en los datos: después la revisa otra IA y, si algo no está en los datos, la ficha se rechaza.
- Saca los hechos de los textos y de las características y ESCRIBE DESDE CERO, en tu propio orden y con tus frases. No sigas el orden ni la redacción de los textos de MHD o Icecat: una secuencia de ${COPY_WORDS} palabras seguidas igual que la suya hace que se rechace la ficha.
- No menciones nunca al proveedor ni otras tiendas (mihogardigital.es, MHD), ni el «Consejo del Experto» del proveedor.
- Título: sigue la plantilla y los datos clave del perfil, unos 70 caracteres como máximo (nunca más de ${TITLE_MAX}). Marca escrita como la escribe la marca, el resto en minúscula normal salvo nombres propios, modelo exacto. Sin « | », sin repeticiones, sin compatibilidades ni códigos internos.
- Meta título: para Google, unos 60 caracteres (nunca más de ${META_TITLE_MAX}), con lo que la gente busca delante.
- Descripción corta: 2 frases en texto plano (unos 200-250 caracteres, nunca más de ${SHORT_MAX}). La primera engancha: el beneficio principal o para quién es, con un dato real del producto (no un adjetivo). La segunda da los datos clave.
- Meta descripción: distinta de la descripción corta, entre 140 y 155 caracteres (nunca menos de ${META_DESCRIPTION.min} ni más de ${META_DESCRIPTION.max}), con lo esencial en los primeros 120. NO repitas el título ni el modelo: Google ya enseña el título encima, así que aprovecha el espacio para 2-3 datos clave, lo que diferencia al producto y para quién es. Sin precio.
- Descripción larga: HTML sencillo. NO repitas el nombre del producto como titular (la ficha ya lo tiene). Empieza con un párrafo de entrada (<p>, 2-3 frases) que vende: para quién es y qué la hace buena elección. Después, 3-4 apartados con <h2> y un <p> cada uno (puedes usar <strong> y una lista <ul><li> si ayuda). Sin <h1>, <h3> ni <h4>, sin frase de cierre de relleno ni apartado final de resumen o lista que repita lo ya dicho, sin estilos, enlaces, imágenes ni tablas de especificaciones (la ficha técnica se muestra aparte). Incluye los datos que el perfil manda destacar.`;

// Solo cuando se pide la frase de Elvi (fuera del masivo desde el 2026-10-26).
const SYSTEM_ELVI = `- Elvi (elvi_tip): Elvi es la vendedora con inteligencia artificial de la tienda. No da consejos de uso ni recita la ficha: habla como una buena vendedora delante del cliente, de tú, en 3 o 4 frases (unos 300-450 caracteres). 1) Para quién es, por la situación del cliente («Si en casa ponéis lavadoras casi a diario…»). Siempre de tú en singular (nunca «vosotros», «os», «hacéis»). 2) Las 2 o 3 cosas que ella destacaría (las que el perfil manda destacar en esta categoría), cada una con su dato exacto y lo que supone para el cliente, solo si se deduce directamente del dato (9 kg → coladas grandes; 60 cm de ancho → hueco estándar; 39 dB → silencioso). 3) Un cierre honesto de vendedora (en qué se fijaría ella o qué comprobar antes de decidirse, p. ej. las medidas del hueco, con la medida exacta que dan los datos). No afirmes qué cabe o qué se puede hacer con el aparato («cabe un edredón», «un pollo entero», «para cuatro personas») si no lo dicen los datos. Ejemplo de tono: «Si haces la compra para toda la semana, este combi te va a dar mucho juego: son 368 L, con 279 para la nevera y 89 para el congelador, y lleva No Frost en los dos. Además es de los silenciosos, con 39 dB, algo que se agradece si la cocina está abierta al salón. Mide 203 cm de alto y 60 de ancho, así que antes de decidirte comprueba que te cabe en el hueco.» Sigue sin explicar qué hacen las tecnologías ni inventar beneficios. En «sources» pon los datos en que se apoya, con la clave exacta de «datos_con_clave» y su valor. Prohibido: instalación eléctrica, de gas o de agua, seguridad, salud, cifras de ahorro, garantías, compatibilidades, comparaciones con otros productos (nada de «de los más…», «de los silenciosos», «más que la media») y cualquier cifra que no esté en los datos. Si no hay nada que destacar con datos, deja text vacío y sources vacío.`;

const strip = (html: string | null | undefined, max = 2500) => (html ?? "").replace(/<span[^>]*display:\s*none[^>]*>.*?<\/span>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const words = (text: string) => text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/<[^>]+>/g, " ").split(/[^a-z0-9ñ]+/).filter(Boolean);

// Grafía de la marca (decidido 2026-10-23): como la escribe la marca, con Icecat de referencia; la tabla de marcas, las
// licencias y los distribuidores, en brands.ts (2026-10-26).
export function brandAsWritten(listing: ListingProduct, icecat: IcecatSummary | null) {
  return resolveBrand(listing, icecat).brand;
}

// Secuencias de N palabras seguidas que el texto comparte con los de MHD o Icecat.
export function copiedSequences(text: string, sources: string[], size = COPY_WORDS) {
  const shingles = new Set<string>();
  for (const source of sources) { const list = words(source); for (let i = 0; i + size <= list.length; i += 1) shingles.add(list.slice(i, i + size).join(" ")); }
  const list = words(text); const found: string[] = [];
  for (let i = 0; i + size <= list.length; i += 1) { const shingle = list.slice(i, i + size).join(" "); if (shingles.has(shingle)) found.push(shingle); }
  return [...new Set(found)];
}

// El consejo de Elvi solo vale si cada dato en que se apoya existe en el producto y dice lo que la IA afirma.
export function checkElviSources(tip: ElviTip, values: SourceValues) {
  if (!tip.text.trim()) return [];
  if (!tip.sources.length) return ["El consejo de Elvi no dice en qué dato se apoya."];
  const norm = (text: string) => text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  return tip.sources.flatMap((item) => {
    const actual = values.get(item.source.toLowerCase());
    if (actual === undefined) return [`El consejo de Elvi cita un dato que no existe: «${item.source}».`];
    return norm(actual).includes(norm(item.value)) || norm(item.value).includes(norm(actual)) ? [] : [`El consejo de Elvi dice que «${item.source}» es «${item.value}», pero es «${actual}».`];
  });
}

export function validateContent(content: ProductContent, brand: string, model: string, originals: string[], values: SourceValues): string[] {
  const errors: string[] = [];
  if (content.title.length > TITLE_MAX) errors.push(`El título tiene ${content.title.length} caracteres (máximo ${TITLE_MAX}).`);
  if (content.meta_title.length > META_TITLE_MAX) errors.push(`El meta título tiene ${content.meta_title.length} caracteres (máximo ${META_TITLE_MAX}).`);
  if (content.short_description.length > SHORT_MAX) errors.push(`La descripción corta tiene ${content.short_description.length} caracteres (máximo ${SHORT_MAX}).`);
  if (content.meta_description.length < META_DESCRIPTION.min || content.meta_description.length > META_DESCRIPTION.max) errors.push(`La meta descripción tiene ${content.meta_description.length} caracteres (entre ${META_DESCRIPTION.min} y ${META_DESCRIPTION.max}).`);
  if (content.meta_description.trim() === content.short_description.trim()) errors.push("La meta descripción repite la descripción corta.");
  // David, 2026-10-26: la meta descripción no repite el título ni el modelo (Google ya enseña el título encima).
  const plain = (text: string) => text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
  if (plain(content.meta_description).includes(plain(content.title))) errors.push("La meta descripción repite el título: Google ya lo enseña encima; usa el espacio para datos clave y lo que diferencia al producto.");
  else if (model && plain(content.meta_description).includes(plain(model))) errors.push(`La meta descripción repite el modelo «${model}», que ya va en el título.`);
  if (brand && !content.title.includes(brand)) errors.push(`El título no lleva la marca escrita exactamente «${brand}».`);
  if (model && !content.title.toLowerCase().includes(model.toLowerCase())) errors.push(`El título no lleva el modelo exacto «${model}».`);
  if (/\|/.test(content.title)) errors.push("El título lleva « | ».");
  const titleWords = content.title.toLowerCase().split(/\s+/).filter((word) => word.length > 3);
  const repeated = titleWords.filter((word, index) => titleWords.indexOf(word) !== index);
  if (repeated.length) errors.push(`El título repite «${[...new Set(repeated)].join("», «")}».`);
  for (const [field, value] of Object.entries(content)) if (typeof value === "string" && FORBIDDEN.some((pattern) => pattern.test(value))) errors.push(`«${field}» menciona al proveedor.`);
  // Estructura (decidida 2026-10-23): párrafo de entrada, apartados con <h2>, sin repetir el título.
  const longHtml = content.long_description_html.trim();
  if (!longHtml.startsWith("<p>")) errors.push("La descripción larga debe empezar con un párrafo de entrada (<p>), sin titular.");
  if (!/<h2>/.test(longHtml)) errors.push("La descripción larga debe tener apartados con <h2>.");
  if (/<h[1345][\s>]/.test(longHtml)) errors.push("La descripción larga solo puede usar <h2> como titulares.");
  if (/<h2>\s*(en\s+)?(resumen|datos clave|caracter[ií]sticas principales|lo m[aá]s destacado)/i.test(longHtml)) errors.push("La descripción larga no lleva apartado de resumen: la ficha técnica ya está aparte. Quítalo.");
  for (const field of ["short_description", "meta_description", "long_description_html"] as const) {
    const copied = copiedSequences(content[field], originals);
    if (copied.length) errors.push(`«${field}» copia frases de MHD o Icecat: «${copied.slice(0, 2).join("», «")}». Redáctalo con tus palabras.`);
  }
  if (content.elvi_tip) errors.push(...checkElviSources(content.elvi_tip, values));
  return errors;
}

// Segunda opinión sobre el consejo de Elvi, de una llamada que no lo escribió: si duda, el consejo no se publica.
const reviewSchema = { type: "object", additionalProperties: false, required: ["ok", "reason"], properties: { ok: { type: "boolean" }, reason: str } };
export async function reviewElviTip(client: Anthropic, tip: ElviTip, productName: string, facts: unknown) {
  const message = await client.messages.create({ model: PROCESSOR_MODEL, max_tokens: 1500, output_config: { effort: "low", format: { type: "json_schema", schema: reviewSchema } }, messages: [{ role: "user", content: `Revisa esta frase que se va a publicar en la ficha del producto «${productName}» de una tienda de electrodomésticos, firmado por su asistente de IA:\n«${tip.text}»\n\nDatos del producto (JSON):\n${JSON.stringify(facts)}\n\nEs la frase de venta de la vendedora de la tienda. Si dos fuentes dan valores distintos para un dato (p. ej. 1400 rpm en MHD y 1351 rpm en Icecat), cualquiera de los dos vale. Puede leer un dato en términos prácticos si se deduce directamente de él (9 kg → coladas grandes; 39 dB → silencioso; medidas → comprobar el hueco), pero no afirmar qué cabe o qué se puede hacer («cabe un edredón», «para cuatro personas») si no lo dicen los datos. Responde ok=true solo si: cada dato que menciona está en los datos y con el mismo alcance, no explica tecnologías con afirmaciones que no estén en los datos, no exagera, vende con honestidad y no puede causar un problema (nada de instalación eléctrica, de gas o de agua, seguridad, salud, cifras de ahorro, garantías, compatibilidades ni comparaciones). En reason, una frase en español.` }] });
  const parsed = JSON.parse(message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("")) as { ok: boolean; reason: string };
  return { ...parsed, usage: message.usage };
}

// Datos clave del título (los del perfil sin condición, p. ej. «Centrifugado»; no «Alto (solo combis)»): si la primera
// fuente con dato trae una cifra, el título tiene que llevarla. Evita que la IA los quite al corregir otra cosa.
export function missingKeyData(title: string, profile: FamilyProfile, values: SourceValues, subfamilyName?: string | null, subfamilyCode?: string | null) {
  // «(solo …)»: se exige en la subfamilia que nombra. Mejor con su código de MHD («(solo C1010)»); si no, por palabras:
  // todas las palabras largas tienen que estar enteras (sin plural) en el nombre de la subfamilia, para que «plancha» no
  // case con «Tabla de planchar» ni «aspirador» con «Robot aspirador» cuando la subfamilia es otra.
  const applies = (name: string) => {
    if (!name.includes("(")) return true;
    const only = /\(solo ([^)]*)\)/i.exec(name)?.[1];
    if (!only || !subfamilyName) return false;
    const codes = only.match(/\b[A-Z0-9]{5}\b/g);
    if (codes?.length) return Boolean(subfamilyCode && codes.includes(subfamilyCode));
    const singular = (word: string) => word.replace(/(es|s)$/, "");
    const words = subfamilyName.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9]+/).map(singular);
    return only.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9]+/).filter((word) => word.length > 4).every((word) => words.some((item) => item === singular(word) || item.startsWith(singular(word)) && item.length - singular(word).length <= 3 && !/ar$|ado$/.test(item.slice(singular(word).length))));
  };
  const inTitle = numbersIn(title);
  return profile.title.key_data.filter((item) => applies(item.name)).flatMap((item) => {
    const source = item.sources.find((key) => values.has(key.toLowerCase()));
    const facts = source ? numbersIn(values.get(source.toLowerCase())!) : [];
    if (!facts.length) return [];
    // Vale cualquiera de las cifras del dato («39,6 cm (15.6")» → 39,6 cm o 15,6"), con unidad equivalente si la hay.
    const ok = facts.some((fact) => inTitle.some((item_) => (fact.unit && item_.unit === fact.unit ? Math.abs(item_.base - fact.base) <= 0.011 * fact.base : Math.abs(item_.n - fact.n) <= 0.011 * fact.n)));
    return ok ? [] : [`El título no lleva el dato clave «${item.name}» (${values.get(source!.toLowerCase())}, de ${source}).`];
  });
}

// Revisor de datos (decidido 2026-10-23, tras «No Frost para no descongelar a mano»): otra llamada compara cada
// afirmación de los textos con los datos de origen y señala lo que no está en ellos o lo contradice.
const factSchema = { type: "object", additionalProperties: false, required: ["problems"], properties: { problems: { type: "array", items: { type: "object", additionalProperties: false, required: ["field", "claim", "reason"], properties: { field: str, claim: str, reason: str } } } } };
export async function factCheck(client: Anthropic, content: ProductContent, facts: unknown) {
  const texts = { title: content.title, meta_title: content.meta_title, short_description: content.short_description, meta_description: content.meta_description, long_description: strip(content.long_description_html, 10_000), ...(content.elvi_tip.text ? { elvi: content.elvi_tip.text } : {}) };
  const message = await client.messages.create({ model: PROCESSOR_MODEL, max_tokens: 3000, output_config: { effort: "medium", format: { type: "json_schema", schema: factSchema } }, messages: [{ role: "user", content: `Eres el revisor de datos de una tienda de electrodomésticos. Comprueba cada afirmación de estos textos de una ficha de producto contra los datos de origen.\n\nTextos (JSON):\n${JSON.stringify(texts)}\n\nDatos de origen (JSON: características y textos de referencia del fabricante y del proveedor):\n${JSON.stringify(facts)}\n\nSeñala en «problems» cada afirmación que: no esté en los datos; los contradiga; cambie su alcance (p. ej. «No Frost en el congelador» si los datos dicen que también en la nevera); o explique qué hace una tecnología o qué se consigue con ella cuando esa explicación no está en los textos de referencia («para no descongelar a mano», «ahorra agua»). Si dos fuentes dan valores distintos para el mismo dato (p. ej. 1400 rpm en MHD y 1351 rpm en Icecat), cualquiera de los dos tiene respaldo: no lo señales. En el campo «elvi» se permite leer un dato en términos prácticos cuando se deduce directamente de él (9 kg → coladas grandes; 60 cm de ancho → hueco estándar; 39 dB → silencioso; medidas → comprobar el hueco), pero no explicar qué hace una tecnología ni afirmar qué cabe o qué se puede hacer con el aparato («cabe un edredón», «para cuatro personas») si no lo dicen los datos. No señales el estilo, el tono ni frases genéricas sin datos («una buena elección para el día a día»). Si todo está bien, problems vacío. field: el campo; claim: la frase; reason: por qué, en una frase en español.` }] });
  const parsed = JSON.parse(message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("")) as { problems: { field: string; claim: string; reason: string }[] };
  return { problems: parsed.problems, usage: message.usage };
}

// `model`: el modelo limpio (models.ts); sin él, el de MHD. `elvi`: escribir la frase de Elvi (por defecto no: fuera del
// masivo desde el 2026-10-26, porque es lo que más rechaza el revisor y su valor no está medido).
export async function writeContent(client: Anthropic, input: { profile: FamilyProfile; listing: ListingProduct & { descripcion?: string | null }; detail: MhdProductDetail | null; icecat: IcecatSummary | null; metafields: Record<string, string | string[]>; values: SourceValues; model?: string | null; elvi?: boolean }) {
  const { profile, listing, icecat, metafields } = input;
  // Hoja de datos única (facts.ts): la redacción y las revisiones solo ven un valor por dato.
  const values = buildFactSheet(profile, input.values, listing.cod_subfamilia);
  // Los valores de los filtros ya calculados también son datos de la ficha (p. ej. «2000 W» sacado de un «2W» de MHD, o
  // «Mueble de 50 cm» sacado del texto): sin ellos, esas cifras no se podrían escribir.
  for (const [key, value] of Object.entries(metafields)) values.set(`filtro:${key}`, Array.isArray(value) ? value.join(", ") : value);
  const brand = brandAsWritten(listing, icecat); const model = input.model || listing.ref_proved || ""; const withElvi = input.elvi ?? false;
  const originals = [strip(listing.descripcion, 100_000), listing.descripcion_ampliada ?? "", icecat?.longSummary ?? "", icecat?.shortSummary ?? "", ...(icecat?.bulletPoints ?? [])].filter(Boolean);
  const data = {
    perfil: { producto: profile.product, titulo: profile.title, meta_titulo: profile.meta_title, descripciones: profile.descriptions },
    producto: { marca: brand, modelo: model, titulo_proveedor: listing.titulo, filtros_calculados: metafields },
    datos_con_clave: Object.fromEntries(values),
    textos_de_referencia: { mhd: strip(listing.descripcion), mhd_ampliada: listing.descripcion_ampliada, icecat_resumen: icecat?.longSummary, icecat_destacados: icecat?.bulletPoints },
  };
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: `Datos (JSON):\n${JSON.stringify(data)}\n\nRedacta la ficha.` }];
  const usage: Usage[] = []; let content: ProductContent | null = null; let errors: string[] = []; let attempts = 0;
  const facts = { datos: data.datos_con_clave, textos_de_referencia: data.textos_de_referencia };
  let unsupported: { field: string; claim: string; reason: string }[] = [];
  // Errores de cada intento fallido (2026-10-26): para ver qué provoca los reintentos.
  const attemptErrors: string[][] = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    attempts += 1;
    // El sistema y los datos del producto son iguales en el reintento: se cachean. Razonamiento bajo (2026-10-26): con
    // «medium» cada ficha gastaba 13.000-15.000 tokens de salida para ~1.300 caracteres de texto.
    const message = await client.messages.create({ model: PROCESSOR_MODEL, max_tokens: 16000, system: withElvi ? `${SYSTEM}\n${SYSTEM_ELVI}` : SYSTEM, cache_control: { type: "ephemeral" }, output_config: { effort: "low", format: { type: "json_schema", schema: schemaFor(withElvi) } }, messages });
    usage.push(message.usage);
    if (message.stop_reason !== "end_turn") throw new Error(`La redacción terminó con ${message.stop_reason}.`);
    const text = message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
    const parsed = JSON.parse(text) as Omit<ProductContent, "elvi_tip"> & { elvi_tip?: ElviTip };
    content = { ...parsed, elvi_tip: parsed.elvi_tip ?? { text: "", sources: [] } };
    const texts = { title: content.title, meta_title: content.meta_title, short_description: content.short_description, meta_description: content.meta_description, long_description_html: content.long_description_html, ...(content.elvi_tip.text ? { elvi: content.elvi_tip.text } : {}) };
    errors = [...validateContent(content, brand, model, originals, values), ...missingKeyData(content.title, profile, values, listing.nombre_subfamilia, listing.cod_subfamilia), ...unsupportedNumbers(texts, values, [brand, model, listing.nombre_marca, icecat?.partCode, icecat?.modelName]).map((problem) => `Cifra sin respaldo: ${problem} Usa solo cifras de datos_con_clave.`)];
    // Solo se revisan los datos de una ficha que ya cumple el formato (ahorra llamadas).
    if (!errors.length) {
      const checked = await factCheck(client, content, facts); usage.push(checked.usage);
      unsupported = checked.problems;
      errors = unsupported.map((item) => `Dato sin respaldo en «${item.field}»: «${item.claim}» (${item.reason}). Quítalo o dilo exactamente como en los datos.`);
    }
    if (!errors.length) break;
    attemptErrors.push(errors);
    messages.push({ role: "assistant", content: text }, { role: "user", content: `Corrige estos problemas y devuelve la ficha completa:\n- ${errors.join("\n- ")}` });
  }
  // Barreras del consejo de Elvi: si sigue citando datos que no cuadran o la revisión no lo aprueba, no se publica.
  let elviReview: { ok: boolean; reason: string } | null = null;
  if (content!.elvi_tip.text.trim()) {
    if (checkElviSources(content!.elvi_tip, values).length) { elviReview = { ok: false, reason: "Cita datos que no cuadran con el producto." }; }
    else { const review = await reviewElviTip(client, content!.elvi_tip, content!.title, data.datos_con_clave); usage.push(review.usage); elviReview = { ok: review.ok, reason: review.reason }; }
    if (!elviReview.ok) content = { ...content!, elvi_tip: { text: "", sources: [] } };
  }
  errors = errors.filter((error) => !error.startsWith("El consejo de Elvi"));
  const total = usage.reduce((sum, item) => ({ input_tokens: sum.input_tokens + item.input_tokens, output_tokens: sum.output_tokens + item.output_tokens, cache_read_input_tokens: (sum.cache_read_input_tokens ?? 0) + (item.cache_read_input_tokens ?? 0), cache_creation_input_tokens: (sum.cache_creation_input_tokens ?? 0) + (item.cache_creation_input_tokens ?? 0) }), { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
  // Si tras los intentos quedan datos sin respaldo, la ficha no se puede guardar en Shopify hasta revisarla.
  // Si lo único que falla es la frase de Elvi, se quita la frase y la ficha sigue.
  const unsupported_ = (error: string) => error.startsWith("Dato sin respaldo") || error.startsWith("Cifra sin respaldo");
  const isElvi = (error: string) => /«elvi»|«elvi_tip»/.test(error);
  if (errors.some((error) => unsupported_(error) && isElvi(error))) { content = { ...content!, elvi_tip: { text: "", sources: [] } }; elviReview = { ok: false, reason: "La frase tenía datos o cifras sin respaldo." }; errors = errors.filter((error) => !(unsupported_(error) && isElvi(error))); }
  const blocked = errors.some(unsupported_);
  return { content: content!, errors, blocked, elviReview, attempts, attemptErrors, usage: total, costUsd: costUsd(PROCESSOR_MODEL, total) };
}
