import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anthropicKey, costUsd, createStreamed, PROCESSOR_MODEL } from "@/lib/mhd-importer/ai";
import { enviadoEnMhd, horaEnMadrid, type Seguimiento } from "@/lib/mhd-order-auto-rules";
import { orderAlert, orderSettings } from "@/lib/mhd-order-auto";
import { logOrderEvent } from "@/lib/mhd-order-events";
import { shopify } from "@/lib/mhd-order-fulfill";
import { accionEnShopify, debeMirarEntrega, enviadoDesde, LECTORES, madridAIso, type PedidoEnShopify, type Traslado, leerPaginaSeguimiento, type EstadoEntrega, type LecturaEntrega } from "@/lib/mhd-order-tracking";

// Entregas y recogidas (docs/PEDIDOS_MHD_FASE_1.md › Entregas y recogidas, 20-11-2026). Cada hora de 8 a 21 (Madrid),
// con el interruptor pedidos_entrega_auto_activo:
// - Solo pedidos que MHD da por enviados, con un único seguimiento y como pronto 24 h después del «Enviado». A los
//   10 días sin entregar se deja de mirar y se avisa.
// - TDN y ON TIME se leen sin IA. Un transportista nuevo lo lee Haiku, y solo si la página ha cambiado desde la
//   última vez (huella del texto). Solo se actúa si la IA lo tiene claro; si no, aviso.
// - Entregado + recogida en tienda → se transfiere a la tienda elegida y «Listo para recoger» en Shopify, que manda el correo al cliente. La recogida por
//   el cliente se marca a mano.
// - Entregado + domicilio → evento «Entregado» en el envío de Shopify (aviso al cliente de Shopify). Pide el permiso
//   write_fulfillments (añadido el 20-11-2026).
// Estado de cada seguimiento en mhd_order_deliveries; lo hecho, en mhd_sync_events (sync «pedidos»).

const HORAS_ESPERA = 24;
const DIAS_MAXIMO = 10;
const HORARIO = { desde: 8, hasta: 21 }; // ambas incluidas
const DAY = 24 * 60;
const huella = (lineas: string[]) => createHash("sha256").update(lineas.join("\n")).digest("hex").slice(0, 16);

type Fila = {
  id: string; mhd_order_id: number; mhd_status: string | null; mhd_status_updated_at: string | null;
  mhd_status_payload: { id_estado_cliente?: number | null; estado_cliente?: string | null; seguimiento?: (Seguimiento & { carrier_code?: string | null })[]; arr_estados?: { estado?: string | null; fecha?: number | string | null }[] } | null;
  order: { id: string; shopify_order_id: string; shopify_order_name: string; cancelled_at: string | null } | null;
};
type Entrega = { id: string; export_id: string; page_hash: string | null; checks: number; ai_calls: number; resultado: string | null; estado: string | null };

// Transportista que no conocemos: la IA lee el texto de la página
const esquema = { type: "object", additionalProperties: false, required: ["estado", "fecha", "seguro", "resumen"], properties: {
  estado: { type: "string", enum: ["entregado", "en_reparto", "en_transito", "en_preparacion", "incidencia", "desconocido"] },
  fecha: { type: "string", description: "Fecha y hora de la entrega en formato AAAA-MM-DD HH:MM (hora de la página), o vacío" },
  seguro: { type: "boolean" }, resumen: { type: "string" },
} };
async function leerConIa(transportista: string, numero: string, lineas: string[]) {
  const client = new Anthropic({ apiKey: anthropicKey(process.env), maxRetries: 1 });
  const texto = lineas.join("\n").slice(0, 12_000);
  const message = await createStreamed(client, { model: PROCESSOR_MODEL, max_tokens: 2000, output_config: { effort: "low", format: { type: "json_schema", schema: esquema } }, messages: [{ role: "user", content: `Texto de la página de seguimiento del transportista «${transportista}» para el envío ${numero}:\n«${texto}»\n\n¿Cuál es el ÚLTIMO estado del envío? «entregado» solo si la página dice que ya se ha entregado al destinatario (no «en reparto», no «intento de entrega», no «en punto de recogida»). «incidencia» si hay ausente, devolución, rechazo, dirección incorrecta o similar. «desconocido» si la página no muestra el seguimiento (por ejemplo, pide iniciar sesión o está vacía). seguro=true solo si el texto lo dice sin ambigüedad. En fecha, la de la entrega tal como la da la página (AAAA-MM-DD HH:MM) o vacío. En resumen, una frase en español con lo que dice la página.` }] });
  const parsed = JSON.parse(message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("")) as { estado: EstadoEntrega; fecha: string; seguro: boolean; resumen: string };
  const partes = parsed.fecha.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  const fecha = partes ? madridAIso(Number(partes[1]), Number(partes[2]), Number(partes[3]), Number(partes[4]), Number(partes[5])) : null;
  return { lectura: { estado: parsed.estado, texto: parsed.resumen, fecha, lugar: null } satisfies LecturaEntrega, seguro: parsed.seguro, coste: costUsd(PROCESSOR_MODEL, message.usage) ?? 0 };
}

