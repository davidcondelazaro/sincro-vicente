import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Servicio de portes para Shopify (CarrierService).
// FASE DE PRUEBA: registra lo que envía Shopify y devuelve una tarifa fija de 1 €.
// Ver theme-enterprise-vicente/docs/opciones-entrega.md.
export async function POST(request: Request) {
  const body = await request.text();
  console.log(
    "SHOPIFY_PORTES_REQUEST",
    JSON.stringify({ hmac: Boolean(request.headers.get("x-shopify-hmac-sha256")), body }),
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
