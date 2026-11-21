import { createHash } from "node:crypto";

// Lo que debe tener cada oferta en Google Merchant Center (encargo: theme-enterprise-vicente/docs/encargo-merchant-api-sincro.md).
// Todo puro: se prueba en tests/merchant.test.mjs.
//
// - Un porte por país (en España y Portugal Google no admite zonas por debajo del país): ES = península, PT = baremo 2
//   (David, 2026-11-17). Baleares, Canarias, Ceuta, Melilla, Azores y Madeira se excluyen en Google Ads por ubicación.
//   Hasta el 21-11 las islas iban como `out_of_stock` por inventario regional, pero Google rechazaba la oferta en todo el
//   país al ver la web «en stock»; el trabajador quita lo que quede (región en `region`).
// - El porte es el que cobra el pago (src/app/api/shopify/portes): el del metacampo custom.opciones_entrega. Sin
//   metacampo, el último porte conocido de MHD (decidido el 17-11); sin ninguno, no se manda nada.
// - Plazo: preparación 0 y tránsito = los días del texto de disponibilidad, igual que el tema
//   (snippets/structured-data-product.liquid). Con stock, custom.disponibilidad_con_stock; si no, _sin_stock.
// - Etiqueta energética: certification EC / EPREL / código de custom.eprel.

export type Pais = "ES" | "PT";
export type Opciones = Record<string, unknown> | null;

export const PAISES: Record<Pais, { feedLabel: string; clavePorte: string; region: string }> = {
  ES: { feedLabel: "EUR_102307004748", clavePorte: "gastos_envio_peninsula_particulares", region: "sinenvioes" },
  PT: { feedLabel: "EUR_103610450252", clavePorte: "gastos_envio_portugal_baremo_2_particulares", region: "sinenviopt" },
};
export const IDIOMA = "es";

export type Esperado = {
  porte: string | null;          // «7.99»; null = sin porte conocido (no se manda)
  origen: "metacampo" | "ultimo-mhd" | null;
  transito: [number, number] | null;
  eprel: string | null;
};

export type ProductoTienda = {
  productId: string;             // gid://shopify/Product/…
  variantId: string;             // gid://shopify/ProductVariant/…
  codigo: string;
  activo: boolean;
  opciones: Opciones;            // metacampo custom.opciones_entrega
  opcionesMhd: Opciones;         // último porte conocido de MHD (mhd_catalog_products.source_payload)
  conStock: string | null;
  sinStock: string | null;
  stock: number | null;
  eprel: string | null;
};

const numero = (id: string) => id.split("/").pop()!;
export const offerId = (productId: string, variantId: string) => `shopify_ZZ_${numero(productId)}_${numero(variantId)}`;
export const nombreProducto = (pais: Pais, oferta: string) => `${IDIOMA}~${PAISES[pais].feedLabel}~${oferta}`;

// Como el filtro `plus: 0` de Liquid: solo convierte si todo el texto es un número.
function aNumero(texto: string | undefined) {
  if (!texto) return 0;
  if (/^-?\d+$/.test(texto)) return Number(texto);
  if (/^-?\d[\d.]+$/.test(texto)) return Number.parseFloat(texto);
  return 0;
}

// «Recíbelo en 3/4 días laborables» → [3, 4]; «72/96 horas» → [3, 4]; «3 semanas» → [15, 15]. Sin número, null.
export function plazoEnDias(texto: string | null | undefined): [number, number] | null {
  const plazo = (texto ?? "").toLowerCase();
  let min = 0; let max = 0;
  for (const palabra of plazo.replaceAll(",", "").replaceAll(".", "").split(" ")) {
    const partes = palabra.split("/");
    const n = aNumero(partes[0]);
    if (n > 0) { min = n; max = aNumero(partes.at(-1)); break; }
  }
  if (min <= 0) return null;
  if (plazo.includes("semana")) { min *= 5; max *= 5; }
  else if (plazo.includes("hora")) { min = Math.ceil(min / 24); max = Math.ceil(max / 24); }
  if (max < min) max = min;
  return [min, max];
}

function importe(valor: unknown): string | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) && n >= 0 ? n.toFixed(2) : null;
}

export function esperado(producto: ProductoTienda, pais: Pais): Esperado {
  const clave = PAISES[pais].clavePorte;
  // Con metacampo manda el metacampo, aunque esa zona venga vacía (el pago no envía allí): no se rellena con MHD.
  const deMetacampo = producto.opciones ? importe(producto.opciones[clave]) : null;
  const deMhd = !producto.opciones && producto.opcionesMhd ? importe(producto.opcionesMhd[clave]) : null;
  const porte = deMetacampo ?? deMhd;
  const texto = (producto.stock ?? 0) > 0 ? producto.conStock : producto.sinStock;
  const eprel = producto.eprel?.trim() || null;
  return { porte, origen: deMetacampo ? "metacampo" : deMhd ? "ultimo-mhd" : null, transito: plazoEnDias(texto), eprel };
}

export function huella(datos: Esperado | null) {
  if (!datos || !datos.porte) return null;
  return createHash("sha1").update(JSON.stringify([datos.porte, datos.transito, datos.eprel])).digest("hex").slice(0, 16);
}

const micros = (euros: string) => String(Math.round(Number(euros) * 1_000_000));

// El ProductInput de la fuente complementaria de un país: solo ese país (si no, Google extiende la oferta al otro).
export function entradaProducto(oferta: string, pais: Pais, datos: Esperado) {
  const envio: Record<string, unknown> = { country: pais, price: { amountMicros: micros(datos.porte!), currencyCode: "EUR" } };
  if (datos.transito) Object.assign(envio, { minHandlingTime: "0", maxHandlingTime: "0", minTransitTime: String(datos.transito[0]), maxTransitTime: String(datos.transito[1]) });
  return {
    offerId: oferta, contentLanguage: IDIOMA, feedLabel: PAISES[pais].feedLabel,
    productAttributes: {
      shipping: [envio],
      ...(datos.eprel ? { certifications: [{ certificationAuthority: "EC", certificationName: "EPREL", certificationCode: datos.eprel }] } : {}),
    },
  };
}

type ProductoMerchant = {
  productAttributes?: {
    shipping?: { country?: string; price?: { amountMicros?: string }; minTransitTime?: string; maxTransitTime?: string }[];
    certifications?: { certificationAuthority?: string; certificationName?: string; certificationCode?: string }[];
  };
};

// Lo que Merchant Center aplica de verdad a una oferta (fuente principal + complementarias), en la misma forma que
// `esperado`, para comparar. Solo cuenta el envío del país de la oferta.
export function realDeMerchant(producto: ProductoMerchant, pais: Pais): Esperado {
  const envio = producto.productAttributes?.shipping?.find((item) => item.country === pais);
  const certificado = producto.productAttributes?.certifications?.find((item) => item.certificationAuthority === "EC" && item.certificationName === "EPREL");
  const amount = envio?.price?.amountMicros;
  const min = Number(envio?.minTransitTime ?? 0); const max = Number(envio?.maxTransitTime ?? 0);
  return {
    porte: amount !== undefined ? (Number(amount) / 1_000_000).toFixed(2) : null,
    origen: null,
    transito: max > 0 ? [min, max] : null,
    eprel: certificado?.certificationCode ?? null,
  };
}
