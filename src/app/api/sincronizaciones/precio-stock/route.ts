import { after } from "next/server";
import { syncPriceStock } from "@/lib/mhd-importer/price-stock-sync";
import { workerClient } from "@/lib/mhd-importer/jobs";
import { sourcesConfig } from "@/lib/mhd-importer/server";

// Sincronización de precio y stock con Shopify (src/lib/mhd-importer/price-stock-sync.ts). La llama pg_cron cada 30 min,
// unos minutos después de lanzar la lectura de /prices y /stocks de MHD. Sin sesión, pero solo con la cabecera
// `x-mhd-import-token`: la misma clave que la base usa para las lecturas de MHD (Vault, `mhd_catalog_import_token`),
// comprobada con `mhd_import_token_valid`; nadie la copia. Manda a Shopify lo que ya está en la base (lo último leído
// de MHD frente a lo último enviado). `?simulacion=1` solo cuenta y no envía; `?codigos=a,b` limita a esos productos
// (para probar). En simulación o con códigos contesta con el resultado; si no, trabaja después de contestar.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const db = workerClient(process.env);
  const token = request.headers.get("x-mhd-import-token");
  const { data: valid } = token ? await db.rpc("mhd_import_token_valid", { p_token: token }) : { data: false };
  if (valid !== true) return Response.json({ error: "No autorizado" }, { status: 401 });
  const url = new URL(request.url);
  const dryRun = url.searchParams.get("simulacion") === "1";
  const codes = url.searchParams.get("codigos")?.split(",").map((code) => code.trim()).filter(Boolean);
  const run = () => syncPriceStock({ db, shopify: sourcesConfig().shopify }, { dryRun, codes });
  if (dryRun || codes?.length) return Response.json(await run());
  after(async () => {
    try { console.log(JSON.stringify({ priceStockSync: await run() })); }
    catch (caught) { console.error(JSON.stringify({ priceStockSync: "error", error: caught instanceof Error ? caught.message : String(caught) })); }
  });
  return Response.json({ ok: true }, { status: 202 });
}

