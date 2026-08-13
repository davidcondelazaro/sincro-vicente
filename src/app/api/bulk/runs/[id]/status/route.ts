import { createClient as createSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const { status } = await request.json() as { status?: "paused" | "stopped" | "queued" };
  if (!status || !["paused", "stopped", "queued"].includes(status)) return Response.json({ error: "Estado no válido." }, { status: 400 });
  const supabase = await createSupabaseClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims.sub) return Response.json({ error: "Necesitas iniciar sesión." }, { status: 401 });
  const { data, error } = await supabase.rpc("set_customer_import_status", { p_run_id: id, p_status: status });
  if (error || !data) return Response.json({ error: error?.message ?? "No se pudo actualizar la ejecución." }, { status: 400 });
  await supabase.functions.invoke("sync-prestashop-customers", { body: {} });
  return Response.json({ status: data });
}
