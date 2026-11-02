import { previewMhdExport } from "@/lib/mhd-order-export";
import { messageOf } from "@/lib/mhd-order-sync";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lo que se enviaría a MHD, para confirmarlo en pantalla. Solo lee: no envía ni registra nada.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims.sub) return Response.json({ error: "Necesitas iniciar sesión." }, { status: 401 });

  let orderId: string;
  try { ({ orderId } = await request.json() as { orderId: string }); } catch { return Response.json({ error: "Solicitud no válida." }, { status: 400 }); }
  if (!orderId) return Response.json({ error: "Falta el pedido." }, { status: 400 });

  try {
    const result = await previewMhdExport(supabase, orderId);
    return result.ok ? Response.json(result) : Response.json(result, { status: result.status });
  } catch (error) {
    return Response.json({ error: messageOf(error) }, { status: 502 });
  }
}
