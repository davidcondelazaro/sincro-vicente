// Pieza del importador: el procesador redacta título, meta título, descripciones, meta descripción y el consejo de
// Elvi de un producto con un modelo pequeño, en una sola llamada, siguiendo el perfil de su familia. El código valida
// el resultado (y que no copie a MHD ni a Icecat) y, si falla, lo pide otra vez una sola vez con los errores. El
// consejo de Elvi pasa además por una segunda llamada que lo revisa. Fuentes: solo MHD e Icecat. Decisiones del
// 2026-10-23 en docs/IMPORTADOR_PRODUCTOS_MHD.md.
import type Anthropic from "@anthropic-ai/sdk";
import { costUsd, PROCESSOR_MODEL, type Usage } from "./ai";
import type { IcecatSummary } from "./icecat";
import type { ListingProduct } from "./family";
import type { FamilyProfile } from "./profile";
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
const schema = { type: "object", additionalProperties: false, required: ["title", "meta_title", "short_description", "meta_description", "long_description_html", "elvi_tip"], properties: {
  title: str, meta_title: str, short_description: str, meta_description: str, long_description_html: str,
  elvi_tip: { type: "object", additionalProperties: false, required: ["text", "sources"], properties: { text: str, sources: { type: "array", items: { type: "object", additionalProperties: false, required: ["source", "value"], properties: { source: str, value: str } } } } },
} };

const SYSTEM = `Redactas fichas de producto para Electrónica Vicente, tienda de electrodomésticos de Burgos con tienda online. Escribes en español de España, de tú, con tono cercano y experto, como un buen dependiente que conoce el producto: frases cortas y claras, beneficios concretos («cabe en huecos de 60 cm») en vez de adjetivos («increíble», «revolucionaria»), sin exageraciones ni preguntas retóricas.
Reglas:
- Usa SOLO los datos que te doy (MHD e Icecat). No inventes cifras, funciones, garantías ni compatibilidades. Si un dato no está, no lo menciones. No menciones lo que el producto NO tiene («no tiene tapa desmontable»).
- Saca los hechos de los textos y de las características y ESCRIBE DESDE CERO, en tu propio orden y con tus frases. No sigas el orden ni la redacción de los textos de MHD o Icecat: una secuencia de ${COPY_WORDS} palabras seguidas igual que la suya hace que se rechace la ficha.
- No menciones nunca al proveedor ni otras tiendas (mihogardigital.es, MHD), ni el «Consejo del Experto» del proveedor.
- Título: sigue la plantilla y los datos clave del perfil, unos 70 caracteres como máximo (nunca más de ${TITLE_MAX}). Marca escrita como la escribe la marca, el resto en minúscula normal salvo nombres propios, modelo exacto. Sin « | », sin repeticiones, sin compatibilidades ni códigos internos.
- Meta título: para Google, unos 60 caracteres (nunca más de ${META_TITLE_MAX}), con lo que la gente busca delante.
- Descripción corta: 2 frases en texto plano (unos 200-250 caracteres, nunca más de ${SHORT_MAX}). La primera engancha: el beneficio principal o para quién es, con un dato real del producto (no un adjetivo). La segunda da los datos clave.
- Meta descripción: distinta de la descripción corta, entre 140 y 155 caracteres (nunca menos de ${META_DESCRIPTION.min} ni más de ${META_DESCRIPTION.max}), con lo esencial en los primeros 120: tipo, marca, modelo, 2-3 datos clave y lo que diferencia al producto. Sin precio.
- Descripción larga: HTML sencillo. NO repitas el nombre del producto como titular (la ficha ya lo tiene). Empieza con un párrafo de entrada (<p>, 2-3 frases) que vende: para quién es y qué la hace buena elección. Después, 3-4 apartados con <h2> y un <p> cada uno (puedes usar <strong> y una lista <ul><li> si ayuda). Sin <h1>, <h3> ni <h4>, sin frase de cierre de relleno, sin estilos, enlaces, imágenes ni tablas de especificaciones (la ficha técnica se muestra aparte). Incluye los datos que el perfil manda destacar.
- Consejo de Elvi (elvi_tip): Elvi es la asistente con inteligencia artificial de la tienda. Un consejo práctico de 1-2 frases, de tú, sobre cómo usar, cuidar, elegir o colocar ESTE producto, que se deduzca de sus datos. En «sources» pon los datos en que se apoya, con la clave exacta de «datos_con_clave» y su valor. Prohibido: instalación eléctrica, de gas o de agua, seguridad, salud, cifras de ahorro, garantías, compatibilidades y cualquier cosa que no se deduzca de los datos. Si no hay un consejo útil y seguro, deja text vacío y sources vacío: es mejor nada que un consejo flojo.`;

const strip = (html: string | null | undefined, max = 2500) => (html ?? "").replace(/<span[^>]*display:\s*none[^>]*>.*?<\/span>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const words = (text: string) => text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/<[^>]+>/g, " ").split(/[^a-z0-9ñ]+/).filter(Boolean);

