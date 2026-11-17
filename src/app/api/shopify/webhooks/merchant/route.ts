import { createHmac, timingSafeEqual } from "node:crypto";
import { workerClient } from "@/lib/mhd-importer/jobs";

// Avisos de Shopify (webhooks) para Google Merchant (src/lib/merchant). Cualquier cambio de un producto o de su
// inventario, también los hechos a mano en el panel, mete el producto en la cola de Merchant (merchant_cola); el
// trabajador lee Shopify y solo manda lo que de verdad cambie. Temas: products/update, products/delete e
// inventory_levels/update. La conciliación de cada noche sigue de red. Firma con SHOPIFY_API_SECRET, como el servicio
// de portes; sin firma válida no se hace nada.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function firmaValida(cuerpo: string, firma: string | null) {
  const secreto = process.env.SHOPIFY_API_SECRET;
  if (!secreto || !firma) return false;
  const esperada = createHmac("sha256", secreto).update(cuerpo, "utf8").digest();
  const recibida = Buffer.from(firma, "base64");
  return recibida.length === esperada.length && timingSafeEqual(recibida, esperada);
}

export async function POST(request: Request) {
  const cuerpo = await request.text();
  if (!firmaValida(cuerpo, request.headers.get("x-shopify-hmac-sha256"))) {
    console.warn("MERCHANT_WEBHOOK firma no válida");
    return new Response("Firma no válida", { status: 401 });
  }
  const tema = request.headers.get("x-shopify-topic") ?? "";
  let datos: { id?: number; inventory_item_id?: number };
  try { datos = JSON.parse(cuerpo); } catch { return new Response("ok"); }
  const db = workerClient(process.env);
  const filtro = tema.startsWith("inventory_levels/")
    ? datos.inventory_item_id ? { columna: "inventory_item_id", valor: `gid://shopify/InventoryItem/${datos.inventory_item_id}` } : null
    : datos.id ? { columna: "product_id", valor: `gid://shopify/Product/${datos.id}` } : null;
  if (!filtro) return new Response("ok");
  const { data } = await db.from("store_shopify_ids").select("codigo").eq(filtro.columna, filtro.valor);
  // Productos propios (garantías, servicios…) no están en store_shopify_ids: no se encolan.
  for (const fila of data ?? []) await db.rpc("merchant_encolar", { p_codigo: fila.codigo, p_motivo: `shopify ${tema}` });
  return new Response("ok");
}
