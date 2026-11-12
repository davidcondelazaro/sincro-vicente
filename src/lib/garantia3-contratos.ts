import type { SupabaseClient } from "@supabase/supabase-js";

// Contratos de Garantía3: las acciones sobre un contrato y cómo se enseña cada uno. Lo usan la pantalla de utils
// (/api/garantia3) y el contrato para el helpdesk (/api/admin/v1/garantia3), para que las reglas sean las mismas
// desde los dos sitios (helpdesk › docs/integracion-elvi.md § 3.8). Ver docs/GARANTIA3.md.

export const ESTADOS: Record<string, string> = { espera: "En espera", lista: "Lista", enviando: "Enviando", creado: "Creado", error: "Error", dudoso: "Dudoso", bloqueado: "Bloqueado", anulacion_pendiente: "Por anular", anulado: "Anulado" };
const TONOS: Record<string, "ok" | "warn" | "bad"> = { creado: "ok", error: "bad", dudoso: "warn", bloqueado: "warn", anulacion_pendiente: "warn" };

export const COLUMNAS = "id,shopify_order_name,unidad,order_created_at,sku,ean13,sku_aparato,nombre,apellidos,email,telefono,fecha_inicio,origen_fecha,fecha_prevista,estado,motivo,modo,contrato,pin,fecha_alta";
export type Contrato = {
  id: string; shopify_order_name: string; unidad: number; order_created_at: string | null; sku: string; ean13: string; sku_aparato: string | null;
  nombre: string | null; apellidos: string | null; email: string | null; telefono: string | null; fecha_inicio: string | null; origen_fecha: string | null;
  fecha_prevista: string | null; estado: string; motivo: string | null; modo: string; contrato: string | null; pin: string | null; fecha_alta: string | null;
};

export class AccionNoValida extends Error {}

/**
 * Cambia el estado de un contrato. null si ya no estaba en un estado desde el que se pueda (la pantalla lo dice).
 * reintentar (error o bloqueado → lista), pedir_ya (espera → lista), dudoso_creado (con su número de contrato),
 * dudoso_no_creado (→ lista, se vuelve a pedir), anular (creado → por anular) y anulado (por anular → anulado).
 */
export async function accionContrato(db: SupabaseClient, id: string, accion: string, numero?: string | null) {
  const cambiar = async (desde: string[], cambios: Record<string, unknown>) => {
    const { data, error } = await db.from("garantia3_contratos").update({ ...cambios, updated_at: new Date().toISOString() }).eq("id", id).in("estado", desde).select(COLUMNAS);
    if (error) throw error;
    return (data?.[0] as Contrato | undefined) ?? null;
  };
  switch (accion) {
    case "reintentar": return cambiar(["error", "bloqueado"], { estado: "lista", motivo: null, ultimo_aviso: null });
    case "pedir_ya": return cambiar(["espera"], { estado: "lista" });
    case "dudoso_creado":
      if (!numero?.trim()) throw new AccionNoValida("Falta el número de contrato.");
      return cambiar(["dudoso"], { estado: "creado", contrato: numero.trim(), motivo: null, fecha_alta: new Date().toISOString() });
    case "dudoso_no_creado": return cambiar(["dudoso"], { estado: "lista", motivo: null, ultimo_aviso: null });
    case "anular": return cambiar(["creado"], { estado: "anulacion_pendiente" });
    case "anulado": return cambiar(["anulacion_pendiente"], { estado: "anulado" });
    default: throw new AccionNoValida("Acción desconocida.");
  }
}

export const correoAnulacion = (fila: Pick<Contrato, "contrato" | "sku" | "ean13" | "shopify_order_name">) =>
  `mailto:info@bcwm.es?subject=${encodeURIComponent("Solicitud de anulación de garantía")}&body=${encodeURIComponent(`Estimados:\n\nSolicitamos la anulación de la siguiente garantía:\n\nContrato: ${fila.contrato}\nProducto: ${fila.sku}\nEAN: ${fila.ean13}\nPedido: ${fila.shopify_order_name}\n\nUn saludo.`)}`;

const fecha = (value: string | null) => (value ? new Date(value).toLocaleDateString("es-ES", { timeZone: "Europe/Madrid" }) : null);

/** Botones de cada estado, como en la pantalla de utils. `pide` = el número de contrato (resolver un dudoso). */
function acciones(fila: Contrato) {
  switch (fila.estado) {
    case "espera": return [{ key: "pedir_ya", label: "Pedir ya", confirm: `¿Pedir ya el contrato de ${fila.shopify_order_name}, sin esperar los días?` }];
    case "error":
    case "bloqueado": return [{ key: "reintentar", label: "Reintentar" }];
    case "dudoso": return [{ key: "dudoso_creado", label: "Se creó", pide: "Número de contrato (míralo en el portal de Garantía3)" }, { key: "dudoso_no_creado", label: "No se creó", confirm: "Se volverá a pedir el contrato. ¿Seguro que no se creó?" }];
    case "creado": return [{ key: "anular", label: "Anular", confirm: "Queda «Por anular»: después hay que pedir la anulación a Garantía3 por correo." }];
    case "anulacion_pendiente": return [{ key: "anulado", label: "Anulación hecha", confirm: "¿Garantía3 ya confirmó la anulación?" }];
    default: return [];
  }
}

/** Un contrato con los textos ya preparados para el helpdesk. */
export function contratoParaHelpdesk(fila: Contrato) {
  const enviado = fecha(fila.fecha_inicio);
  const sePide = fecha(fila.fecha_prevista);
  const detalles = [
    enviado ? `Enviado el ${enviado}${fila.origen_fecha === "Recogida en tienda" ? " (recogida en tienda)" : ""}` : "Sin enviar todavía",
    ...(sePide && ["espera", "lista"].includes(fila.estado) ? [`Se pide el ${sePide}`] : []),
    ...(fila.fecha_alta ? [`Alta el ${fecha(fila.fecha_alta)}`] : []),
  ];
  return {
    id: fila.id,
    order: fila.shopify_order_name,
    unit: fila.unidad,
    warranty: fila.sku,
    device: fila.sku_aparato,
    customer: [fila.nombre, fila.apellidos].filter(Boolean).join(" ") || null,
    email: fila.email,
    phone: fila.telefono,
    status: { label: ESTADOS[fila.estado] ?? fila.estado, tone: TONOS[fila.estado] },
    test: fila.modo === "test",
    reason: fila.motivo,
    contract: fila.contrato,
    pin: fila.pin,
    details: detalles,
    actions: acciones(fila),
    cancel_email: fila.estado === "anulacion_pendiente" ? correoAnulacion(fila) : null,
  };
}