// Grafía de la marca (decidido 2026-10-23): como la escribe la marca, con Icecat de referencia. Sin Icecat, la de MHD
// en formato normal: siglas de hasta 4 letras en mayúsculas (AEG, LG, HP) y el resto con la inicial en mayúscula
// (HYUNDAI → Hyundai). Pendiente: una tabla de marcas revisada una vez para las excepciones (De'Longhi, iRobot…).
export function brandAsWritten(listing: ListingProduct, icecat: IcecatSummary | null) {
  if (icecat?.brand) return icecat.brand;
  const brand = (listing.nombre_marca ?? "").trim();
  if (/^[A-Za-z0-9]{2,4}$/.test(brand)) return brand.toUpperCase();
  return brand.toLowerCase().replace(/(^|[\s-])\p{L}/gu, (match) => match.toUpperCase());
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
  if (brand && !content.title.includes(brand)) errors.push(`El título no lleva la marca escrita exactamente «${brand}».`);
  if (model && !content.title.includes(model)) errors.push(`El título no lleva el modelo exacto «${model}».`);
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
  for (const field of ["short_description", "meta_description", "long_description_html"] as const) {
    const copied = copiedSequences(content[field], originals);
    if (copied.length) errors.push(`«${field}» copia frases de MHD o Icecat: «${copied.slice(0, 2).join("», «")}». Redáctalo con tus palabras.`);
  }
  errors.push(...checkElviSources(content.elvi_tip, values));
  return errors;
}

// Segunda opinión sobre el consejo de Elvi, de una llamada que no lo escribió: si duda, el consejo no se publica.
const reviewSchema = { type: "object", additionalProperties: false, required: ["ok", "reason"], properties: { ok: { type: "boolean" }, reason: str } };
export async function reviewElviTip(client: Anthropic, tip: ElviTip, productName: string, facts: unknown) {
  const message = await client.messages.create({ model: PROCESSOR_MODEL, max_tokens: 1500, output_config: { effort: "low", format: { type: "json_schema", schema: reviewSchema } }, messages: [{ role: "user", content: `Revisa este consejo que se va a publicar en la ficha del producto «${productName}» de una tienda de electrodomésticos, firmado por su asistente de IA:\n«${tip.text}»\n\nDatos del producto (JSON):\n${JSON.stringify(facts)}\n\nResponde ok=true solo si: se deduce de los datos, es correcto para este producto, es útil para el cliente y no puede causar un problema (nada de instalación eléctrica, de gas o de agua, seguridad, salud, cifras de ahorro, garantías ni compatibilidades). En reason, una frase en español.` }] });
  const parsed = JSON.parse(message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("")) as { ok: boolean; reason: string };
  return { ...parsed, usage: message.usage };
}

export async function writeContent(client: Anthropic, input: { profile: FamilyProfile; listing: ListingProduct & { descripcion?: string | null }; detail: MhdProductDetail | null; icecat: IcecatSummary | null; metafields: Record<string, string | string[]>; values: SourceValues }) {
  const { profile, listing, icecat, metafields, values } = input;
  const brand = brandAsWritten(listing, icecat); const model = listing.ref_proved ?? "";
  const originals = [strip(listing.descripcion, 100_000), listing.descripcion_ampliada ?? "", icecat?.longSummary ?? "", icecat?.shortSummary ?? "", ...(icecat?.bulletPoints ?? [])].filter(Boolean);
  const data = {
    perfil: { producto: profile.product, titulo: profile.title, meta_titulo: profile.meta_title, descripciones: profile.descriptions },
    producto: { marca: brand, modelo: model, titulo_proveedor: listing.titulo, filtros_calculados: metafields },
    datos_con_clave: Object.fromEntries(values),
    textos_de_referencia: { mhd: strip(listing.descripcion), mhd_ampliada: listing.descripcion_ampliada, icecat_resumen: icecat?.longSummary, icecat_destacados: icecat?.bulletPoints },
  };
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: `Datos (JSON):\n${JSON.stringify(data)}\n\nRedacta la ficha.` }];
  const usage: Usage[] = []; let content: ProductContent | null = null; let errors: string[] = []; let attempts = 0;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    attempts += 1;
    // El sistema y los datos del producto son iguales en el reintento: se cachean.
    const message = await client.messages.create({ model: PROCESSOR_MODEL, max_tokens: 8000, system: SYSTEM, cache_control: { type: "ephemeral" }, output_config: { effort: "medium", format: { type: "json_schema", schema } }, messages });
    usage.push(message.usage);
    if (message.stop_reason !== "end_turn") throw new Error(`La redacción terminó con ${message.stop_reason}.`);
    const text = message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
    content = JSON.parse(text) as ProductContent;
    errors = validateContent(content, brand, model, originals, values);
    if (!errors.length) break;
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
  return { content: content!, errors, elviReview, attempts, usage: total, costUsd: costUsd(PROCESSOR_MODEL, total) };
}
