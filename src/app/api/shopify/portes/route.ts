import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { CLAVE_PORTES, zonaDeEnvio } from "@/lib/mhd-order-lines";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Servicio de portes para Shopify (CarrierService). Ver theme-enterprise-vicente/docs/opciones-entrega.md.
// Shopify manda la dirección de destino y las líneas que requieren envío (los aparatos; servicios y garantías
// no requieren envío y no llegan). Para cada aparato se leen sus portes de MHD del metacampo
// custom.opciones_entrega y se suman por unidad (MHD: los portes son siempre por unidad).
// - Aparato sin metacampo: 0 € (decisión del 9-10-2026: sin datos de MHD, envío gratis).
// - Aparato con metacampo pero sin portes para la zona (null): no se envía a esa zona → sin tarifa.
// - Zona sin envío (Canarias, Ceuta, Melilla, islas de Portugal, otros países): sin tarifa.
// En los registros solo va lo necesario para calcular: nada de nombre, calle, teléfono ni empresa.

type Destino = { country?: string; province?: string; postal_code?: string };
type Linea = { sku?: string; quantity?: number; grams?: number; product_id?: number; requires_shipping?: boolean; properties?: Record<string, string> };

// Descuento en portes por varios artículos (fijo desde el 2026-11-18): con 2 o más unidades que se envían
// (aparatos y accesorios; garantías, servicios y tarjetas regalo no requieren envío y no cuentan) se cobra un 20 %
// menos. El tema calcula lo mismo en los portes estimados del carrito (theme-enterprise-vicente/snippets/
// cart-portes-estimados.liquid): si se cambia aquí, cambiarlo allí. Redondeo al céntimo, la mitad hacia arriba.
const DESCUENTO_VARIOS = { minimoUnidades: 2, porcentaje: 20 };

function portesConDescuento(centimos: number, unidades: number): number {
  if (unidades < DESCUENTO_VARIOS.minimoUnidades) return centimos;
  return Math.floor((centimos * (100 - DESCUENTO_VARIOS.porcentaje) + 50) / 100);
}

function firmaValida(cuerpo: string, firma: string | null): boolean | null {
  const secreto = process.env.SHOPIFY_API_SECRET;
  if (!secreto) return null; // Sin secreto configurado no se puede comprobar
  if (!firma) return false;
  const esperada = createHmac("sha256", secreto).update(cuerpo, "utf8").digest();
  const recibida = Buffer.from(firma, "base64");
  return recibida.length === esperada.length && timingSafeEqual(recibida, esperada);
}

async function opcionesEntrega(idsProducto: number[]): Promise<Map<number, Record<string, unknown> | null>> {
  const tienda = (process.env.SHOPIFY_STORE_URL ?? "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const respuesta = await fetch(`https://${tienda}/admin/api/2026-07/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN ?? "" },
    cache: "no-store",
    body: JSON.stringify({
      query: `query Portes($ids: [ID!]!) { nodes(ids: $ids) { ... on Product { id metafield(namespace: "custom", key: "opciones_entrega") { value } } } }`,
      variables: { ids: idsProducto.map((id) => `gid://shopify/Product/${id}`) },
    }),
  });
  if (!respuesta.ok) throw new Error(`Shopify ${respuesta.status}`);
  const datos = await respuesta.json();
  if (datos.errors) throw new Error(JSON.stringify(datos.errors).slice(0, 300));

  const resultado = new Map<number, Record<string, unknown> | null>();
  for (const nodo of datos.data?.nodes ?? []) {
    if (!nodo?.id) continue;
    const id = Number(String(nodo.id).split("/").pop());
    resultado.set(id, nodo.metafield?.value ? JSON.parse(nodo.metafield.value) : null);
  }
  return resultado;
}

const sinTarifas = () => NextResponse.json({ rates: [] });

export async function POST(request: Request) {
  const cuerpo = await request.text();
  const firma = firmaValida(cuerpo, request.headers.get("x-shopify-hmac-sha256"));
  if (firma === false) {
    console.warn("SHOPIFY_PORTES firma no válida");
    return new NextResponse("Firma no válida", { status: 401 });
  }

  let destino: Destino = {};
  let lineas: Linea[] = [];
  try {
    const { rate } = JSON.parse(cuerpo);
    destino = rate?.destination ?? {};
    lineas = rate?.items ?? [];
  } catch {
    console.warn("SHOPIFY_PORTES cuerpo no válido");
    return sinTarifas();
  }

  const zona = zonaDeEnvio({ country: destino.country, province: destino.province, postalCode: destino.postal_code });
  const resumen = {
    firma: firma === null ? "sin comprobar" : "válida",
    destino: { pais: destino.country, provincia: destino.province, cp: destino.postal_code },
    zona,
    lineas: lineas.map((l) => ({ sku: l.sku, cantidad: l.quantity, producto: l.product_id })),
  };

  if (!zona) {
    console.log("SHOPIFY_PORTES", JSON.stringify({ ...resumen, resultado: "zona sin envío" }));
    return sinTarifas();
  }

  const ids = [...new Set(lineas.map((l) => l.product_id).filter((id): id is number => Boolean(id)))];
  let portesPorProducto: Map<number, Record<string, unknown> | null>;
  try {
    portesPorProducto = await opcionesEntrega(ids);
  } catch (error) {
    // Sin respuesta válida, Shopify usa las tarifas de respaldo si están configuradas
    console.error("SHOPIFY_PORTES error leyendo Shopify", String(error));
    return new NextResponse("Error", { status: 500 });
  }

  let centimos = 0;
  let unidades = 0;
  for (const linea of lineas) {
    if (linea.requires_shipping === false) continue; // Por si llegan garantías, servicios o tarjetas regalo
    unidades += linea.quantity ?? 1;
    const opciones = linea.product_id ? portesPorProducto.get(linea.product_id) : null;
    if (!opciones) continue; // Sin datos de MHD: 0 €
    const valor = opciones[CLAVE_PORTES[zona]];
    if (valor === null || valor === undefined || valor === "") {
      console.log("SHOPIFY_PORTES", JSON.stringify({ ...resumen, resultado: `sin envío a ${zona} para ${linea.sku}` }));
      return sinTarifas();
    }
    centimos += Math.round(Number(valor) * 100) * (linea.quantity ?? 1);
  }

  const total = portesConDescuento(centimos, unidades);
  const conDescuento = total < centimos;
  console.log("SHOPIFY_PORTES", JSON.stringify({ ...resumen, unidades, centimos, total }));
  return NextResponse.json({
    rates: [
      {
        // El aviso va en el nombre, que el pago siempre enseña (la descripción no siempre sale)
        service_name: conDescuento
          ? `Envío a domicilio (${DESCUENTO_VARIOS.porcentaje} % menos por ${DESCUENTO_VARIOS.minimoUnidades} o más artículos)`
          : "Envío a domicilio",
        service_code: "envio_domicilio",
        description: "Envío 100% asegurado",
        total_price: String(total),
        currency: "EUR",
      },
    ],
  });
}
