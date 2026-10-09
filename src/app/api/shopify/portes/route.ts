import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Servicio de portes para Shopify (CarrierService).
// FASE DE PRUEBA: registra lo que envía Shopify y devuelve una tarifa fija de 1 €.
// Ver theme-enterprise-vicente/docs/opciones-entrega.md.
// Solo se registra lo necesario para calcular portes: nada de nombre, calle, teléfono ni empresa.
type ShopifyRateItem = { sku?: string; quantity?: number; grams?: number; properties?: Record<string, string> };

export async function POST(request: Request) {
  const body = await request.text();
  let resumen: unknown = "cuerpo no válido";
  try {
    const { rate } = JSON.parse(body);
    resumen = {
      destino: {
        pais: rate?.destination?.country,
        provincia: rate?.destination?.province,
        cp: rate?.destination?.postal_code,
      },
      lineas: (rate?.items ?? []).map((item: ShopifyRateItem) => ({
        sku: item.sku,
        cantidad: item.quantity,
        gramos: item.grams,
        propiedades: item.properties,
      })),
    };
  } catch {
    // Se registra solo que no se pudo leer
  }
  console.log(
    "SHOPIFY_PORTES_REQUEST",
    JSON.stringify({ hmac: Boolean(request.headers.get("x-shopify-hmac-sha256")), resumen }),
  );

  return NextResponse.json({
    rates: [
      {
        service_name: "Prueba portes",
        service_code: "prueba_portes",
        description: "Tarifa de prueba",
        total_price: "100",
        currency: "EUR",
      },
    ],
  });
}
