import type { SupabaseClient } from "@supabase/supabase-js";
import { alertRecipients, EMAIL_PREFIX, escapeHtml, sendEmail } from "@/lib/email";
import { canceladoEnMhd, csvContratos, datoQueFalta, fechaEnviado, fechaPrevista, fechaRecogida, filasDePedido, interpretarRespuesta, mesAnterior, motivoParaNoPedir, pedidoDePrueba, PREFIJO_PRUEBA, respuestaSimulada, type LineaGuardada, type PayloadMhd, type PedidoGuardado, type PedidoVivo, type Resultado } from "@/lib/garantia3";
import { refreshMhdStatuses, syncShopifyOrders } from "@/lib/mhd-order-sync";

// Vuelta diaria de Garantía3: trae pedidos y estados con el módulo de Pedidos MHD, crea una fila por unidad, espera los
// días configurados y pide los contratos. Lo llaman pg_cron y la pantalla. Ver docs/GARANTIA3.md.

type Env = Record<string, string | undefined>;
export type Ajustes = { modo: "test" | "produccion"; dias: number; desde: string; incidencias: string[]; resumen: string[] };
type Contrato = {
  id: string; shopify_order_id: string; shopify_order_name: string; shopify_line_id: string; unidad: number; sku: string; ean13: string; sku_aparato: string | null;
  nombre: string | null; apellidos: string | null; email: string | null; telefono: string | null; fecha_prevista: string | null; fecha_inicio: string | null;
  estado: string; motivo: string | null; modo: string; contrato: string | null; ultimo_aviso: string | null; fecha_alta: string | null; ean?: string;
};

const CUARENTA_Y_OCHO_HORAS = 48 * 3_600_000;
const DIAS_VIGILANCIA_REEMBOLSOS = 90;
const hoy = () => new Date().toLocaleString("sv-SE", { timeZone: "Europe/Madrid" }).slice(0, 10);
const lista = (valor: unknown) => (Array.isArray(valor) ? valor.map(String).map((item) => item.trim()).filter(Boolean) : []);

export async function leerAjustes(db: SupabaseClient): Promise<Ajustes> {
  const { data, error } = await db.from("store_settings").select("key,value").like("key", "garantia3_%");
  if (error) throw error;
  const valores = new Map((data ?? []).map((row) => [row.key as string, row.value as unknown]));
  return { modo: valores.get("garantia3_modo") === "produccion" ? "produccion" : "test", dias: Number(valores.get("garantia3_dias")) || 14, desde: String(valores.get("garantia3_desde") ?? hoy()), incidencias: lista(valores.get("garantia3_emails_incidencias")), resumen: lista(valores.get("garantia3_emails_resumen")) };
}

const etiqueta = (ajustes: Ajustes) => (ajustes.modo === "test" ? " [TEST]" : "");

// Sin lista propia van a los destinatarios generales: una incidencia nunca se pierde.
async function incidencia(ajustes: Ajustes, asunto: string, detalle: string, clave: string) {
  const texto = `${detalle}\n\nRevísalo en utils › Contratos Garantía3.`;
  return sendEmail({ to: ajustes.incidencias.length ? ajustes.incidencias : alertRecipients(), subject: `${EMAIL_PREFIX} Garantía3${etiqueta(ajustes)}: ${asunto}`, text: texto, html: `<p>${escapeHtml(detalle).replace(/\n/g, "<br>")}</p><p>Revísalo en utils › Contratos Garantía3.</p>`, idempotencyKey: `garantia3-${clave}` });
}

async function avisoDeFila(db: SupabaseClient, ajustes: Ajustes, fila: Contrato, motivo: string) {
  if (fila.ultimo_aviso === motivo) return;
  const resultado = await incidencia(ajustes, `${fila.shopify_order_name}: ${motivo}`, `Pedido ${fila.shopify_order_name}, ${fila.sku}, unidad ${fila.unidad}.\n${motivo}`, `${fila.id}-${hoy()}-${motivo.slice(0, 20).replace(/\W/g, "")}`);
  if (resultado.ok) { await db.from("garantia3_contratos").update({ ultimo_aviso: motivo }).eq("id", fila.id); fila.ultimo_aviso = motivo; }
}

async function shopifyGraphql<T>(env: Env, query: string, variables: Record<string, unknown>) {
  const store = (env.SHOPIFY_STORE_URL ?? "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const response = await fetch(`https://${store}/admin/api/2026-07/graphql.json`, { method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": env.SHOPIFY_ACCESS_TOKEN ?? "" }, cache: "no-store", body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(30_000) });
  const body = await response.json() as { data?: T; errors?: { message: string }[] };
  if (!response.ok || body.errors?.length || !body.data) throw new Error(body.errors?.map((item) => item.message).join(" ") || `Shopify devolvió HTTP ${response.status}.`);
  return body.data;
}

