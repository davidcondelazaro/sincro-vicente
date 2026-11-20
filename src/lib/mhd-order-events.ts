import type { SupabaseClient } from "@supabase/supabase-js";

// Registro de lo que pasa con los pedidos (mhd_sync_events, sync «pedidos»), para el resumen diario de pedidos
// (src/lib/mhd-order-report.ts). Un fallo al registrar no para nada: solo se pierde ese apunte.
export type OrderEventKind =
  | "traidos"            // { nuevos, actualizados, total }
  | "exportado"          // { pedido, mhd, auto }
  | "exportacion_fallida" // { pedido, error, auto }
  | "estado"             // { pedido, mhd, de, a }
  | "enviado"            // { pedido, mhd, seguimiento, auto }
  | "envio_fallido"      // { pedido, mhd, error }
  | "envio_revisar"      // { pedido, mhd, motivo }
  | "factura_shopify"    // { pedido, mhd, facturas }
  | "factura_correo"     // { enviados }
  | "cancelado_shopify"  // { pedido, mhd }
  | "entregado"          // { pedido, mhd, transportista, seguimiento, fecha, fuente }: evento «Entregado» en Shopify
  | "listo_recoger"      // { pedido, mhd, transportista, seguimiento, fecha, fuente }: «Listo para recoger» en Shopify
  | "entrega_revisar"    // { pedido, mhd, motivo }
  | "error";             // { proceso, texto }

export async function logOrderEvent(db: SupabaseClient, kind: OrderEventKind, detail: Record<string, unknown>, pedido?: string | null) {
  try { await db.from("mhd_sync_events").insert({ sync: "pedidos", kind, codigo: pedido ?? null, detail }); } catch { /* sin apunte */ }
}
