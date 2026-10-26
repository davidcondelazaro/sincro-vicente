// Pieza del importador: vídeos MP4 de Icecat (decidido 2026-10-23). Una llamada pequeña decide si cada vídeo es del
// producto (muestra este modelo o su serie) o de marca (anuncio o tecnología genérica que se repite en muchos
// productos); el código los descarga y les saca la huella para subir cada vídeo a Shopify una sola vez.
// El del producto (uno, el primero) va a la galería; los demás, a `custom.videos` para la pestaña «Vídeos».
import type Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { costUsd, PROCESSOR_MODEL } from "./ai";
import type { IcecatVideo } from "./icecat";
import { slugify } from "./images";
import { fetchIcecatDocument, type IcecatConfig } from "./sources";

export type VideoKind = "producto" | "marca";
export type PreparedVideo = { url: string; description: string; kind: VideoKind; reason: string; filename: string; bytes: Uint8Array; hash: string; sizeBytes: number; contentType: string };

const schema = { type: "object", additionalProperties: false, required: ["videos"], properties: { videos: { type: "array", items: { type: "object", additionalProperties: false, required: ["index", "kind", "reason"], properties: { index: { type: "integer" }, kind: { type: "string", enum: ["producto", "marca"] }, reason: { type: "string" } } } } } };

export async function classifyVideos(client: Anthropic, product: { title: string; brand: string; model: string; series: string | null }, videos: IcecatVideo[]) {
  if (!videos.length) return { kinds: [] as { kind: VideoKind; reason: string }[], costUsd: 0, usage: null };
  const list = videos.map((video, index) => `${index}: «${video.description || "sin título"}»`).join("\n");
  const message = await client.messages.create({ model: PROCESSOR_MODEL, max_tokens: 1500, output_config: { effort: "low", format: { type: "json_schema", schema } }, messages: [{ role: "user", content: `Producto: ${product.title} (marca ${product.brand}, modelo ${product.model}${product.series ? `, serie ${product.series}` : ""}).\nVídeos que trae su ficha de Icecat (solo el título):\n${list}\n\nPara cada vídeo indica kind: «producto» si muestra este modelo o su serie, o «marca» si es un anuncio de la marca o explica una tecnología o función genérica que la marca usa en muchos modelos. Si dudas, «marca». En reason, una frase en español.` }] });
  const parsed = JSON.parse(message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("")) as { videos: { index: number; kind: VideoKind; reason: string }[] };
  return { kinds: videos.map((_, index) => parsed.videos.find((item) => item.index === index) ?? { kind: "marca" as const, reason: "Sin clasificar" }), costUsd: costUsd(PROCESSOR_MODEL, message.usage), usage: message.usage };
}

// Nombres: el del producto, como sus fotos (`lavadora-electrolux-ew6f…-video.mp4`); los de marca, por marca y título
// (`electrolux-video-sensicare.mp4`), porque se comparten entre productos.
// El almacenamiento de Supabase admite 50 MiB por archivo; Shopify, 1 GB por vídeo.
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

export async function prepareVideos(config: IcecatConfig, videos: IcecatVideo[], kinds: { kind: VideoKind; reason: string }[], names: { productBase: string; brand: string }) {
  const prepared: PreparedVideo[] = []; const errors: string[] = []; const seen = new Set<string>();
  let productVideos = 0;
  for (const [index, video] of videos.entries()) {
    try {
      const media = await fetchIcecatDocument(config, video.url);
      // Más de 50 MB no cabe en el almacenamiento de las pruebas (y rompería el producto entero): no se usa.
      if (media.bytes.byteLength > MAX_VIDEO_BYTES) { errors.push(`Vídeo demasiado grande (${(media.bytes.byteLength / 1_000_000).toFixed(1).replace(".", ",")} MB; máximo 50 MB): no se usa ${video.url}`); continue; }
      const hash = createHash("sha1").update(media.bytes).digest("hex");
      if (seen.has(hash)) continue;
      seen.add(hash);
      const kind = kinds[index]?.kind ?? "marca";
      if (kind === "producto") productVideos += 1;
      const filename = kind === "producto" ? `${names.productBase}-video${productVideos > 1 ? `-${productVideos}` : ""}.mp4` : `${slugify(names.brand)}-video-${slugify(video.description || hash.slice(0, 8))}.mp4`;
      prepared.push({ url: video.url, description: video.description, kind, reason: kinds[index]?.reason ?? "", filename, bytes: media.bytes, hash, sizeBytes: media.bytes.byteLength, contentType: "video/mp4" });
    } catch (caught) { errors.push(caught instanceof Error ? caught.message : `No se pudo descargar ${video.url}`); }
  }
  return { videos: prepared, errors };
}