async function pedidoVivo(env: Env, id: string) {
  const data = await shopifyGraphql<{ order: PedidoVivo | null }>(env, `query Pedido($id: ID!) { order(id: $id) { cancelledAt displayFinancialStatus lineItems(first: 250) { nodes { id sku currentQuantity lineItemGroup { variantSku } } } fulfillmentOrders(first: 20) { nodes { deliveryMethod { methodType } } } fulfillments { status createdAt deliveredAt } } }`, { id });
  return data.order;
}

async function llamarProxy(env: Env, fila: Contrato) {
  if (!env.GARANTIA3_PROXY_URL || !env.GARANTIA3_PROXY_TOKEN) return { status: 503, cuerpo: { proxy: "no_enviado" } as unknown, texto: "Faltan GARANTIA3_PROXY_URL o GARANTIA3_PROXY_TOKEN" };
  try {
    const response = await fetch(env.GARANTIA3_PROXY_URL, { method: "POST", headers: { "Content-Type": "application/json", "X-Proxy-Token": env.GARANTIA3_PROXY_TOKEN }, cache: "no-store", signal: AbortSignal.timeout(45_000), body: JSON.stringify({ ean13: fila.ean13, name: fila.nombre, lastname: fila.apellidos, email: fila.email, phone: fila.telefono, note: fila.shopify_order_name }) });
    const texto = await response.text();
    let cuerpo: unknown = null;
    try { cuerpo = JSON.parse(texto); } catch { /* Sin JSON: queda dudoso */ }
    return { status: response.status, cuerpo, texto };
  } catch (caught) {
    return { status: 0, cuerpo: null as unknown, texto: caught instanceof Error ? caught.message : "Sin respuesta" };
  }
}

async function crearFilas(db: SupabaseClient, ajustes: Ajustes) {
  const { data, error } = await db.from("shopify_mhd_order_lines").select("shopify_line_id,sku,quantity,line_payload,shopify_mhd_orders!inner(shopify_order_id,shopify_order_name,source_payload)").like("sku", "G3PD%");
  if (error) throw error;
  let creadas = 0;
  const vistas = new Set<string>();
  for (const row of (data ?? []) as unknown as (LineaGuardada & { shopify_mhd_orders: { shopify_order_id: string; shopify_order_name: string; source_payload: PedidoGuardado } })[]) {
    const pedido = row.shopify_mhd_orders;
    if (vistas.has(row.shopify_line_id) || (pedido.source_payload.createdAt ?? "") < ajustes.desde) continue;
    vistas.add(row.shopify_line_id);
    const filas = filasDePedido(pedido.source_payload, [row]).map((fila) => ({ ...fila, shopify_order_id: pedido.shopify_order_id, shopify_order_name: pedido.shopify_order_name, order_created_at: pedido.source_payload.createdAt ?? null, modo: ajustes.modo }));
    const { data: nuevas, error: insertError } = await db.from("garantia3_contratos").upsert(filas, { onConflict: "shopify_line_id,unidad", ignoreDuplicates: true }).select("id");
    if (insertError) throw insertError;
    creadas += nuevas?.length ?? 0;
  }
  return creadas;
}

async function ponerFechas(db: SupabaseClient, env: Env, ajustes: Ajustes) {
  // Si cambian los días configurados, las que siguen en espera se recalculan.
  const { data: conFecha } = await db.from("garantia3_contratos").select("id,fecha_inicio,fecha_prevista").eq("estado", "espera").not("fecha_inicio", "is", null);
  for (const fila of conFecha ?? []) {
    const prevista = fechaPrevista(fila.fecha_inicio as string, ajustes.dias);
    if (new Date(fila.fecha_prevista as string).getTime() !== new Date(prevista).getTime()) await db.from("garantia3_contratos").update({ fecha_prevista: prevista, updated_at: new Date().toISOString() }).eq("id", fila.id);
  }
  const { data, error } = await db.from("garantia3_contratos").select("id,shopify_order_id").eq("estado", "espera").is("fecha_inicio", null);
  if (error) throw error;
  if (!data?.length) return;
  const pedidos = [...new Set(data.map((row) => row.shopify_order_id as string))];
  const { data: guardados } = await db.from("shopify_mhd_orders").select("shopify_order_id,mhd_order_exports(mhd_status_payload)").in("shopify_order_id", pedidos);
  const payloads = new Map<string, PayloadMhd>();
  for (const pedido of (guardados ?? []) as unknown as { shopify_order_id: string; mhd_order_exports: { mhd_status_payload: PayloadMhd } | { mhd_status_payload: PayloadMhd }[] | null }[]) {
    const exportado = Array.isArray(pedido.mhd_order_exports) ? pedido.mhd_order_exports[0] : pedido.mhd_order_exports;
    if (exportado?.mhd_status_payload) payloads.set(pedido.shopify_order_id, exportado.mhd_status_payload);
  }
  for (const id of pedidos) {
    let inicio = fechaEnviado(payloads.get(id)); let origen = "Enviado en MHD";
    if (!inicio) { const vivo = await pedidoVivo(env, id); inicio = vivo ? fechaRecogida(vivo) : null; origen = "Recogida en tienda"; }
    if (inicio) await db.from("garantia3_contratos").update({ fecha_inicio: inicio, origen_fecha: origen, fecha_prevista: fechaPrevista(inicio, ajustes.dias), updated_at: new Date().toISOString() }).eq("shopify_order_id", id).eq("estado", "espera").is("fecha_inicio", null);
  }
}

