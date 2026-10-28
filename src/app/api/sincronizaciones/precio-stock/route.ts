import { after } from "next/server";
import { syncPriceStock } from "@/lib/mhd-importer/price-stock-sync";
import { workerClient } from "@/lib/mhd-importer/jobs";
import { sourcesConfig } from "@/lib/mhd-importer/server";

// Sincronización de precio y stock con Shopify (src/lib/mhd-importer/price-stock-sync.ts). La llama pg_cron cada 30 min,
// unos minutos después de lanzar la lectura de /prices y /stocks de MHD. No pide sesión ni clave: solo manda a Shopify
// lo que ya está en la base (lo último leído de MHD frente a lo último enviado). `?simulacion=1` solo cuenta y no envía;
// `?codigos=a,b` limita a esos productos (para probar). En simulación contesta con el resultado; si no, trabaja después
// de contestar.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const url = new URL(request.url);
  const dryRun = url.searchParams.get("simulacion") === "1";
  const codes = url.searchParams.get("codigos")?.split(",").map((code) => code.trim()).filter(Boolean);
  const run = () => syncPriceStock({ db: workerClient(process.env), shopify: sourcesConfig().shopify }, { dryRun, codes });
  if (dryRun || codes?.length) return Response.json(await run());
  after(async () => {
    try { console.log(JSON.stringify({ priceStockSync: await run() })); }
    catch (caught) { console.error(JSON.stringify({ priceStockSync: "error", error: caught instanceof Error ? caught.message : String(caught) })); }
  });
  return Response.json({ ok: true }, { status: 202 });
}

export const GET = POST;
