import { createClient } from "@/lib/supabase/server";
import { workerClient } from "@/lib/mhd-importer/jobs";
import { estadoMerchant } from "@/lib/merchant/estado";

// Pantalla «Google Merchant»: estado del envío de portes, plazos, EPREL e inventario regional (src/lib/merchant).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await createClient();
  const { data } = await session.auth.getUser();
  if (!data.user) return Response.json({ error: "Sin sesión" }, { status: 401 });
  try {
    return Response.json(await estadoMerchant(workerClient(process.env)));
  } catch (caught) {
    return Response.json({ error: caught instanceof Error ? caught.message : String(caught) }, { status: 500 });
  }
}