async function bloquear(db: SupabaseClient, ajustes: Ajustes, fila: Contrato, motivo: string, avisar: boolean) {
  await db.from("garantia3_contratos").update({ estado: "bloqueado", motivo, updated_at: new Date().toISOString() }).eq("id", fila.id);
  if (avisar) await avisoDeFila(db, ajustes, fila, motivo);
}

// Las filas de prueba no cuentan como contrato: al pasar a producción se piden de verdad.
async function pasarPruebasAProduccion(db: SupabaseClient) {
  await db.from("garantia3_contratos").delete().like("shopify_order_id", `${PREFIJO_PRUEBA}%`);
  await db.from("garantia3_contratos").update({ estado: "lista", modo: "produccion", contrato: null, pin: null, fecha_alta: null, motivo: null, ultimo_aviso: null, updated_at: new Date().toISOString() }).eq("modo", "test").eq("estado", "creado");
  await db.from("garantia3_contratos").update({ modo: "produccion", updated_at: new Date().toISOString() }).eq("modo", "test");
}

async function procesar(db: SupabaseClient, env: Env, ajustes: Ajustes, cuenta: Record<string, number>) {
  const ahora = new Date().toISOString();
  const { data, error } = await db.from("garantia3_contratos").select("*").or(`estado.eq.lista,and(estado.in.(espera,error),fecha_prevista.lte.${ahora})`).order("fecha_prevista");
  if (error) throw error;
  for (const fila of (data ?? []) as Contrato[]) {
    const falta = datoQueFalta(fila);
    if (falta) { await bloquear(db, ajustes, fila, falta, true); cuenta.bloqueadas += 1; continue; }
    const { data: mhd } = await db.from("shopify_mhd_orders").select("mhd_order_exports(mhd_status_payload)").eq("shopify_order_id", fila.shopify_order_id).limit(1).maybeSingle();
    const exportado = (mhd as unknown as { mhd_order_exports?: { mhd_status_payload: PayloadMhd } | { mhd_status_payload: PayloadMhd }[] | null } | null)?.mhd_order_exports;
    if (canceladoEnMhd((Array.isArray(exportado) ? exportado[0] : exportado)?.mhd_status_payload)) { await bloquear(db, ajustes, fila, "Pedido cancelado en MHD", false); cuenta.bloqueadas += 1; continue; }
    const motivo = motivoParaNoPedir(await pedidoVivo(env, fila.shopify_order_id), fila);
    if (motivo) { await bloquear(db, ajustes, fila, motivo, false); cuenta.bloqueadas += 1; continue; }

    // Se reserva antes de llamar: si el proceso se cae aquí, la siguiente vuelta la deja dudosa y no la repite.
    const { data: reservada } = await db.from("garantia3_contratos").update({ estado: "enviando", modo: ajustes.modo, updated_at: new Date().toISOString() }).eq("id", fila.id).eq("estado", fila.estado).select("id");
    if (!reservada?.length) continue;
    const respuesta = ajustes.modo === "test" ? { status: 200, cuerpo: respuestaSimulada(fila) as unknown, texto: "Simulado: modo test" } : await llamarProxy(env, fila);
    const resultado: Resultado = interpretarRespuesta(respuesta.status, respuesta.cuerpo);
    await db.from("garantia3_intentos").insert({ contrato_id: fila.id, modo: ajustes.modo, http_status: respuesta.status, resultado: resultado.estado, respuesta: respuesta.texto.slice(0, 4000) });
    await db.from("garantia3_contratos").update({ estado: resultado.estado, motivo: resultado.motivo ?? null, contrato: resultado.contrato ?? null, pin: resultado.pin ?? null, fecha_alta: resultado.estado === "creado" ? new Date().toISOString() : null, updated_at: new Date().toISOString() }).eq("id", fila.id);
    cuenta[resultado.estado === "creado" ? "creadas" : resultado.estado === "dudoso" ? "dudosas" : "errores"] += 1;
    if (resultado.motivo) await avisoDeFila(db, ajustes, fila, resultado.motivo);
    if (resultado.parar) break;
  }
}

