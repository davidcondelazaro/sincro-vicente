import { messageOf, syncShopifyOrders } from "@/lib/mhd-order-sync";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const progress = { stage: "comprobando sesión" };
  try {
    const supabase = await createClient(); const { data: claims } = await supabase.auth.getClaims(); const ownerId = claims?.claims.sub;
    if (!ownerId) return Response.json({ error: "Necesitas iniciar sesión." }, { status: 401 });
    progress.stage = "consultando Shopify";
    return Response.json(await syncShopifyOrders(supabase, ownerId, progress));
  } catch (error) {
    const message = messageOf(error);
    console.error("MHD Shopify order sync failed", { stage: progress.stage, message });
    return Response.json({ error: message, trace: `Falló al ${progress.stage}.` }, { status: 500 });
  }
}
