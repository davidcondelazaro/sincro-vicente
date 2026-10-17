type ShopifyCustomAttribute = { key?: string | null; value?: string | null };

type MhdOrderNotesInput = {
  orderNote?: string | null;
  discountSummary?: string | null;
  customAttributes?: ShopifyCustomAttribute[] | null;
  shipTogetherEnabled?: boolean;
};

/** Atributo que el carrito del theme guarda cuando el cliente marca «Enviar todo junto». */
export const SHIP_TOGETHER_ATTRIBUTE = "Enviar todo junto";
/** Desactivado el 17-10-2026 por decisión del usuario (se quitó el interruptor del carrito). Poner a `true` para reactivarlo. */
export const SHIP_TOGETHER_ENABLED = false;
export const SHIP_TOGETHER_NOTE = "El cliente pide que se envíen todos los artículos juntos.";

export function wantsShipTogether(customAttributes?: ShopifyCustomAttribute[] | null) {
  return (customAttributes ?? []).some((attribute) => attribute.key?.trim() === SHIP_TOGETHER_ATTRIBUTE && attribute.value?.trim().normalize("NFC") === "Sí");
}

/** MHD admite una sola observación; preservamos la traza de Shopify en ella. */
export function buildMhdOrderObservations({ orderNote, discountSummary, customAttributes, shipTogetherEnabled = SHIP_TOGETHER_ENABLED }: MhdOrderNotesInput) {
  return [
    orderNote?.trim() ? `Observaciones del pedido: ${orderNote.trim()}` : null,
    shipTogetherEnabled && wantsShipTogether(customAttributes) ? SHIP_TOGETHER_NOTE : null,
    discountSummary?.trim() ? `Detalle de los descuentos aplicados: ${discountSummary.trim()}` : null,
  ].filter((section): section is string => Boolean(section)).join("\n");
}