// Reembolso o cancelación después de crear el contrato: hay que anularlo con Garantía3.
async function vigilarReembolsos(db: SupabaseClient, env: Env, ajustes: Ajustes, cuenta: Record<string, number>) {
  const desde = new Date(Date.now() - DIAS_VIGILANCIA_REEMBOLSOS * 86_400_000).toISOString();
  const { data, error } = await db.from("garantia3_contratos").select("*").eq("estado", "creado").gte("fecha_alta", desde);
  if (error) throw error;
  for (const fila of (data ?? []) as Contrato[]) {
    const motivo = motivoParaNoPedir(await pedidoVivo(env, fila.shopify_order_id), fila);
    if (!motivo) continue;
    await db.from("garantia3_contratos").update({ estado: "anulacion_pendiente", motivo, updated_at: new Date().toISOString() }).eq("id", fila.id);
    await avisoDeFila(db, ajustes, fila, `Contrato ya creado que hay que anular: ${motivo}`);
    cuenta.anulaciones += 1;
  }
}

async function resumenDelDia(db: SupabaseClient, ajustes: Ajustes, cuenta: Record<string, number>) {
  if (!Object.values(cuenta).some(Boolean)) return;
  const ahora = Date.now();
  const { data: proximas } = await db.from("garantia3_contratos").select("id", { count: "exact" }).eq("estado", "espera").lte("fecha_prevista", new Date(ahora + 3 * 86_400_000).toISOString());
  const { data: sinFecha } = await db.from("garantia3_contratos").select("id").eq("estado", "espera").is("fecha_inicio", null);
  const lineas = [`Contratos creados: ${cuenta.creadas}`, `Bloqueados: ${cuenta.bloqueadas}`, `Dudosos: ${cuenta.dudosas}`, `Con error: ${cuenta.errores}`, `Anulaciones por tramitar: ${cuenta.anulaciones}`, `Filas nuevas: ${cuenta.nuevas}`, `Se pedirán en 3 días: ${proximas?.length ?? 0}`, `Sin envío de MHD todavía: ${sinFecha?.length ?? 0}`];
  await sendEmail({ to: ajustes.resumen.length ? ajustes.resumen : alertRecipients(), subject: `${EMAIL_PREFIX} Garantía3${etiqueta(ajustes)}: resumen del ${hoy()}`, text: lineas.join("\n"), html: `<ul>${lineas.map((linea) => `<li>${escapeHtml(linea)}</li>`).join("")}</ul>`, idempotencyKey: `garantia3-resumen-${ajustes.modo}-${hoy()}` });
}

