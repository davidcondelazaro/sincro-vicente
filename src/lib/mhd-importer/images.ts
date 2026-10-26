// Pieza del importador: fotos y etiqueta energética. Se descargan (MHD da 403 sin cabeceras de navegador, así que
// Shopify no puede traerlas por URL), se miden, se quitan duplicados, un modelo pequeño con visión dice qué vista es
// cada foto, y el código calcula el fondo, decide el orden y las prepara (recorte y encuadre). Decidido con David el
// 2026-10-23; ver docs/IMPORTADOR_PRODUCTOS_MHD.md. Usa `sharp`, así que corre en Node (rutas de Next).
import type Anthropic from "@anthropic-ai/sdk";
import { loadBundledFonts } from "./fonts";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { costUsd, PROCESSOR_MODEL } from "./ai";
import { fetchMhdMedia } from "./sources";

export type ImageKind = "frontal" | "tres_cuartos" | "lateral" | "trasera" | "abierto" | "detalle" | "ambiente" | "medidas" | "icono_o_logo" | "etiqueta_energetica" | "otro";
export type Background = "blanco" | "negro" | "otro";
export type PreparedImage = { url: string; contentType: string; width: number; height: number; bytes: Uint8Array; hash: string; thumbnail: string; background: Background; source: "mhd" | "icecat"; visualHash: string };
export type ClassifiedImage = Omit<PreparedImage, "bytes" | "thumbnail" | "visualHash"> & { kind: ImageKind; quality: "buena" | "regular" | "mala"; duplicateOf: number | null; description: string; isMhdMain: boolean };
export type OrderedImages = { keep: ClassifiedImage[]; dropped: (ClassifiedImage & { reason: string })[] };
export type ProcessedImageFile = { bytes: Uint8Array; contentType: string; width: number; height: number; treatment: string };

export const KIND_SLUG: Record<ImageKind, string> = { frontal: "frontal", tres_cuartos: "tres-cuartos", lateral: "lateral", trasera: "trasera", abierto: "abierta", detalle: "detalle", ambiente: "ambiente", medidas: "medidas", icono_o_logo: "icono", etiqueta_energetica: "etiqueta-energetica", otro: "foto" };
export const KIND_ALT: Record<ImageKind, string> = { frontal: "vista frontal", tres_cuartos: "vista en tres cuartos", lateral: "vista lateral", trasera: "vista trasera", abierto: "abierta", detalle: "detalle", ambiente: "en ambiente", medidas: "medidas", icono_o_logo: "icono", etiqueta_energetica: "etiqueta energética", otro: "foto" };
const PRODUCT_VIEWS = new Set<ImageKind>(["frontal", "tres_cuartos", "lateral", "trasera", "abierto"]);

function sha1(bytes: Uint8Array) { return createHash("sha1").update(bytes).digest("hex"); }

// Fondo por los bordes de la imagen: proporción de píxeles casi blancos o casi negros en el marco exterior.
async function backgroundOf(bytes: Uint8Array): Promise<Background> {
  const size = 64; const border = 3;
  const { data } = await sharp(bytes).flatten({ background: "#ffffff" }).resize(size, size, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let white = 0; let black = 0; let total = 0;
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    if (x >= border && x < size - border && y >= border && y < size - border) continue;
    const i = (y * size + x) * 3; const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    total += 1; if (r > 225 && g > 225 && b > 225 && Math.max(r, g, b) - Math.min(r, g, b) < 12) white += 1; else if (r < 30 && g < 30 && b < 30) black += 1;
  }
  // Umbral bajo a propósito: en las fotos que llenan el encuadre (un lateral) el producto toca los bordes.
  return white / total > 0.6 ? "blanco" : black / total > 0.6 ? "negro" : "otro";
}

