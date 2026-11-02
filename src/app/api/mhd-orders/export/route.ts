import { exportMhdOrder } from "@/lib/mhd-order-export";
import { messageOf } from "@/lib/mhd-order-sync";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const ownerId = claims?.claims.sub;
  if (!ownerId) return Response.json({ error: "Necesitas iniciar sesión." }, { status: 401 });

  let orderId: string;
  try { ({ orderId } = await request.json() as { orderId: string }); } catch { return Response.json({ error: "Solicitud de exportación no válida." }, { status: 400 }); }
  if (!orderId) return Response.json({ error: "Falta el pedido a exportar." }, { status: 400 });

  try {
    const result = await exportMhdOrder(supabase, ownerId, orderId);
    return result.ok ? Response.json(result) : Response.json(result, { status: result.status });
  } catch (error) {
    console.error("MHD order export failed", { orderId, message: messageOf(error) });
    return Response.json({ error: messageOf(error), trace: "No se ha enviado nada a MHD." }, { status: 502 });
  }
}
