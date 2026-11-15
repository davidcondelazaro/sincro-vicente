// Reacondicionados siempre en borrador (David, 2026-11-15): no se sabe qué grado tiene cada uno ni qué significa, y la
// garantía de 1 año no tiene un pacto válido. Hasta que MHD conteste y lo decida quien lleve lo legal, no se venden.
// La regla sale de la familia, no de una lista: cualquier familia, título de familia o subfamilia de MHD que contenga
// «reacondicionad» (hoy smartphones-reacondicionados y portatiles-reacondicionados). La subida los crea en DRAFT y no
// vuelve a poner en ACTIVE los que ya estaban; no toca nada más de la ficha.
// Para quitarla cuando se puedan vender: REFURBISHED_ALWAYS_DRAFT = false (o borrar este módulo y su uso en
// shopify-draft.ts) y pasar a ACTIVE a mano los que estén en borrador.
export const REFURBISHED_ALWAYS_DRAFT = true;

const plain = (text: string) => text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function isRefurbished(...names: (string | null | undefined)[]) {
  return names.some((name) => !!name && plain(name).includes("reacondicionad"));
}

export function keepRefurbishedInDraft(...names: (string | null | undefined)[]) {
  return REFURBISHED_ALWAYS_DRAFT && isRefurbished(...names);
}
