// Pieza del importador: comprueba que lo que trae Icecat (y la etiqueta energética) es de nuestro modelo (decidido
// 2026-10-23). Icecat a veces tiene un EAN asociado a otro producto (la Electrolux EW6F3924AL devolvía la EN6F5922FB,
// con su etiqueta, ficha UE y EPREL), y el SVG de MHD sale de una copia de Icecat por EAN, así que repite el error.
// 1) Si el modelo de MHD coincide con el de Icecat, vale. 2) Si no (muchas marcas ponen en MHD un código interno),
// una llamada pequeña compara los títulos. 3) Si es otro producto, se busca en Icecat por marca y modelo; si tampoco,
// el producto sigue sin Icecat y se publica igual (sin etiqueta si no hay una buena).
import type Anthropic from "@anthropic-ai/sdk";
import { costUsd, PROCESSOR_MODEL } from "./ai";
import type { IcecatSummary } from "./icecat";

export const normalizeModel = (value: string | null | undefined) => (value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export function sameModel(ref: string | null, icecat: IcecatSummary) {
  const model = normalizeModel(ref);
  if (model.length < 4) return false;
  return [icecat.partCode, icecat.modelName].some((candidate) => { const other = normalizeModel(candidate); return other.length >= 4 && (other === model || other.includes(model) || model.includes(other)); });
}

const schema = { type: "object", additionalProperties: false, required: ["same", "reason"], properties: { same: { type: "boolean" }, reason: { type: "string" } } };

export async function checkIcecatIdentity(client: Anthropic, product: { title: string; brand: string; ref: string | null }, icecat: IcecatSummary) {
  if (sameModel(product.ref, icecat)) return { same: true, method: "modelo" as const, reason: "El modelo coincide.", costUsd: 0 };
  const message = await client.messages.create({ model: PROCESSOR_MODEL, max_tokens: 400, output_config: { effort: "low", format: { type: "json_schema", schema } }, messages: [{ role: "user", content: `¿Son el mismo producto (mismo modelo)?\nMHD: «${product.title}» (marca ${product.brand}, referencia ${product.ref ?? "sin referencia"}; la referencia puede ser un código interno del proveedor).\nIcecat: «${icecat.title ?? ""}» (marca ${icecat.brand ?? ""}, código ${icecat.partCode ?? ""}, modelo ${icecat.modelName ?? ""}).\nResponde same=true solo si es el mismo modelo, aunque se nombre o codifique distinto. Otro modelo, otra capacidad u otro juego es same=false. En reason, una frase en español.` }] });
  const parsed = JSON.parse(message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("")) as { same: boolean; reason: string };
  return { ...parsed, method: "ia" as const, costUsd: costUsd(PROCESSOR_MODEL, message.usage) ?? 0 };
}

// Texto de la etiqueta: del SVG (elementos <text>) o del PDF (MuPDF). Una imagen no se puede leer: devuelve null.
export async function labelText(bytes: Uint8Array, kind: "svg" | "pdf" | "image") {
  if (kind === "svg") {
    const svg = new TextDecoder().decode(bytes);
    return [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map((match) => match[1].replace(/<[^>]+>/g, "")).join(" ");
  }
  if (kind === "pdf") {
    const mupdf = await import("mupdf");
    const doc = mupdf.Document.openDocument(bytes, "application/pdf");
    return doc.loadPage(0).toStructuredText("preserve-whitespace").asText();
  }
  return null;
}

// ¿La etiqueta es de alguno de nuestros modelos? Vale el modelo entero o un trozo con cifras de 5 o más caracteres
// (MHD pone a veces «LC 24700 BLANCO» y la etiqueta, «LC 24700 WH»). Sin texto legible: null (no se puede saber).
export function labelMatches(text: string | null, models: (string | null)[]) {
  const normalized = normalizeModel(text);
  if (normalized.length < 20) return null;
  const pieces = models.flatMap((model) => [normalizeModel(model), ...(model ?? "").toUpperCase().split(/[^A-Z0-9]+/)]).filter((piece) => piece.length >= 5 && /\d/.test(piece));
  return pieces.some((piece) => normalized.includes(piece));
}
