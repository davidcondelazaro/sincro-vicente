type MhdOrderNotesInput = {
  orderNote?: string | null;
  discountSummary?: string | null;
};

/** MHD admite una sola observación; preservamos la traza de Shopify en ella. */
export function buildMhdOrderObservations({ orderNote, discountSummary }: MhdOrderNotesInput) {
  return [
    orderNote?.trim() ? `Observaciones del pedido: ${orderNote.trim()}` : null,
    discountSummary?.trim() ? `Detalle de los descuentos aplicados: ${discountSummary.trim()}` : null,
  ].filter((section): section is string => Boolean(section)).join("\n");
}