type PedidoShopify = { order: PedidoEnShopify | null };
async function pedidoEnShopify(id: string) {
  const data = await shopify<PedidoShopify>(`query Entrega($id: ID!) { order(id: $id) { displayFulfillmentStatus fulfillmentOrders(first: 20) { nodes { id status deliveryMethod { methodType } assignedLocation { location { id } } destination { location { id name } } } } fulfillments(first: 20) { id status events(first: 50) { nodes { status } } } } }`, { id });
  if (!data.order) throw new Error("El pedido ya no existe en Shopify.");
  return data.order;
}

// Qué hacer en Shopify con un pedido entregado por el transportista. «esperar»: aún no se puede (envío sin marcar).
// Unidades del pedido de preparación que llevan stock (sin tarjetas regalo ni servicios)
async function unidadesConStock(id: string) {
  const data = await shopify<{ fulfillmentOrder: { lineItems: { nodes: { totalQuantity: number; variant: { inventoryItem: { id: string; tracked: boolean } } | null }[] } } | null }>(
    `query Unidades($id: ID!) { fulfillmentOrder(id: $id) { lineItems(first: 50) { nodes { totalQuantity variant { inventoryItem { id tracked } } } } } }`, { id },
  );
  return (data.fulfillmentOrder?.lineItems.nodes ?? []).flatMap((item) => (item.variant?.inventoryItem.tracked && item.totalQuantity > 0 ? [{ inventoryItemId: item.variant.inventoryItem.id, cantidad: item.totalQuantity }] : []));
}

// Como «Transferir al lugar de retiro»: el pedido pasa a la tienda y sus unidades también (+ en la tienda, − en el
// almacén; el almacén lo vuelve a fijar la sincronización con el stock de MHD). Clave fija: un reintento no lo duplica.
async function trasladar(item: Traslado) {
  const unidades = await unidadesConStock(item.id);
  const data = await shopify<{ fulfillmentOrderMove: { movedFulfillmentOrder: { id: string } | null; userErrors: { message: string }[] } }>(
    `mutation Mover($id: ID!, $destino: ID!) { fulfillmentOrderMove(id: $id, newLocationId: $destino) { movedFulfillmentOrder { id } userErrors { field message } } }`,
    { id: item.id, destino: item.destino },
  );
  const errores = data.fulfillmentOrderMove.userErrors;
  if (errores.length || !data.fulfillmentOrderMove.movedFulfillmentOrder) throw new Error(`No se pudo transferir a ${item.tienda}: ${errores.map((e) => e.message).join(" ") || "sin respuesta"}`);
  if (unidades.length) await moverUnidades(item, unidades);
  return data.fulfillmentOrderMove.movedFulfillmentOrder.id; // si se mueve todo, Shopify devuelve el mismo
}
export async function moverUnidades(item: Pick<Traslado, "id" | "origen" | "destino" | "tienda">, unidades: { inventoryItemId: string; cantidad: number }[]) {
  const data = await shopify<{ inventoryAdjustQuantities: { userErrors: { message: string }[] } }>(
    `mutation Unidades($input: InventoryAdjustQuantitiesInput!, $key: String!) { inventoryAdjustQuantities(input: $input) @idempotent(key: $key) { userErrors { field message } } }`,
    { key: `entrega-traslado-${item.id.split("/").pop()}`, input: { name: "available", reason: "movement_received", referenceDocumentUri: `gid://sincro-vicente/Entrega/${item.id.split("/").pop()}`, changes: unidades.flatMap((unidad) => [
      { inventoryItemId: unidad.inventoryItemId, locationId: item.destino, delta: unidad.cantidad, changeFromQuantity: null },
      { inventoryItemId: unidad.inventoryItemId, locationId: item.origen, delta: -unidad.cantidad, changeFromQuantity: null },
    ]) } },
  );
  const errores = data.inventoryAdjustQuantities.userErrors;
  if (errores.length) throw new Error(`Pedido transferido a ${item.tienda}, pero no se pudieron mover sus unidades: ${errores.map((e) => e.message).join(" ")}`);
}

