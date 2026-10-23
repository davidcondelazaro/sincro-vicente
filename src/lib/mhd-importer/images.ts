// Pieza del importador: fotos y etiqueta energética de MHD. Se descargan (MHD da 403 sin cabeceras de navegador, así que
// Shopify no puede traerlas por URL), se miden, se quitan duplicados, un modelo pequeño con visión clasifica cada foto y
// el código decide el orden. Usa `sharp`, así que corre en Node (rutas de Next), no en una función de Supabase.
import type Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { costUsd, PROCESSOR_MODEL } from "./ai";
import { fetchMhdMedia } from "./sources";

export type ImageKind = "frontal" | "tres_cuartos" | "lateral" | "trasera" | "abierto" | "detalle" | "ambiente" | "medidas" | "icono_o_logo" | "etiqueta_energetica" | "otro";
export type PreparedImage = { url: string; contentType: string; width: number; height: number; bytes: Uint8Array; hash: string; thumbnail: string };
export type ClassifiedImage = Omit<PreparedImage, "bytes" | "thumbnail"> & { kind: ImageKind; background: "blanco" | "negro" | "color" | "ambiente"; quality: "buena" | "regular" | "mala"; duplicateOf: number | null; description: string };
export type OrderedImages = { keep: ClassifiedImage[]; dropped: (ClassifiedImage & { reason: string })[] };

function sha1(bytes: Uint8Array) { return createHash("sha1").update(bytes).digest("hex"); }

export async function prepareImages(urls: string[]): Promise<{ images: PreparedImage[]; errors: string[] }> {
  const images: PreparedImage[] = []; const errors: string[] = []; const seen = new Set<string>();
  for (const url of [...new Set(urls)]) {
    try {
      const media = await fetchMhdMedia(url);
      const hash = sha1(media.bytes);
      if (seen.has(hash)) continue; // misma imagen con otra URL
      seen.add(hash);
      const meta = await sharp(media.bytes).metadata();
      const thumbnail = (await sharp(media.bytes).resize(384, 384, { fit: "inside" }).flatten({ background: "#ffffff" }).jpeg({ quality: 70 }).toBuffer()).toString("base64");
      images.push({ url, contentType: media.contentType, width: meta.width ?? 0, height: meta.height ?? 0, bytes: media.bytes, hash, thumbnail });
    } catch (caught) { errors.push(caught instanceof Error ? caught.message : `No se pudo leer ${url}`); }
  }
  return { images, errors };
}

const KINDS: ImageKind[] = ["frontal", "tres_cuartos", "lateral", "trasera", "abierto", "detalle", "ambiente", "medidas", "icono_o_logo", "etiqueta_energetica", "otro"];
const schema = { type: "object", additionalProperties: false, required: ["images"], properties: { images: { type: "array", items: { type: "object", additionalProperties: false, required: ["index", "kind", "background", "quality", "duplicate_of", "description"], properties: {
  index: { type: "integer" }, kind: { type: "string", enum: KINDS }, background: { type: "string", enum: ["blanco", "negro", "color", "ambiente"] }, quality: { type: "string", enum: ["buena", "regular", "mala"] },
  duplicate_of: { anyOf: [{ type: "integer" }, { type: "null" }] }, description: { type: "string" },
} } } } };

// Clasificación con visión (miniaturas de 384 px): qué muestra cada foto y si repite otra.
export async function classifyImages(client: Anthropic, productName: string, images: PreparedImage[]) {
  const content: Anthropic.ContentBlockParam[] = images.flatMap((image, index) => [
    { type: "text" as const, text: `Imagen ${index} (${image.width}×${image.height} px):` },
    { type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data: image.thumbnail } },
  ]);
  content.push({ type: "text", text: `Son las fotos del producto «${productName}». Para cada imagen indica: kind (qué muestra), background, quality (nitidez y encuadre para una tienda online), duplicate_of (índice de otra imagen que muestra lo mismo desde el mismo ángulo, o null; marca como duplicada la de menor resolución) y una descripción de 3-8 palabras en español.` });
  const message = await client.messages.create({ model: PROCESSOR_MODEL, max_tokens: 4000, output_config: { effort: "low", format: { type: "json_schema", schema } }, messages: [{ role: "user", content }] });
  if (message.stop_reason !== "end_turn") throw new Error(`La clasificación de imágenes terminó con ${message.stop_reason}.`);
  const text = message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
  const parsed = JSON.parse(text) as { images: { index: number; kind: ImageKind; background: ClassifiedImage["background"]; quality: ClassifiedImage["quality"]; duplicate_of: number | null; description: string }[] };
  const classified: ClassifiedImage[] = images.map(({ url, contentType, width, height, hash }, index) => {
    const item = parsed.images.find((entry) => entry.index === index);
    return { url, contentType, width, height, hash, kind: item?.kind ?? "otro", background: item?.background ?? "color", quality: item?.quality ?? "regular", duplicateOf: item?.duplicate_of ?? null, description: item?.description ?? "" };
  });
  return { classified, usage: message.usage, costUsd: costUsd(PROCESSOR_MODEL, message.usage) };
}

// Orden (regla para el masivo): primero la mejor vista frontal o de tres cuartos sobre fondo blanco, después el resto del
// producto, detalles, ambiente y, al final, medidas. Fuera iconos, logos, etiquetas sueltas, duplicados y fotos pequeñas.
const RANK: Record<ImageKind, number> = { frontal: 0, tres_cuartos: 1, abierto: 2, lateral: 3, trasera: 4, detalle: 5, ambiente: 6, medidas: 7, otro: 8, icono_o_logo: 99, etiqueta_energetica: 99 };
const MIN_SIDE = 500;
export function orderImages(classified: ClassifiedImage[]): OrderedImages {
  const dropped: OrderedImages["dropped"] = []; const keep: ClassifiedImage[] = [];
  classified.forEach((image, index) => {
    const other = image.duplicateOf !== null && image.duplicateOf !== index ? classified[image.duplicateOf] : undefined;
    if (RANK[image.kind] >= 99) dropped.push({ ...image, reason: image.kind === "etiqueta_energetica" ? "Etiqueta energética: va aparte" : "Icono o logo" });
    else if (other && other.width * other.height >= image.width * image.height) dropped.push({ ...image, reason: "Repetida (se queda la de más resolución)" });
    else if (Math.max(image.width, image.height) < MIN_SIDE) dropped.push({ ...image, reason: `Demasiado pequeña (${image.width}×${image.height})` });
    else keep.push(image);
  });
  const score = (image: ClassifiedImage) => RANK[image.kind] * 10 + (image.background === "blanco" ? 0 : image.background === "ambiente" ? 1 : 3) + (image.quality === "buena" ? 0 : image.quality === "regular" ? 1 : 4);
  keep.sort((a, b) => score(a) - score(b) || b.width * b.height - a.width * a.height);
  return { keep, dropped };
}

// Etiqueta energética: MHD da el SVG oficial de EPREL (`img_ficha_eficiencia`). Shopify no admite SVG como imagen de
// producto, así que se convierte a PNG.
export async function energyLabelPng(url: string) {
  const media = await fetchMhdMedia(url);
  const png = await sharp(media.bytes, { density: 150 }).resize({ height: 1200, withoutEnlargement: false }).png().toBuffer();
  const meta = await sharp(png).metadata();
  return { bytes: new Uint8Array(png), width: meta.width ?? 0, height: meta.height ?? 0, sourceType: media.contentType };
}

export function slugify(text: string) { return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
