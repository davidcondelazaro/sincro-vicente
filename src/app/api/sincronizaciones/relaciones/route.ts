import { after } from "next/server";
import { syncRelations } from "@/lib/mhd-importer/relations-sync";
import { workerClient } from "@/lib/mhd-importer/jobs";
import { sourcesConfig } from "@/lib/mhd-importer/server";
import { sendAlert } from "@/lib/mhd-importer/alerts";

// Relaciones de Icecat en Shopify (src/lib/mhd-importer/relations-sync.ts). La llama pg_cron una vez al día, con la misma
// clave que el resto de sincronizaciones (`x-mhd-import-token`). `?simulacion=1` solo cuenta, no envía y contesta con el
// resultado; si no, trabaja después de contestar.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const db = workerClient(process.env);
  const token = request.headers.get("x-mhd-import-token");
  const { data: valid } = token ? await db.rpc("mhd_import_token_valid", { p_token: token }) : { data: false };
  if (valid !== true) return Response.json({ error: "No autorizado" }, { status: 401 });
  const dryRun = new URL(request.url).searchParams.get("simulacion") === "1";
  const run = () => syncRelations({ db, shopify: sourcesConfig().shopify }, { dryRun });
  if (dryRun) return Response.json(await run());
  after(async () => {
    try { console.log(JSON.stringify({ relationsSync: await run() })); }
    catch (caught) {
      const error = caught instanceof Error ? caught.message : String(caught);
      console.error(JSON.stringify({ relationsSync: "error", error }));
      await sendAlert(db, { key: "relaciones:caida", subject: "Relaciones de Icecat: la sincronización se ha caído", lines: ["La sincronización de relaciones ha fallado a medias:", error] });
    }
  });
  return Response.json({ ok: true }, { status: 202 });
}