async function marcarListoParaRecoger(ids: string[], mover: Traslado[]) {
  const finales = new Map(ids.map((id) => [id, id]));
  for (const item of mover) finales.set(item.id, await trasladar(item));
  ids = [...finales.values()];
  const data = await shopify<{ fulfillmentOrderLineItemsPreparedForPickup: { userErrors: { message: string }[] } }>(
    `mutation Listo($input: FulfillmentOrderLineItemsPreparedForPickupInput!) { fulfillmentOrderLineItemsPreparedForPickup(input: $input) { userErrors { field message } } }`,
    { input: { lineItemsByFulfillmentOrder: ids.map((fulfillmentOrderId) => ({ fulfillmentOrderId })) } },
  );
  const errores = data.fulfillmentOrderLineItemsPreparedForPickup.userErrors;
  if (errores.length) throw new Error(errores.map((item) => item.message).join(" "));
}
async function marcarEntregado(ids: string[], fecha: string | null) {
  for (const fulfillmentId of ids) {
    const data = await shopify<{ fulfillmentEventCreate: { userErrors: { message: string }[] } }>(
      `mutation Entregado($evento: FulfillmentEventInput!) { fulfillmentEventCreate(fulfillmentEvent: $evento) { fulfillmentEvent { id } userErrors { field message } } }`,
      { evento: { fulfillmentId, status: "DELIVERED", ...(fecha ? { happenedAt: fecha } : {}) } },
    );
    const errores = data.fulfillmentEventCreate.userErrors;
    if (errores.length) throw new Error(errores.map((item) => item.message).join(" "));
  }
}

export type ResultadoEntregas = { omitido?: string; mirados: number; ia: number; listos: string[]; entregados: string[]; yaHechos: string[]; revisar: string[]; errores: string[]; simulacion: boolean; detalle: Record<string, unknown>[] };

