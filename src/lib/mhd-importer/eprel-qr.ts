import jsQR from "jsqr";
import sharp from "sharp";
import { fetchEprelClass, fetchMhdMedia } from "./sources";

// EPREL desde el QR de la etiqueta (David, 2026-11-18). Icecat no trae el número EPREL de todos los productos y MHD no
// lo da en ningún campo, pero la etiqueta oficial que entrega MHD (img_ficha_eficiencia, SVG de EPREL) lleva un QR con
// la dirección de la ficha: https://eprel.ec.europa.eu/qr/<número>. Solo se usa cuando Icecat no lo trae, y solo si el
// modelo registrado en EPREL coincide con el nuestro: MHD a veces pone la etiqueta de un modelo hermano (p. ej. la de la
// Hyundai HLF612IADW01 en la HLF612IADW02). Las etiquetas antiguas (hornos, campanas, termos…) no llevan QR.

const QR_EPREL = /eprel\.ec\.europa\.eu\/qr\/(\d+)/i;

export async function leerQrEtiqueta(bytes: Uint8Array): Promise<string | null> {
  for (const density of [150, 300]) {
    const png = await sharp(bytes, { density }).flatten({ background: "#ffffff" }).png().toBuffer().catch(() => null);
    if (!png) return null;
    const { width = 0, height = 0 } = await sharp(png).metadata();
    // Primero la etiqueta entera; si no, la esquina de arriba a la derecha, que es donde va el QR.
    for (const zona of [null, { left: Math.floor(width / 2), top: 0, width: Math.floor(width / 2), height: Math.floor(height * 0.3) }]) {
      const { data, info } = await (zona ? sharp(png).extract(zona) : sharp(png)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const leido = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), info.width, info.height);
      if (leido?.data) return leido.data;
    }
  }
  return null;
}

const norm = (texto: string) => texto.toUpperCase().replace(/[^A-Z0-9]/g, "");
// Trozos con pinta de modelo: letras y números, al menos 5 caracteres («HCB19560NCDW00», «32S4K»).
const trozosDeModelo = (texto: string) => texto.toUpperCase().split(/[\s,;/()"'-]+/).map(norm).filter((trozo) => trozo.length >= 5 && /[A-Z]/.test(trozo) && /\d/.test(trozo));

// El modelo de EPREL es el nuestro si algún trozo coincide o uno empieza por el otro (EPREL suele añadir el color o el
// mercado: «TLKC86W» → «TLKC86WS», «43E7S» → «43E7STUK»). Un dígito distinto lo descarta («…W01» frente a «…W02»).
export function modeloCoincide(modeloEprel: string | null, nuestros: (string | null | undefined)[]): boolean {
  if (!modeloEprel) return false;
  const deEprel = [norm(modeloEprel.split(/[\s(]/)[0] ?? ""), ...trozosDeModelo(modeloEprel)].filter((trozo) => trozo.length >= 5);
  const propios = nuestros.flatMap((texto) => (texto ? trozosDeModelo(texto) : []));
  return deEprel.some((m) => propios.some((k) => m === k || m.startsWith(k) || k.startsWith(m)));
}

export type EprelDeEtiqueta = { id: string | null; motivo: string; clase: Awaited<ReturnType<typeof fetchEprelClass>> };

export async function eprelDeLaEtiqueta(url: string, nuestros: (string | null | undefined)[]): Promise<EprelDeEtiqueta> {
  const media = await fetchMhdMedia(url);
  const qr = await leerQrEtiqueta(media.bytes);
  const id = qr?.match(QR_EPREL)?.[1] ?? null;
  if (!id) return { id: null, motivo: qr ? "El QR de la etiqueta no lleva número EPREL." : "La etiqueta no tiene QR legible.", clase: null };
  const clase = await fetchEprelClass(id);
  if (!clase) return { id: null, motivo: `EPREL ${id} no responde o no tiene clase.`, clase: null };
  if (!modeloCoincide(clase.model, nuestros)) return { id: null, motivo: `El QR de la etiqueta es de otro modelo (EPREL ${id}: ${clase.model ?? "?"}).`, clase: null };
  return { id, motivo: `EPREL ${id} leído del QR de la etiqueta (${clase.model}).`, clase };
}