// Huella visual (dHash de 64 bits): dos fotos iguales en distinto tamaño o formato dan huellas casi iguales. Sirve para
// no repetir en la galería la misma foto que traen MHD e Icecat (2026-10-26).
async function visualHashOf(bytes: Uint8Array) {
  const px = await sharp(bytes).flatten({ background: "#ffffff" }).greyscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
  let bits = "";
  for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) bits += px[y * 9 + x] > px[y * 9 + x + 1] ? "1" : "0";
  return bits;
}
export function sameVisual(a: string, b: string) { let differ = 0; for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) differ += 1; return differ <= 8; }

// `fetcher`: cómo se descarga (MHD con sus cabeceras; Icecat por el proxy de Pladisel, porque sin él inishop.com
// contesta 403 a más de la mitad de sus fotos).
export async function prepareImages(urls: string[], source: "mhd" | "icecat" = "mhd", fetcher: (url: string) => Promise<{ contentType: string; bytes: Uint8Array }> = fetchMhdMedia): Promise<{ images: PreparedImage[]; errors: string[] }> {
  const images: PreparedImage[] = []; const errors: string[] = []; const seen = new Set<string>();
  for (const url of [...new Set(urls)]) {
    try {
      const media = await fetcher(url);
      const hash = sha1(media.bytes);
      if (seen.has(hash)) continue; // misma imagen con otra URL
      seen.add(hash);
      const meta = await sharp(media.bytes).metadata();
      const thumbnail = (await sharp(media.bytes).resize(384, 384, { fit: "inside" }).flatten({ background: "#ffffff" }).jpeg({ quality: 70 }).toBuffer()).toString("base64");
      images.push({ url, contentType: media.contentType, width: meta.width ?? 0, height: meta.height ?? 0, bytes: media.bytes, hash, thumbnail, background: await backgroundOf(media.bytes), source, visualHash: await visualHashOf(media.bytes) });
    } catch (caught) { errors.push(caught instanceof Error ? caught.message : `No se pudo leer ${url}`); }
  }
  return { images, errors };
}

const KINDS = Object.keys(KIND_SLUG) as ImageKind[];
const schema = { type: "object", additionalProperties: false, required: ["images"], properties: { images: { type: "array", items: { type: "object", additionalProperties: false, required: ["index", "kind", "quality", "duplicate_of", "description"], properties: {
  index: { type: "integer" }, kind: { type: "string", enum: KINDS }, quality: { type: "string", enum: ["buena", "regular", "mala"] },
  duplicate_of: { anyOf: [{ type: "integer" }, { type: "null" }] }, description: { type: "string" },
} } } } };

// La IA solo dice qué muestra cada foto (vista), su calidad y si repite otra. El fondo lo calcula el código.
export async function classifyImages(client: Anthropic, productName: string, images: PreparedImage[], mhdMainUrl: string | null) {
  const content: Anthropic.ContentBlockParam[] = images.flatMap((image, index) => [
    { type: "text" as const, text: `Imagen ${index} (${image.width}×${image.height} px):` },
    { type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data: image.thumbnail } },
  ]);
  content.push({ type: "text", text: `Son las fotos del producto «${productName}». Para cada imagen indica: kind (qué muestra: frontal = el producto entero visto de frente; tres_cuartos = el producto entero en perspectiva; lateral, trasera, abierto = puerta o tapa abierta; detalle = una parte del producto; ambiente = el producto en una estancia; medidas = plano con cotas; icono_o_logo; etiqueta_energetica; otro), quality (nitidez y encuadre para una tienda online), duplicate_of (índice de otra imagen que muestra lo mismo desde el mismo ángulo, o null; marca como duplicada la de menor resolución) y una descripción de 3-8 palabras en español.` });
  const message = await client.messages.create({ model: PROCESSOR_MODEL, max_tokens: 4000, output_config: { effort: "low", format: { type: "json_schema", schema } }, messages: [{ role: "user", content }] });
  if (message.stop_reason !== "end_turn") throw new Error(`La clasificación de imágenes terminó con ${message.stop_reason}.`);
  const text = message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
  const parsed = JSON.parse(text) as { images: { index: number; kind: ImageKind; quality: ClassifiedImage["quality"]; duplicate_of: number | null; description: string }[] };
  const classified: ClassifiedImage[] = images.map(({ url, contentType, width, height, hash, background, source }, index) => {
    const item = parsed.images.find((entry) => entry.index === index);
    return { url, contentType, width, height, hash, background, source, kind: item?.kind ?? "otro", quality: item?.quality ?? "regular", duplicateOf: item?.duplicate_of ?? null, description: item?.description ?? "", isMhdMain: url === mhdMainUrl };
  });
  return { classified, usage: message.usage, costUsd: costUsd(PROCESSOR_MODEL, message.usage) };
}

