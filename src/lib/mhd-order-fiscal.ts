// NIF y empresa del pedido para MHD (David, 18-11-2026). Ver docs/PEDIDOS_MHD_FASE_1.md, «NIF y empresa».
// - El NIF sale del campo fiscal del pago (Order.localizedFields, clave TAX_CREDENTIAL_ES, _PT…). En pedidos y
//   direcciones de antes del 18-11-2026 el DNI se escribía en «Empresa»: se acepta si tiene forma de DNI, NIE o CIF.
// - El NIF va en facturación. En envío siempre va un espacio, salvo que la facturación no se pueda exportar.
// - Empresa de facturación con NIF: va de nombre (apellidos vacíos) y la persona de contacto, a observaciones.
//   Sin NIF, o si la empresa está en la dirección de envío, solo a observaciones.
// No importa nada para poder probarlo con node --test.

export type DireccionFiscal = { name?: string | null; firstName?: string | null; lastName?: string | null; company?: string | null };
export type CampoLocalizado = { key?: string | null; value?: string | null };
export type PedidoFiscal = {
  localizedFields?: { nodes?: CampoLocalizado[] | null } | null;
  shippingAddress?: DireccionFiscal | null;
  billingAddress?: DireccionFiscal | null;
};

/** Si MHD no admite apellidos vacíos, cambiar por " " (como NIF_VACIO). */
export const APELLIDOS_EMPRESA = "";

function limpio(valor?: string | null) {
  return (valor ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
}
function compacto(valor: string) {
  return valor.toUpperCase().replace(/[\s.\-_/]/g, "").replace(/^ES(?=[0-9A-Z]{9}$)/, "");
}

// DNI, NIE, CIF españoles y NIF portugués (9 cifras). Solo para reconocer el DNI escrito en «Empresa».
export function pareceNif(valor?: string | null) {
  const nif = compacto(limpio(valor));
  return /^\d{8}[A-Z]$/.test(nif) || /^[XYZ]\d{7}[A-Z]$/.test(nif) || /^[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J]$/.test(nif) || /^\d{9}$/.test(nif);
}

export function nifDelPedido(pedido: PedidoFiscal) {
  const campo = (pedido.localizedFields?.nodes ?? []).find((item) => item.key?.startsWith("TAX_CREDENTIAL_") && limpio(item.value));
  if (campo) return compacto(limpio(campo.value));
  const enEmpresa = [pedido.billingAddress?.company, pedido.shippingAddress?.company].find((valor) => pareceNif(valor));
  return enEmpresa ? compacto(limpio(enEmpresa)) : null;
}

// «Empresa» que no es un DNI escrito ahí
function empresa(direccion?: DireccionFiscal | null) {
  const valor = limpio(direccion?.company);
  return valor && !pareceNif(valor) ? valor : null;
}
function persona(direccion?: DireccionFiscal | null) {
  return limpio([direccion?.firstName, direccion?.lastName].filter(Boolean).join(" ")) || limpio(direccion?.name) || null;
}

export type DatosFiscalesMhd = {
  nif: string | null;
  /** NIF de la dirección de envío; null = el espacio de siempre (NIF_VACIO). */
  nifEnvio: string | null;
  /** Nombre y apellidos que sustituyen a los de la persona en facturación, si factura una empresa con NIF. */
  facturacion: { nombre: string; apellidos: string } | null;
  observaciones: string | null;
};

/**
 * @param facturacionExportable si la dirección de facturación se puede mandar a MHD (completa y con provincia habilitada).
 * @param recogida en la recogida la dirección de envío es la tienda: su «Empresa» es la del cliente y no se repite.
 */
export function datosFiscalesMhd(pedido: PedidoFiscal, { facturacionExportable, recogida = false }: { facturacionExportable: boolean; recogida?: boolean }): DatosFiscalesMhd {
  const nif = nifDelPedido(pedido);
  const empresaFacturacion = empresa(pedido.billingAddress);
  const empresaEnvio = recogida ? null : empresa(pedido.shippingAddress);
  const notas: string[] = [];
  let facturacion: DatosFiscalesMhd["facturacion"] = null;

  if (empresaFacturacion && nif && facturacionExportable) {
    facturacion = { nombre: empresaFacturacion, apellidos: APELLIDOS_EMPRESA };
    const contacto = persona(pedido.billingAddress);
    notas.push(`Facturar a: ${empresaFacturacion} (NIF ${nif}).${contacto ? ` Contacto: ${contacto}.` : ""}`);
  } else if (empresaFacturacion) {
    notas.push(`Empresa en la dirección de facturación: ${empresaFacturacion}${nif ? ` (NIF ${nif})` : " (sin NIF)"}.`);
  }
  if (empresaEnvio && empresaEnvio.toLowerCase() !== empresaFacturacion?.toLowerCase()) {
    notas.push(`Empresa en la dirección de envío: ${empresaEnvio}.`);
  }
  return { nif, nifEnvio: facturacionExportable ? null : nif, facturacion, observaciones: notas.join("\n") || null };
}
