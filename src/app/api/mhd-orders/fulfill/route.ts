import { logOrderEvent } from "@/lib/mhd-order-events";
import { fulfillShopifyOrder, type TrackingInput } from "@/lib/mhd-order-fulfill";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Botón «Marcar enviado en Shopify». La lógica está en src/lib/mhd-order-fulfill.ts, compartida con el envío automático.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims.sub) return Response.json({ error: "Necesitas iniciar sesión." }, { status: 401 });

  let input: { orderId?: string; tracking?: TrackingInput; notifyCustomer?: boolean };
  try { input = await request.json(); } catch { return Response.json({ error: "Solicitud no válida." }, { status: 400 }); }
  if (!input.orderId) return Response.json({ error: "Falta el pedido." }, { status: 400 });

  const result = await fulfillShopifyOrder(supabase, input.orderId, input.tracking ?? {}, Boolean(input.notifyCustomer));
  if (result.ok) {
    const { data: order } = await supabase.from("shopify_mhd_orders").select("shopify_order_name").eq("id", input.orderId).maybeSingle();
    const name = (order?.shopify_order_name as string | undefined) ?? null;
    await logOrderEvent(supabase, "enviado", { pedido: name, seguimiento: input.tracking?.entries?.map((entry) => entry.number).filter(Boolean).join(", ") ?? null, transportista: input.tracking?.company ?? null, auto: false }, name);
    return Response.json({ fulfillments: result.fulfillments });
  }
  return Response.json({ error: result.error, trace: result.trace }, { status: result.status });
}