// Orden (decidido 2026-10-23): principal = la principal de MHD si es frontal o tres cuartos; si no, la frontal sobre
// blanco de más resolución, luego tres cuartos sobre blanco, luego la mejor frontal con otro fondo. Después: resto de
// vistas del producto, detalles, ambiente y, al final, medidas. Fuera iconos, etiquetas sueltas, fondos negros,
// duplicados y pequeñas.
const RANK: Record<ImageKind, number> = { frontal: 0, tres_cuartos: 1, abierto: 2, lateral: 3, trasera: 4, detalle: 5, ambiente: 6, otro: 7, medidas: 8, icono_o_logo: 99, etiqueta_energetica: 99 };
const MIN_SIDE = 500;
export function orderImages(classified: ClassifiedImage[]): OrderedImages {
  const dropped: OrderedImages["dropped"] = []; const keep: ClassifiedImage[] = [];
  classified.forEach((image, index) => {
    const other = image.duplicateOf !== null && image.duplicateOf !== index ? classified[image.duplicateOf] : undefined;
    if (RANK[image.kind] >= 99) dropped.push({ ...image, reason: image.kind === "etiqueta_energetica" ? "Etiqueta energética: va en su metacampo" : "Icono o logo" });
    else if (image.background === "negro") dropped.push({ ...image, reason: "Fondo negro: se descarta (decidido 2026-10-23)" });
    else if (other && other.width * other.height >= image.width * image.height) dropped.push({ ...image, reason: "Repetida (se queda la de más resolución)" });
    else if (Math.max(image.width, image.height) < MIN_SIDE) dropped.push({ ...image, reason: `Demasiado pequeña (${image.width}×${image.height})` });
    else keep.push(image);
  });
  const area = (image: ClassifiedImage) => image.width * image.height;
  const isMainView = (image: ClassifiedImage) => image.kind === "frontal" || image.kind === "tres_cuartos";
  const main = keep.find((image) => image.isMhdMain && isMainView(image))
    ?? [...keep].filter((image) => image.kind === "frontal" && image.background === "blanco").sort((a, b) => area(b) - area(a))[0]
    ?? [...keep].filter((image) => image.kind === "tres_cuartos" && image.background === "blanco").sort((a, b) => area(b) - area(a))[0]
    ?? [...keep].filter((image) => image.kind === "frontal").sort((a, b) => area(b) - area(a))[0]
    ?? [...keep].filter(isMainView).sort((a, b) => area(b) - area(a))[0];
  const score = (image: ClassifiedImage) => RANK[image.kind] * 10 + (image.background === "blanco" ? 0 : 2) + (image.quality === "buena" ? 0 : image.quality === "regular" ? 1 : 4);
  const rest = keep.filter((image) => image !== main).sort((a, b) => score(a) - score(b) || area(b) - area(a));
  return { keep: main ? [main, ...rest] : rest, dropped };
}

