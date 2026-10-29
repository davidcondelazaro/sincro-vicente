import { after } from "next/server";
import { workerClient } from "@/lib/mhd-importer/jobs";
import { sourcesConfig } from "@/lib/mhd-importer/server";
import { continueCycle, startCycle } from "@/lib/mhd-importer/sync-cycle";

// Pasos de la vuelta de sincronización (src/lib/mhd-importer/sync-cycle.ts). La llama la base (mhd_sync_call): «inicio»
// al abrir la vuelta y «continuar» al acabar la lectura de MHD. Sin sesión, con la cabecera `x-mhd-import-token` (la
// clave de Vault de las lecturas de MHD). Contesta enseguida y trabaja después (pg_net espera 10 s como mucho).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const db = workerClient(process.env);
  const token = request.headers.get("x-mhd-import-token");
  const { data: valid } = token ? await db.rpc("mhd_import_token_valid", { p_token: token }) : { data: false };
  if (valid !== true) return Response.json({ error: "No autorizado" }, { status: 401 });
  const { cycle, step } = await request.json().catch(() => ({})) as { cycle?: string; step?: string };
  if (!cycle || (step !== "inicio" && step !== "continuar")) return Response.json({ error: "Falta la vuelta o el paso" }, { status: 400 });
  const deps = { db, sources: sourcesConfig(), env: process.env };
  after(async () => {
    try { console.log(JSON.stringify({ syncCycle: cycle, step, result: await (step === "inicio" ? startCycle(deps, cycle) : continueCycle(deps, cycle)) ?? "ok" })); }
    catch (caught) { console.error(JSON.stringify({ syncCycle: cycle, step, error: caught instanceof Error ? caught.message : String(caught) })); }
  });
  return Response.json({ ok: true }, { status: 202 });
}
