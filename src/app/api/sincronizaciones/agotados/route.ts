import { syncAbsences } from "@/lib/mhd-importer/absences";
import { workerClient } from "@/lib/mhd-importer/jobs";
import { sourcesConfig } from "@/lib/mhd-importer/server";

// Agotados en MHD a mano (src/lib/mhd-importer/absences.ts), con la última lectura del listado. Lo normal es que lo haga
// la vuelta; esto sirve para probar (`?simulacion=1`: confirma con MHD y cuenta, sin tocar Shopify) y para la primera
// puesta al día, que pasa del freno (`?forzar=1`). Con la cabecera `x-mhd-import-token`, como el resto de rutas sin sesión.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const db = workerClient(process.env);
  const token = request.headers.get("x-mhd-import-token");
  const { data: valid } = token ? await db.rpc("mhd_import_token_valid", { p_token: token }) : { data: false };
  if (valid !== true) return Response.json({ error: "No autorizado" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const { data: run } = await db.from("mhd_catalog_import_runs").select("id").eq("status", "completed").contains("entities", ["products"]).not("last_activity_at", "is", null).order("last_activity_at", { ascending: false }).limit(1).maybeSingle();
  if (!run) return Response.json({ error: "No hay ninguna lectura del listado terminada." }, { status: 409 });
  const result = await syncAbsences({ db, sources: sourcesConfig() }, { runId: run.id, dryRun: params.get("simulacion") === "1", force: params.get("forzar") === "1" });
  return Response.json({ ok: true, run: run.id, ...result });
}