// Tratamiento (decidido 2026-10-23): vistas del producto sobre blanco → se recorta el margen blanco y se encuadra en
// cuadrado sobre blanco con un margen igual; el resto, como viene. Todas con 2.048 px como máximo y en JPG.
const MAX_SIDE = 2048; const MARGIN = 0.05;
export async function processImage(bytes: Uint8Array, image: Pick<ClassifiedImage, "kind" | "background">): Promise<ProcessedImageFile> {
  if (PRODUCT_VIEWS.has(image.kind) && image.background === "blanco") {
    const trimmed = await sharp(bytes).flatten({ background: "#ffffff" }).trim({ background: "#ffffff", threshold: 12 }).toBuffer({ resolveWithObject: true });
    const side = Math.min(MAX_SIDE, Math.round(Math.max(trimmed.info.width, trimmed.info.height) / (1 - 2 * MARGIN)));
    const inner = Math.round(side * (1 - 2 * MARGIN));
    const fitted = await sharp(trimmed.data).resize(inner, inner, { fit: "inside" }).toBuffer({ resolveWithObject: true });
    const out = await sharp({ create: { width: side, height: side, channels: 3, background: "#ffffff" } })
      .composite([{ input: fitted.data, left: Math.round((side - fitted.info.width) / 2), top: Math.round((side - fitted.info.height) / 2) }])
      .jpeg({ quality: 90, mozjpeg: true }).toBuffer();
    return { bytes: new Uint8Array(out), contentType: "image/jpeg", width: side, height: side, treatment: "recortada y encuadrada" };
  }
  const out = await sharp(bytes).flatten({ background: "#ffffff" }).resize(MAX_SIDE, MAX_SIDE, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90, mozjpeg: true }).toBuffer({ resolveWithObject: true });
  return { bytes: new Uint8Array(out.data), contentType: "image/jpeg", width: out.info.width, height: out.info.height, treatment: "como viene" };
}

// Nombres de archivo (decidido 2026-10-23): tipo, marca, modelo y vista; si la vista se repite, numerada.
export function imageFilenames(base: string, kinds: ImageKind[]) {
  const seen = new Map<ImageKind, number>();
  return kinds.map((kind) => { const n = (seen.get(kind) ?? 0) + 1; seen.set(kind, n); return `${base}-${KIND_SLUG[kind]}${n > 1 ? `-${n}` : ""}.jpg`; });
}

// Etiqueta energética como PNG normalizado (decidido 2026-10-23): sin bordes, fondo blanco y mismo alto para todas.
// Fuente: el SVG oficial de MHD (vectorial, se renderiza a la resolución que haga falta) o una imagen de Icecat.
export const LABEL_HEIGHT = 1600;
// El SVG se dibuja a 150 ppp (2026-10-26): a 300 salían ~4.700×9.400 px para dejarlos en 1.600 de alto, y en Vercel
// tardaba 20-28 s. Si a 150 no llega a 1,2 veces el alto final, se dibuja a 300.
async function renderLabel(bytes: Uint8Array, isVector: boolean) {
  if (isVector) loadBundledFonts();
  if (!isVector) return sharp(bytes).flatten({ background: "#ffffff" }).png({ compressionLevel: 1 }).toBuffer();
  const draft = await sharp(bytes, { density: 150 }).flatten({ background: "#ffffff" }).png({ compressionLevel: 1 }).toBuffer({ resolveWithObject: true });
  if (draft.info.height >= LABEL_HEIGHT * 1.2) return draft.data;
  return sharp(bytes, { density: 300 }).flatten({ background: "#ffffff" }).png({ compressionLevel: 1 }).toBuffer();
}

export async function normalizeEnergyLabel(bytes: Uint8Array, isVector: boolean) {
  const rendered = await renderLabel(bytes, isVector);
  const trimmed = await sharp(rendered).trim({ background: "#ffffff", threshold: 10 }).toBuffer();
  const out = await sharp(trimmed).resize({ height: LABEL_HEIGHT }).png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true });
  return { bytes: new Uint8Array(out.data), width: out.info.width, height: out.info.height };
}

// Primera página de un PDF (la etiqueta de Icecat) a PNG, con MuPDF: el PDF es vectorial, así que se renderiza al
// doble del alto final para que la normalización no pierda calidad.
export async function pdfFirstPageToPng(bytes: Uint8Array) {
  const mupdf = await import("mupdf");
  const doc = mupdf.Document.openDocument(bytes, "application/pdf");
  const page = doc.loadPage(0); const bounds = page.getBounds();
  const scale = (LABEL_HEIGHT * 2) / Math.max(1, bounds[3] - bounds[1]);
  return new Uint8Array(page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true).asPNG());
}

export function slugify(text: string) { return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