// pedido: solo ese (prueba a mano; fuera de horario y con el interruptor apagado). simulacion: lee y decide, sin tocar Shopify.
export async function tareaEntregas(db: SupabaseClient, opciones: { ahora?: Date; pedido?: string | null; simulacion?: boolean } = {}): Promise<ResultadoEntregas> {
  const ahora = opciones.ahora ?? new Date();
  const simulacion = Boolean(opciones.simulacion);
  const resultado: ResultadoEntregas = { mirados: 0, ia: 0, listos: [], entregados: [], yaHechos: [], revisar: [], errores: [], simulacion, detalle: [] };
  if (!opciones.pedido) {
    const settings = await orderSettings(db);
    if (!settings.entrega.activo) return { ...resultado, omitido: "Interruptor apagado." };
    const hora = horaEnMadrid(ahora);
    if (hora < HORARIO.desde || hora > HORARIO.hasta) return { ...resultado, omitido: `Fuera de horario (${HORARIO.desde} a ${HORARIO.hasta} h).` };
  }

  const { data, error } = await db.from("mhd_order_exports")
    .select("id,mhd_order_id,mhd_status,mhd_status_updated_at,mhd_status_payload,order:shopify_mhd_orders!inner(id,shopify_order_id,shopify_order_name,cancelled_at)")
    .eq("status", "exported").not("mhd_order_id", "is", null);
  if (error) throw new Error(`No se pudieron leer los pedidos exportados: ${error.message}`);
  const filas = ((data ?? []) as unknown as Fila[]).filter((fila) => fila.order && !fila.order.cancelled_at
    && (!opciones.pedido || fila.order.shopify_order_name === opciones.pedido)
    && enviadoEnMhd(fila.mhd_status_payload?.id_estado_cliente, fila.mhd_status_payload?.estado_cliente ?? fila.mhd_status));
  if (!filas.length) return resultado;
  const { data: guardadas } = await db.from("mhd_order_deliveries").select("id,export_id,page_hash,checks,ai_calls,resultado,estado").in("export_id", filas.map((fila) => fila.id));
  const porExport = new Map(((guardadas ?? []) as Entrega[]).map((item) => [item.export_id, item]));

  for (const fila of filas) {
    const nombre = fila.order!.shopify_order_name;
    const previa = porExport.get(fila.id);
    if (previa?.resultado) continue; // ya resuelto: no se vuelve a mirar
    const enviado = enviadoDesde(fila);
    const momento = debeMirarEntrega({ enviadoAt: enviado, ahora, horasEspera: HORAS_ESPERA, diasMaximo: DIAS_MAXIMO });
    if (momento === "esperar") continue;
    const seguimientos = (fila.mhd_status_payload?.seguimiento ?? []).filter((item) => item.tracking_number?.trim() && item.carrier_url?.trim());
    const base = { export_id: fila.id, order_name: nombre, enviado_at: enviado, updated_at: ahora.toISOString() };
    const guardar = async (campos: Record<string, unknown>) => {
      if (simulacion) return;
      const { error: fallo } = await db.from("mhd_order_deliveries").upsert({ ...base, ...campos }, { onConflict: "export_id" });
      if (fallo) resultado.errores.push(`${nombre}: no se pudo guardar el seguimiento (${fallo.message})`);
    };
    const revisar = async (motivo: string, extra: Record<string, unknown> = {}, cerrar = false) => {
      resultado.revisar.push(nombre);
      resultado.detalle.push({ pedido: nombre, revisar: motivo });
      if (simulacion) return;
      await guardar({ ...extra, ...(cerrar ? { resultado: "revisar", resultado_at: ahora.toISOString() } : {}), error: motivo });
      await logOrderEvent(db, "entrega_revisar", { pedido: nombre, mhd: fila.mhd_order_id, motivo }, nombre);
      await orderAlert(db, { key: `pedidos:entrega:${nombre}:${createHash("sha256").update(motivo).digest("hex").slice(0, 8)}`, quietMinutes: 30 * DAY, subject: `Pedido ${nombre}: revisar la entrega`, lines: [`El seguimiento del pedido ${nombre} (MHD #${fila.mhd_order_id}) no se puede marcar solo:`, motivo, "Míralo en la página del transportista y márcalo a mano en Shopify si hace falta."] });
    };

    if (momento === "caducado") { await revisar(`Lleva más de ${DIAS_MAXIMO} días enviado por MHD y no consta entregado: se deja de mirar.`, {}, true); continue; }
    if (seguimientos.length !== 1) { await revisar(seguimientos.length ? `MHD da ${seguimientos.length} seguimientos: puede ser un envío en partes.` : "MHD no da enlace de seguimiento.", {}, true); continue; }
    const [seg] = seguimientos;
    const codigo = (seg.carrier_code ?? "").toUpperCase();
    const campos = { tracking_number: seg.tracking_number!.trim(), carrier_code: codigo || null, carrier_name: seg.carrier_name ?? null, carrier_url: seg.carrier_url!.trim() };

    try {
      resultado.mirados += 1;
      const pagina = await leerPaginaSeguimiento(campos.carrier_url);
      const marca = huella(pagina.lineas);
      let lectura = LECTORES[codigo]?.(pagina.lineas) ?? null;
      let fuente: "lectura" | "ia" = "lectura";
      let seguro = true;
      let iaLlamadas = previa?.ai_calls ?? 0;
      if (!lectura) {
        // Transportista nuevo, o uno conocido cuya página ha cambiado: IA, solo si el texto es distinto al de la última vez
        if (previa?.page_hash === marca) { await guardar({ ...campos, checks: (previa.checks ?? 0) + 1, last_checked_at: ahora.toISOString() }); continue; }
        const ia = await leerConIa(seg.carrier_name ?? codigo ?? "desconocido", campos.tracking_number, pagina.lineas);
        resultado.ia += 1; iaLlamadas += 1;
        lectura = ia.lectura; fuente = "ia"; seguro = ia.seguro;
        if (!LECTORES[codigo] && !previa) await orderAlert(db, { key: `pedidos:transportista-nuevo:${codigo || seg.carrier_name}`, quietMinutes: 30 * DAY, subject: `Transportista nuevo en MHD: ${seg.carrier_name ?? codigo}`, lines: [`El pedido ${nombre} va con ${seg.carrier_name ?? codigo} (código ${codigo || "—"}), que no tiene lectura fija: lo lee la IA.`, `Enlace: ${campos.carrier_url}`, `Lectura: ${ia.lectura.estado}${ia.seguro ? "" : " (sin seguridad)"} · ${ia.lectura.texto}`] });
        else if (LECTORES[codigo]) await orderAlert(db, { key: `pedidos:lector-roto:${codigo}`, quietMinutes: DAY, subject: `La página de seguimiento de ${seg.carrier_name ?? codigo} ha cambiado`, lines: [`La lectura fija de ${codigo} no ha entendido la página del pedido ${nombre}; la ha leído la IA.`, `Enlace: ${campos.carrier_url}`] });
      }
      const estadoCampos = { ...campos, estado: lectura.estado, estado_texto: lectura.texto, estado_fecha: lectura.fecha, fuente, page_hash: marca, checks: (previa?.checks ?? 0) + 1, ai_calls: iaLlamadas, last_checked_at: ahora.toISOString(), error: null };
      resultado.detalle.push({ pedido: nombre, transportista: codigo || seg.carrier_name, fuente, estado: lectura.estado, texto: lectura.texto, fecha: lectura.fecha, seguro });

      if (lectura.estado === "incidencia") { await revisar(`El transportista indica una incidencia: «${lectura.texto}».`, estadoCampos); continue; }
      if (lectura.estado !== "entregado") { await guardar(estadoCampos); continue; }
      if (!seguro) { await revisar(`La IA cree que está entregado, pero no lo tiene claro: «${lectura.texto}».`, estadoCampos); continue; }

      const accion = accionEnShopify(await pedidoEnShopify(fila.order!.shopify_order_id));
      resultado.detalle.push({ pedido: nombre, accion: accion.tipo, ...("motivo" in accion ? { motivo: accion.motivo } : {}) });
      if (accion.tipo === "esperar") { await guardar(estadoCampos); continue; }
      if (accion.tipo === "ya_hecho") {
        resultado.yaHechos.push(nombre);
        await guardar({ ...estadoCampos, resultado: "ya_hecho", resultado_at: ahora.toISOString(), error: accion.motivo });
        continue;
      }
      if (simulacion) { (accion.tipo === "listo_recoger" ? resultado.listos : resultado.entregados).push(nombre); continue; }
      if (accion.tipo === "listo_recoger") await marcarListoParaRecoger(accion.ids, accion.mover);
      else await marcarEntregado(accion.ids, lectura.fecha);
      (accion.tipo === "listo_recoger" ? resultado.listos : resultado.entregados).push(nombre);
      await guardar({ ...estadoCampos, resultado: accion.tipo, resultado_at: ahora.toISOString() });
      await logOrderEvent(db, accion.tipo, { pedido: nombre, mhd: fila.mhd_order_id, transportista: codigo || seg.carrier_name, seguimiento: campos.tracking_number, fecha: lectura.fecha, fuente }, nombre);
    } catch (caught) {
      const mensaje = caught instanceof Error ? caught.message : String(caught);
      resultado.errores.push(`${nombre}: ${mensaje}`);
      await guardar({ ...campos, checks: (previa?.checks ?? 0) + 1, last_checked_at: ahora.toISOString(), error: mensaje });
    }
  }

  if (resultado.errores.length && !simulacion) {
    for (const texto of resultado.errores) await logOrderEvent(db, "error", { proceso: "entregas", texto });
    await orderAlert(db, { key: `pedidos:entregas:${createHash("sha256").update([...resultado.errores].sort().join("|")).digest("hex").slice(0, 12)}`, quietMinutes: DAY, subject: `Pedidos: ${resultado.errores.length} ${resultado.errores.length === 1 ? "error" : "errores"} al mirar las entregas`, lines: resultado.errores });
  }
  return resultado;
}
