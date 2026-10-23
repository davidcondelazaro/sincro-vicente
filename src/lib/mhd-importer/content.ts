// Pieza del importador: el procesador redacta título, meta título y descripciones de un producto con un modelo pequeño,
// en una sola llamada, siguiendo el perfil de su familia. El código valida el resultado y, si falla, lo pide otra vez
// una sola vez con los errores. Fuentes: solo MHD e Icecat (decidido 2026-10-23).
import type Anthropic from "@anthropic-ai/sdk";
import { costUsd, PROCESSOR_MODEL, type Usage } from "./ai";
import type { IcecatSummary } from "./icecat";
import type { ListingProduct } from "./family";
import type { FamilyProfile } from "./profile";
import type { MhdProductDetail } from "./sources";

export type ProductContent = { title: string; meta_title: string; short_description: string; long_description_html: string };
export const TITLE_MAX = 75;     // objetivo ~70
export const META_TITLE_MAX = 65; // objetivo ~60
const FORBIDDEN = [/mihogardigital/i, /\bmhd\b/i, /mi hogar digital/i];

const schema = { type: "object", additionalProperties: false, required: ["title", "meta_title", "short_description", "long_description_html"], properties: { title: { type: "string" }, meta_title: { type: "string" }, short_description: { type: "string" }, long_description_html: { type: "string" } } };

const SYSTEM = `Redactas fichas de producto para Electrónica Vicente, tienda online española de electrodomésticos. Escribes en español de España, claro y comercial sin exagerar.
Reglas:
- Usa SOLO los datos que te doy (MHD e Icecat). No inventes cifras, funciones, garantías ni compatibilidades. Si un dato no está, no lo menciones.
- No menciones nunca al proveedor ni otras tiendas (mihogardigital.es, MHD) ni copies sus frases de marketing tal cual: reescribe.
- Título: sigue la plantilla y los datos clave del perfil, unos 70 caracteres como máximo (nunca más de ${TITLE_MAX}). Marca escrita como la escribe la marca, el resto en minúscula normal salvo nombres propios, modelo exacto. Sin « | », sin repeticiones, sin compatibilidades ni códigos internos.
- Meta título: para Google, unos 60 caracteres (nunca más de ${META_TITLE_MAX}), con lo que la gente busca delante.
- Descripción corta: 2-3 frases (máx. ~300 caracteres), texto plano; se usa también como meta descripción.
- Descripción larga: HTML sencillo. Un <h3> con el nombre del producto y lo esencial, después 3-5 apartados con <h4> y un <p> cada uno (puedes usar <strong> y una lista <ul><li> si ayuda). Sin estilos, sin enlaces, sin imágenes, sin tablas de especificaciones (la ficha técnica ya se muestra aparte).`;

const strip = (html: string | null | undefined, max = 2500) => (html ?? "").replace(/<span[^>]*display:\s*none[^>]*>.*?<\/span>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

// Grafía de la marca (decidido 2026-10-23): como la escribe la marca, con Icecat de referencia. Sin Icecat, la de MHD
// en formato normal: siglas de hasta 4 letras en mayúsculas (AEG, LG, HP) y el resto con la inicial en mayúscula
// (HYUNDAI → Hyundai). Pendiente: una tabla de marcas revisada una vez para las excepciones (De'Longhi, iRobot…).
export function brandAsWritten(listing: ListingProduct, icecat: IcecatSummary | null) {
  if (icecat?.brand) return icecat.brand;
  const brand = (listing.nombre_marca ?? "").trim();
  if (/^[A-Za-z0-9]{2,4}$/.test(brand)) return brand.toUpperCase();
  return brand.toLowerCase().replace(/(^|[\s-])\p{L}/gu, (match) => match.toUpperCase());
}

export function validateContent(content: ProductContent, brand: string, model: string): string[] {
  const errors: string[] = [];
  if (content.title.length > TITLE_MAX) errors.push(`El título tiene ${content.title.length} caracteres (máximo ${TITLE_MAX}).`);
  if (content.meta_title.length > META_TITLE_MAX) errors.push(`El meta título tiene ${content.meta_title.length} caracteres (máximo ${META_TITLE_MAX}).`);
  if (brand && !content.title.includes(brand)) errors.push(`El título no lleva la marca escrita exactamente «${brand}».`);
  if (model && !content.title.includes(model)) errors.push(`El título no lleva el modelo exacto «${model}».`);
  if (/\|/.test(content.title)) errors.push("El título lleva « | ».");
  const words = content.title.toLowerCase().split(/\s+/).filter((word) => word.length > 3);
  const repeated = words.filter((word, index) => words.indexOf(word) !== index);
  if (repeated.length) errors.push(`El título repite «${[...new Set(repeated)].join("», «")}».`);
  for (const [field, text] of Object.entries(content)) if (FORBIDDEN.some((pattern) => pattern.test(text))) errors.push(`«${field}» menciona al proveedor.`);
  if (!/<h3>/.test(content.long_description_html)) errors.push("La descripción larga no empieza con un <h3>.");
  return errors;
}

export async function writeContent(client: Anthropic, input: { profile: FamilyProfile; listing: ListingProduct & { descripcion?: string | null }; detail: MhdProductDetail | null; icecat: IcecatSummary | null; metafields: Record<string, string | string[]> }) {
  const { profile, listing, detail, icecat, metafields } = input;
  const brand = brandAsWritten(listing, icecat); const model = listing.ref_proved ?? "";
  const data = {
    perfil: { producto: profile.product, titulo: profile.title, meta_titulo: profile.meta_title, descripciones: profile.descriptions },
    producto: { marca: brand, modelo: model, titulo_proveedor: listing.titulo, descripcion_proveedor: strip(listing.descripcion), descripcion_ampliada: listing.descripcion_ampliada, caracteristicas: detail?.caracteristicas ?? [], filtros_calculados: metafields },
    icecat: icecat ? { titulo: icecat.title, resumen: icecat.longSummary, destacados: icecat.bulletPoints, especificaciones: icecat.specifications } : null,
  };
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: `Datos (JSON):\n${JSON.stringify(data)}\n\nRedacta la ficha.` }];
  const usage: Usage[] = []; let content: ProductContent | null = null; let errors: string[] = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    // El sistema y los datos del producto son iguales en el reintento: se cachean.
    const message = await client.messages.create({ model: PROCESSOR_MODEL, max_tokens: 8000, system: SYSTEM, cache_control: { type: "ephemeral" }, output_config: { effort: "medium", format: { type: "json_schema", schema } }, messages });
    usage.push(message.usage);
    if (message.stop_reason !== "end_turn") throw new Error(`La redacción terminó con ${message.stop_reason}.`);
    const text = message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
    content = JSON.parse(text) as ProductContent;
    errors = validateContent(content, brand, model);
    if (!errors.length) break;
    messages.push({ role: "assistant", content: text }, { role: "user", content: `Corrige estos problemas y devuelve la ficha completa:\n- ${errors.join("\n- ")}` });
  }
  const total = usage.reduce((sum, item) => ({ input_tokens: sum.input_tokens + item.input_tokens, output_tokens: sum.output_tokens + item.output_tokens, cache_read_input_tokens: (sum.cache_read_input_tokens ?? 0) + (item.cache_read_input_tokens ?? 0), cache_creation_input_tokens: (sum.cache_creation_input_tokens ?? 0) + (item.cache_creation_input_tokens ?? 0) }), { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 });
  return { content: content!, errors, attempts: usage.length, usage: total, costUsd: costUsd(PROCESSOR_MODEL, total) };
}
