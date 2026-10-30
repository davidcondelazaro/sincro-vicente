import { resumenMensualGarantia3, vigilanteGarantia3, vueltaGarantia3 } from "@/lib/garantia3-vuelta";
import { workerClient } from "@/lib/mhd-importer/jobs";

// Tareas de Garantía3 (docs/GARANTIA3.md). Las llama pg_cron sin sesión pero con la cabecera `x-mhd-import-token`.
// ?tipo=vuelta, mensual o vigilante.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const db = workerClient(process.env);
  const token = request.headers.get("x-mhd-import-token");
  const { data: valid } = token ? await db.rpc("mhd_import_token_valid", { p_token: token }) : { data: false };
  if (valid !== true) return Response.json({ error: "No autorizado" }, { status: 401 });
  const tipo = new URL(request.url).searchParams.get("tipo");
  if (tipo === "vuelta") return Response.json(await vueltaGarantia3(db, process.env, "programada"));
  if (tipo === "vigilante") return Response.json(await vigilanteGarantia3(db));
  if (tipo === "mensual") return Response.json(await resumenMensualGarantia3(db));
  return Response.json({ error: "Tipo desconocido" }, { status: 400 });
}
