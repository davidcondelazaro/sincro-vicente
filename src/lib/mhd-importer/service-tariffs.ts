import type { SupabaseClient } from "@supabase/supabase-js";
import { sendAlert } from "./alerts";
import { shopifyGraphql, type ShopifyConfig } from "./store-filters";

// Tarifas de servicios (David, 2026-10-31; docs/SINCRONIZACIONES_MHD.md › Tarifas de servicios). El tema ofrece cada
// servicio buscando la variante con el precio que da MHD en cada aparato: si esa variante no existe, el servicio
// desaparece de la ficha sin ningún error (y la retirada se ofrecería con el precio de su variante). Paso de la vuelta:
// compara los importes del listado con las variantes de Shopify y avisa de los que faltan. Se repite una vez al día
// mientras sigan faltando; una tarifa nueva avisa al momento.
const REPEAT_MINUTES = 24 * 60;
const RETIRADA = "servicio-retirada-aparato-usado";
const SERVICES = [
  { name: "Subida a puerta", handle: "servicio-subida-a-puerta", field: "subida_puerta_particulares", sku: "SUBIDA-" },
  { name: "Instalación", handle: "servicio-instalacion", field: "instalacion_particulares", sku: "INSTALACION-" },
  { name: "Retirada del aparato usado", handle: RETIRADA, field: "retirada_usado_particulares", sku: "RETIRADA-" },
] as const;
type Service = (typeof SERVICES)[number];
type ListingRow = { codigo: string } & Record<Service["field"], string | null>;
export type MissingTariff = { service: string; handle: string; sku: string; cents: number; products: number; examples: string[] };

const euros = (cents: number) => `${(cents / 100).toFixed(2).replace(".", ",")} €`;

// Pura. `variants`: céntimos de las variantes de cada producto de servicio, por handle.
export function missingServiceTariffs(rows: ListingRow[], variants: Record<string, number[]>) {
  const missing: MissingTariff[] = [];
  for (const service of SERVICES) {
    const byCents = new Map<number, string[]>();
    for (const row of rows) {
      const value = row[service.field];
      if (value === null || value === "" || !Number.isFinite(Number(value))) continue;
      const cents = Math.round(Number(value) * 100);
      if (!variants[service.handle]?.includes(cents)) byCents.set(cents, [...(byCents.get(cents) ?? []), row.codigo]);
    }
    for (const [cents, codes] of [...byCents].sort(([a], [b]) => a - b)) missing.push({ service: service.name, handle: service.handle, sku: `${service.sku}${cents}`, cents, products: codes.length, examples: codes.slice(0, 5) });
  }
  return missing;
}

async function listingRows(db: SupabaseClient) {
  const rows: ListingRow[] = [];
  const fields = SERVICES.map((service) => `${service.field}:source_payload->>${service.field}`).join(",");
  const anyService = SERVICES.map((service) => `source_payload->>${service.field}.not.is.null`).join(",");
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("mhd_catalog_products").select(`codigo,${fields}`).eq("presence_status", "present").or(anyService).order("codigo").range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []) as unknown as ListingRow[]);
    if ((data ?? []).length < 1000) return rows;
  }
}

async function serviceVariants(shopify: ShopifyConfig) {
  const aliases = SERVICES.map((service, index) => `s${index}: productByIdentifier(identifier: { handle: "${service.handle}" }) { status variants(first: 100) { nodes { price } } }`).join(" ");
  const data = await shopifyGraphql<Record<string, { status: string; variants: { nodes: { price: string }[] } } | null>>(shopify, `{ ${aliases} }`);
  return Object.fromEntries(SERVICES.map((service, index) => {
    const product = data[`s${index}`];
    return [service.handle, product?.status === "ACTIVE" ? product.variants.nodes.map((variant) => Math.round(Number(variant.price) * 100)) : []];
  }));
}

export async function checkServiceTariffs(deps: { db: SupabaseClient; shopify: ShopifyConfig }) {
  try {
    const [rows, variants] = await Promise.all([listingRows(deps.db), serviceVariants(deps.shopify)]);
    const missing = missingServiceTariffs(rows, variants);
    if (missing.length) await sendAlert(deps.db, {
      key: `servicios:tarifas:${missing.map((item) => item.sku).join(",")}`, quietMinutes: REPEAT_MINUTES,
      subject: `Servicios: ${missing.length === 1 ? "1 tarifa de MHD" : `${missing.length} tarifas de MHD`} sin variante en Shopify`,
      lines: [
        "Estos aparatos no ofrecerán el servicio en la web hasta crear la variante con ese precio exacto:",
        ...missing.map((item) => `${item.service}: ${euros(item.cents)} (${item.products} productos, p. ej. ${item.examples.join(", ")}). SKU ${item.sku}, producto ${item.handle}.`),
        "Crearla sin seguimiento de stock y sin requerir envío. La exportación a MHD la reconoce sola por el SKU.",
        missing.some((item) => item.handle === RETIRADA) ? "La retirada necesita además un cambio en el tema: hoy ofrece siempre su primera variante, sin mirar el precio." : "El tema la encuentra solo por el precio.",
      ],
    });
    return { products: rows.length, missing };
  } catch (caught) {
    // Es una comprobación: si falla, no debe parar la vuelta.
    return { error: caught instanceof Error ? caught.message : String(caught) };
  }
}
