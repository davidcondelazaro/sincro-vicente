import { createClient as createSupabaseClient } from "@/lib/supabase/server";

// La importación la hace la función de Supabase `mhd-catalog-import`, página a
// página. Esta ruta solo lanza, detiene, reanuda y consulta, siempre con la
// sesión del usuario (las funciones de la base de datos exigen sesión).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const kinds = new Set(["full", "categories", "brands", "products", "prices", "stock", "details", "details_all"]);

async function session() {
  const supabase = await createSupabaseClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims.sub ? supabase : null;
}

export async function GET() {
  const supabase = await session();
  if (!supabase) return Response.json({ error: "Necesitas iniciar sesión." }, { status: 401 });
  const { data, error } = await supabase.rpc("mhd_import_status", { p_limit: 20 });
  if (error) return Response.json({ error: "No se pudo consultar el historial MHD." }, { status: 500 });
  return Response.json(data);
}

export async function POST(request: Request) {
  const supabase = await session();
  if (!supabase) return Response.json({ error: "Necesitas iniciar sesión." }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { action?: string; kind?: string; runId?: string };
  const call = body.action === "start"
    ? (kinds.has(body.kind ?? "") ? supabase.rpc("mhd_import_start", { p_kind: body.kind }) : null)
    : body.runId && body.action === "stop" ? supabase.rpc("mhd_import_stop", { p_run_id: body.runId })
    : body.runId && body.action === "resume" ? supabase.rpc("mhd_import_resume", { p_run_id: body.runId })
    : body.runId && body.action === "discard" ? supabase.rpc("mhd_import_discard", { p_run_id: body.runId })
    : null;
  if (!call) return Response.json({ error: "Petición no válida." }, { status: 400 });
  const { data, error } = await call;
  if (error) return Response.json({ error: error.message }, { status: 409 });
  console.log(JSON.stringify({ mhdImport: body.action, kind: body.kind, runId: body.runId ?? data }));
  return Response.json({ ok: true, runId: body.runId ?? data });
}
