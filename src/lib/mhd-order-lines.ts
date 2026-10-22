// Líneas de producto de un pedido de Shopify en el formato de POST /orders de MHD.
// Ver docs/API_MHD.md y docs/PEDIDOS_MHD_FASE_1.md.
// - Aparatos: líneas sin lineItemGroup. Van a MHD con su precio y sus portes por unidad.
// - Servicios (SUBIDA-*, RETIRADA, INSTALACION-*): líneas anidadas bajo su aparato. No van como productos, sino
//   como subida/retirada/instalacion de la línea del aparato, con el precio unitario pagado.
// - Otras líneas anidadas (garantías): no son de MHD y no se envían.
// - Portes: los del metacampo custom.opciones_entrega de cada aparato para la zona de envío, los mismos que usó
//   el servicio de portes del checkout. La suma (porte × cantidad) debe coincidir con el envío cobrado.

export type Zona = "peninsula" | "baleares" | "portugal_1" | "portugal_2";

export const CLAVE_PORTES: Record<Zona, string> = {
  peninsula: "gastos_envio_peninsula_particulares",
  baleares: "gastos_envio_baleares_particulares",
  portugal_1: "gastos_envio_portugal_baremo_1_particulares",
  portugal_2: "gastos_envio_portugal_baremo_2_particulares",
};

export function zonaDeEnvio(destino: { country?: string | null; province?: string | null; postalCode?: string | null }): Zona | null {
  const pais = destino.country;
  const provincia = destino.province ?? "";
  const cp = String(destino.postalCode ?? "").replace(/\s/g, "");

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

export type ShopifyLinePayload = {
  lineItemGroup?: { variantSku?: string | null } | null;
  product?: { metafield?: { value?: string | null } | null } | null;
};
export type OrderLineInput = { sku: string | null; quantity: number; unitPrice: string | number; payload: ShopifyLinePayload | null };
export type MhdProductLine = {
  codigo: string; cantidad: number; precio: number; portes: number;
  subida: boolean; precio_subida: number | null;
  instalacion: boolean; precio_instalacion: number | null;
  retirada: boolean; precio_retirada: number | null;
};
type Servicio = "subida" | "instalacion" | "retirada";

function servicioDeSku(sku: string): Servicio | null {
  if (/^SUBIDA-/.test(sku)) return "subida";
  if (/^INSTALACION-/.test(sku)) return "instalacion";
  if (sku === "RETIRADA") return "retirada";
  return null;
}

const centimos = (importe: number | string) => Math.round(Number(importe) * 100);
const euros = (cents: number) => `${(cents / 100).toFixed(2).replace(".", ",")} €`;

export function buildMhdProductLines(input: {
  lines: OrderLineInput[];
  destination: { country?: string | null; province?: string | null; postalCode?: string | null };
  shippingAmount: string | number;
}): { ok: true; productos: MhdProductLine[]; warning: string | null } | { ok: false; reason: string } {
  // Pedidos sincronizados antes de leer servicios y portes no traen product ni lineItemGroup
  if (input.lines.some((line) => !line.payload || !("product" in line.payload) || !("lineItemGroup" in line.payload))) {
    return { ok: false, reason: "Faltan datos de portes y servicios: vuelve a actualizar los pedidos desde Shopify" };
  }

  const aparatos = input.lines.filter((line) => !line.payload?.lineItemGroup);
  const anidadas = input.lines.filter((line) => line.payload?.lineItemGroup);
  if (!aparatos.length) return { ok: false, reason: "El pedido no tiene aparatos que enviar a MHD" };

  const zona = zonaDeEnvio(input.destination);
  if (!zona) return { ok: false, reason: "MHD no hace envíos a domicilio a este destino" };

  const productos: MhdProductLine[] = [];
  const sinDatos: string[] = [];
  for (const aparato of aparatos) {
    const valor = aparato.payload?.product?.metafield?.value;
    let portes = 0; // Sin datos de MHD: 0 €, como en el servicio de portes (decisión del 10-10-2026: se exporta igual, con aviso)
    if (!valor) sinDatos.push(aparato.sku!);
    else {
      const porte = (JSON.parse(valor) as Record<string, unknown>)[CLAVE_PORTES[zona]];
      if (porte === null || porte === undefined || porte === "") return { ok: false, reason: `${aparato.sku} no tiene portes para la zona ${zona}` };
      portes = Number(porte);
    }
    productos.push({
      codigo: aparato.sku!, cantidad: aparato.quantity, precio: Number(aparato.unitPrice), portes,
      subida: false, precio_subida: null, instalacion: false, precio_instalacion: null, retirada: false, precio_retirada: null,
    });
  }

  for (const linea of anidadas) {
    const servicio = servicioDeSku(linea.sku ?? "");
    if (!servicio) continue; // Garantías y otras líneas propias: no van a MHD
    const skuAparato = linea.payload?.lineItemGroup?.variantSku;
    const candidatos = productos.filter((producto) => producto.codigo === skuAparato);
    if (candidatos.length !== 1) return { ok: false, reason: `No se puede asociar ${linea.sku} a un único aparato (${skuAparato ?? "sin SKU"})` };
    const aparato = candidatos[0];
    if (linea.quantity !== aparato.cantidad) return { ok: false, reason: `${linea.sku} tiene ${linea.quantity} uds. y su aparato ${aparato.codigo} ${aparato.cantidad}` };
    if (aparato[servicio]) return { ok: false, reason: `${aparato.codigo} lleva el servicio ${servicio} repetido` };
    aparato[servicio] = true;
    aparato[`precio_${servicio}`] = Number(linea.unitPrice);
  }

  const conSubidaEInstalacion = productos.find((producto) => producto.subida && producto.instalacion);
  if (conSubidaEInstalacion) return { ok: false, reason: `${conSubidaEInstalacion.codigo} lleva subida e instalación a la vez (la instalación ya incluye la subida)` };

  const portesCalculados = productos.reduce((total, producto) => total + centimos(producto.portes) * producto.cantidad, 0);
  const portesCobrados = centimos(input.shippingAmount);
  if (portesCalculados !== portesCobrados) {
    return { ok: false, reason: `Los portes por producto suman ${euros(portesCalculados)} y en Shopify se cobraron ${euros(portesCobrados)}` };
  }

  const warning = sinDatos.length
    ? `${sinDatos.length === 1 ? "1 producto" : `${sinDatos.length} productos`} sin datos de portes de MHD (${sinDatos.join(", ")}): se envían a 0 €`
    : null;
  return { ok: true, productos, warning };
}
