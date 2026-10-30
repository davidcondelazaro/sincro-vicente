import { refreshMhdStatuses } from "@/lib/mhd-order-sync";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims.sub) return Response.json({ error: "Necesitas iniciar sesión." }, { status: 401 });
  try {
    return Response.json(await refreshMhdStatuses(supabase));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudieron cargar los pedidos exportados." }, { status: 500 });
  }
}
