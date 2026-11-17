import { syncStoreStatuses } from "@/lib/mhd-importer/store-status-sync";
import { workerClient } from "@/lib/mhd-importer/jobs";
import { sourcesConfig } from "@/lib/mhd-importer/server";

// Estados de la tienda (src/lib/mhd-importer/store-status-sync.ts). La llama pg_cron cada noche antes del resumen, con la
// clave de las sincronizaciones (`x-mhd-import-token`). Tarda segundos, así que contesta con el resultado.
// `?simulacion=1` cuenta los cambios sin guardarlos.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  const db = workerClient(process.env);
  const token = request.headers.get("x-mhd-import-token");
  const { data: valid } = token ? await db.rpc("mhd_import_token_valid", { p_token: token }) : { data: false };
  if (valid !== true) return Response.json({ error: "No autorizado" }, { status: 401 });
  const dryRun = new URL(request.url).searchParams.get("simulacion") === "1";
  try {
    return Response.json(await syncStoreStatuses({ db, shopify: sourcesConfig().shopify }, { dryRun }));
  } catch (caught) {
    return Response.json({ error: caught instanceof Error ? caught.message : String(caught) }, { status: 500 });
  }
}
