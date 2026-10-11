// Etiquetas del análisis de conversaciones del chatbot (columnas sentiment, outcome y topic de conversations).
export const sentimentLabels: Record<string, string> = { positivo: "Positivo", neutro: "Neutro", negativo: "Negativo", frustrado: "Frustrado" };
export const outcomeLabels: Record<string, string> = { resuelta: "Resuelta", parcial: "Parcial", no_resuelta: "No resuelta", abandonada: "Abandonada" };
export const topicLabels: Record<string, string> = { eleccion: "Elegir producto", info_producto: "Info de un producto", envio: "Envío y portes", postventa: "Pedido o postventa", garantia_instalacion: "Garantía o instalación", otro: "Otro" };
// Tono de cada sentimiento (fondo y texto); siempre va con su nombre, nunca solo el color.
export const sentimentTones: Record<string, string> = { positivo: "bg-emerald-50 text-emerald-800", neutro: "bg-zinc-100 text-zinc-700", negativo: "bg-amber-50 text-amber-800", frustrado: "bg-red-50 text-red-800" };
