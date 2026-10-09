import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

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

type Zona = "peninsula" | "baleares" | "portugal_1" | "portugal_2";

const CLAVE_PORTES: Record<Zona, string> = {
  peninsula: "gastos_envio_peninsula_particulares",
  baleares: "gastos_envio_baleares_particulares",
  portugal_1: "gastos_envio_portugal_baremo_1_particulares",
  portugal_2: "gastos_envio_portugal_baremo_2_particulares",
};

type Destino = { country?: string; province?: string; postal_code?: string };
type Linea = { sku?: string; quantity?: number; grams?: number; product_id?: number; properties?: Record<string, string> };

function zonaDeEnvio(destino: Destino): Zona | null {
  const pais = destino.country;
  const provincia = destino.province ?? "";
  const cp = String(destino.postal_code ?? "").replace(/\s/g, "");

  if (pais === "ES") {
    const prefijo = cp.slice(0, 2);
    // Canarias (GC, TF / 35, 38), Ceuta (CE / 51) y Melilla (ML / 52): sin envío
    if (["GC", "TF", "CE", "ML"].includes(provincia) || ["35", "38", "51", "52"].includes(prefijo)) return null;
    if (provincia === "PM" || prefijo === "07") return "baleares";
    return "peninsula";
  }

  if (pais === "PT") {
    // Baremos de MHD por código postal (4 primeras cifras); 9000-9999 son las islas, sin envío
    const numero = Number.parseInt(cp.slice(0, 4), 10);
    if (Number.isNaN(numero) || numero >= 9000) return null;
    if ((numero >= 2200 && numero <= 2499) || (numero >= 3000 && numero <= 4999)) return "portugal_1";
    return "portugal_2";
  }

  return null;
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

  const zona = zonaDeEnvio(destino);
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
  for (const linea of lineas) {
    const opciones = linea.product_id ? portesPorProducto.get(linea.product_id) : null;
    if (!opciones) continue; // Sin datos de MHD: 0 €
    const valor = opciones[CLAVE_PORTES[zona]];
    if (valor === null || valor === undefined || valor === "") {
      console.log("SHOPIFY_PORTES", JSON.stringify({ ...resumen, resultado: `sin envío a ${zona} para ${linea.sku}` }));
      return sinTarifas();
    }
    centimos += Math.round(Number(valor) * 100) * (linea.quantity ?? 1);
  }

  console.log("SHOPIFY_PORTES", JSON.stringify({ ...resumen, centimos }));
  return NextResponse.json({
    rates: [
      {
        service_name: "Envío a domicilio",
        service_code: "envio_domicilio",
        description: "Envío 100% asegurado",
        total_price: String(centimos),
        currency: "EUR",
      },
    ],
  });
}