// Recorrido con datos inventados, sin Shopify ni clientes. Solo en modo test y sin llamar a Garantía3.
export async function enviarPedidoDePrueba(db: SupabaseClient) {
  const ajustes = await leerAjustes(db);
  if (ajustes.modo !== "test") throw new Error("El pedido de prueba solo se puede enviar en modo test.");
  const fila = pedidoDePrueba(Date.now());
  const { data, error } = await db.from("garantia3_contratos").insert(fila).select("id").single();
  if (error) throw error;
  const cuerpo = respuestaSimulada(fila);
  const resultado = interpretarRespuesta(200, cuerpo);
  await db.from("garantia3_intentos").insert({ contrato_id: data.id, modo: "test", http_status: 200, resultado: resultado.estado, respuesta: "Simulado: pedido de prueba" });
  await db.from("garantia3_contratos").update({ estado: resultado.estado, contrato: resultado.contrato ?? null, pin: resultado.pin ?? null, motivo: resultado.motivo ?? null, fecha_alta: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", data.id);
  return { pedido: fila.shopify_order_name, estado: resultado.estado, contrato: resultado.contrato ?? null };
}

export async function vueltaGarantia3(db: SupabaseClient, env: Env, origen: string, ownerId?: string) {
  const ajustes = await leerAjustes(db);
  const { data: vuelta } = await db.from("garantia3_vueltas").insert({ origen, modo: ajustes.modo }).select("id").single();
  const cuenta = { nuevas: 0, creadas: 0, bloqueadas: 0, dudosas: 0, errores: 0, anulaciones: 0 };
  const fallos: string[] = [];
  try {
    const owner = ownerId ?? (await db.from("shopify_mhd_orders").select("owner_id").order("synced_at", { ascending: false }).limit(1).maybeSingle()).data?.owner_id;
    if (owner) await syncShopifyOrders(db, owner); else fallos.push("No hay usuario con pedidos sincronizados: pulsa una vez «Traer pedidos» en Pedidos MHD");
    const estados = await refreshMhdStatuses(db);
    fallos.push(...estados.errors);

    const { data: colgadas } = await db.from("garantia3_contratos").select("*").eq("estado", "enviando");
    for (const fila of (colgadas ?? []) as Contrato[]) {
      const motivo = "La vuelta se cortó al pedir el contrato: comprobar en el portal";
      await db.from("garantia3_contratos").update({ estado: "dudoso", motivo, updated_at: new Date().toISOString() }).eq("id", fila.id);
      await avisoDeFila(db, ajustes, fila, motivo);
      cuenta.dudosas += 1;
    }

    cuenta.nuevas = await crearFilas(db, ajustes);
    await ponerFechas(db, env, ajustes);
    if (ajustes.modo === "produccion") await pasarPruebasAProduccion(db);
    await procesar(db, env, ajustes, cuenta);
    if (ajustes.modo === "produccion") await vigilarReembolsos(db, env, ajustes, cuenta);
  } catch (caught) {
    fallos.push(caught instanceof Error ? caught.message : "Error desconocido");
  }
  if (fallos.length) await incidencia(ajustes, "la vuelta diaria ha fallado", fallos.join("\n"), `fallo-${hoy()}-${origen}`);
  await resumenDelDia(db, ajustes, cuenta);
  if (vuelta) await db.from("garantia3_vueltas").update({ fin: new Date().toISOString(), resumen: { ...cuenta, fallos } }).eq("id", vuelta.id);
  return { ...cuenta, fallos, modo: ajustes.modo };
}

// Aparte de la vuelta, para enterarnos si deja de correr: los scripts antiguos dejaron de llamar sin que nadie avisara.
export async function vigilanteGarantia3(db: SupabaseClient) {
  const ajustes = await leerAjustes(db);
  const { data } = await db.from("garantia3_vueltas").select("fin").not("fin", "is", null).order("fin", { ascending: false }).limit(1).maybeSingle();
  const ultima = data?.fin ? new Date(data.fin as string).getTime() : 0;
  if (Date.now() - ultima <= CUARENTA_Y_OCHO_HORAS) return { ok: true, ultima: data?.fin ?? null };
  await incidencia(ajustes, "la vuelta diaria no ha corrido", `Última vuelta terminada: ${data?.fin ?? "ninguna"}.`, `vigilante-${hoy()}`);
  return { ok: false, ultima: data?.fin ?? null };
}

export async function resumenMensualGarantia3(db: SupabaseClient, ahora = new Date()) {
  const ajustes = await leerAjustes(db);
  const { inicio, fin, etiqueta: mes } = mesAnterior(ahora);
  const { data, error } = await db.from("garantia3_contratos").select("fecha_alta,shopify_order_name,sku,ean13,sku_aparato,contrato,estado").eq("modo", ajustes.modo).gte("fecha_alta", inicio).lt("fecha_alta", fin).order("fecha_alta");
  if (error) throw error;
  const filas = data ?? [];
  const porSku = new Map<string, number>();
  for (const fila of filas) porSku.set(fila.sku, (porSku.get(fila.sku) ?? 0) + 1);
  const lineas = [`Contratos de ${mes}: ${filas.length}`, ...[...porSku].map(([sku, total]) => `${sku}: ${total}`), `Por anular: ${filas.filter((fila) => fila.estado === "anulacion_pendiente").length}`];
  const csv = Buffer.from(csvContratos(filas), "utf8").toString("base64");
  return sendEmail({ to: ajustes.resumen.length ? ajustes.resumen : alertRecipients(), subject: `${EMAIL_PREFIX} Garantía3${etiqueta(ajustes)}: resumen de ${mes}`, text: lineas.join("\n"), html: `<ul>${lineas.map((linea) => `<li>${escapeHtml(linea)}</li>`).join("")}</ul>`, idempotencyKey: `garantia3-mensual-${ajustes.modo}-${mes}`, attachments: [{ filename: `garantia3-${mes}.csv`, content: csv }] });
}
