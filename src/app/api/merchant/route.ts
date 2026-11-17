import { workerClient } from "@/lib/mhd-importer/jobs";
import { shopifyConfigFromEnv } from "@/lib/mhd-importer/store-filters";
import { merchantConfig } from "@/lib/merchant/api";
import { conciliar, leerAvisos } from "@/lib/merchant/conciliacion";
import { trabajarCola } from "@/lib/merchant/trabajador";

// Google Merchant Center (src/lib/merchant). La llama pg_cron con la clave de las sincronizaciones (`x-mhd-import-token`):
// - `?accion=cola` (cada 10 minutos): trabaja la cola de portes, plazos, EPREL e inventario regional.
// - `?accion=conciliar` (cada noche): foto de lo que hay en Merchant Center y todo a la cola.
// - `?accion=avisos` (cada hora): cuántas ofertas tienen cada aviso de Google y cuáles mandadas siguen sin aplicar.
// `&maximo=N` limita los productos de una vuelta de la cola (pruebas).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const db = workerClient(process.env);
  const token = request.headers.get("x-mhd-import-token");
  const { data: valid } = token ? await db.rpc("mhd_import_token_valid", { p_token: token }) : { data: false };
  if (valid !== true) return Response.json({ error: "No autorizado" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const accion = params.get("accion");
  try {
    const deps = { db, merchant: merchantConfig(), shopify: shopifyConfigFromEnv(process.env) };
    if (accion === "cola") return Response.json(await trabajarCola(deps, { maximo: Number(params.get("maximo")) || undefined }));
    if (accion === "conciliar") return Response.json(await conciliar(deps));
    if (accion === "avisos") return Response.json(await leerAvisos(deps));
    return Response.json({ error: "accion: cola, conciliar o avisos" }, { status: 400 });
  } catch (caught) {
    return Response.json({ error: caught instanceof Error ? caught.message : String(caught) }, { status: 500 });
  }
}
