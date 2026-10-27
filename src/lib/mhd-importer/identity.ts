// Pieza del importador: comprueba que lo que trae Icecat (y la etiqueta energética) es de nuestro modelo (decidido
// 2026-10-23). Icecat a veces tiene un EAN asociado a otro producto (la Electrolux EW6F3924AL devolvía la EN6F5922FB,
// con su etiqueta, ficha UE y EPREL), y el SVG de MHD sale de una copia de Icecat por EAN, así que repite el error.
// 1) Si el modelo de MHD coincide con el de Icecat, vale. 2) Si no (muchas marcas ponen en MHD un código interno),
// una llamada pequeña compara los títulos. 3) Si es otro producto, se busca en Icecat por marca y modelo; si tampoco,
// el producto sigue sin Icecat y se publica igual (sin etiqueta si no hay una buena).
import type Anthropic from "@anthropic-ai/sdk";
import { costUsd, createStreamed, PROCESSOR_MODEL } from "./ai";
import type { IcecatSummary } from "./icecat";

export const normalizeModel = (value: string | null | undefined) => (value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export function sameModel(ref: string | null, icecat: IcecatSummary) {
  const model = normalizeModel(ref);
  if (model.length < 4) return false;
  return [icecat.partCode, icecat.modelName].some((candidate) => { const other = normalizeModel(candidate); return other.length >= 4 && (other === model || other.includes(model) || model.includes(other)); });
}

const schema = { type: "object", additionalProperties: false, required: ["same", "reason"], properties: { same: { type: "boolean" }, reason: { type: "string" } } };

// Referencia interna de MHD (2026-10-27): un código del proveedor que no comparte ni cuatro caracteres seguidos con el
// modelo de Icecat (soportes «TV90306487», «VC321231» frente a «WM-70T-03»). Con ella, la IA rechazaba fichas buenas por
// «la referencia no coincide» (1 de cada 4 soportes). Un modelo parecido pero distinto («DT80T-053» y «DT80F-305»)
// comparte tramos y sigue con la comprobación estricta.
export function looksInternal(ref: string | null, icecat: Pick<IcecatSummary, "partCode" | "modelName">) {
  const model = normalizeModel(ref);
  if (model.length < 4) return false;
  const others = [icecat.partCode, icecat.modelName].map(normalizeModel).filter((value) => value.length >= 4);
  for (let i = 0; i + 4 <= model.length; i += 1) if (others.some((other) => other.includes(model.slice(i, i + 4)))) return false;
  return true;
}

export async function checkIcecatIdentity(client: Anthropic, product: { title: string; brand: string; ref: string | null }, icecat: IcecatSummary, byEan = true) {
  if (sameModel(product.ref, icecat)) return { same: true, method: "modelo" as const, reason: "El modelo coincide.", costUsd: 0 };
  const internal = looksInternal(product.ref, icecat);
  const guide = byEan && internal
    ? `Icecat se ha encontrado por el mismo EAN que el producto de MHD. La referencia de MHD (${product.ref}) es un código interno del proveedor que no se parece al modelo del fabricante, así que NO la compares con el modelo de Icecat. Decide por la marca, el tipo de producto y lo que diga el título de MHD (medidas, pulgadas, capacidad, color, modelo si lo nombra). Responde same=false solo si hay una contradicción clara: otro tipo de producto, otra marca, otra medida o capacidad, otro color que diga el título, u otro modelo que nombre el título de MHD.`
    : `La referencia puede ser un código interno del proveedor. Responde same=true solo si es el mismo modelo, aunque se nombre o codifique distinto. Otro modelo, otra capacidad u otro juego es same=false.`;
  const message = await createStreamed(client, { model: PROCESSOR_MODEL, max_tokens: 2000, output_config: { effort: "low", format: { type: "json_schema", schema } }, messages: [{ role: "user", content: `¿Son el mismo producto (mismo modelo)?\nMHD: «${product.title}» (marca ${product.brand}, referencia ${product.ref ?? "sin referencia"}).\nIcecat: «${icecat.title ?? ""}» (marca ${icecat.brand ?? ""}, código ${icecat.partCode ?? ""}, modelo ${icecat.modelName ?? ""}).\n${guide} En reason, una frase en español.` }] });
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
