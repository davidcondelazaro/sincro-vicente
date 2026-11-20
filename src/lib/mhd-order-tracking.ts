// Lectura de las páginas de seguimiento de los transportistas de MHD (docs/PEDIDOS_MHD_FASE_1.md › Entregas y
// recogidas, 20-11-2026). Sin dependencias de la app, para poder probarlo suelto.
// - leerPaginaSeguimiento: descarga la página como un navegador sencillo (sigue redirecciones y guarda la cookie: ON TIME
//   la pide) y la deja en líneas de texto.
// - LECTORES: lectura fija de los transportistas conocidos (TDN, ON TIME), sin IA. Un transportista nuevo lo lee la IA
//   (mhd-order-delivery.ts).
// - debeMirarEntrega: nunca antes de 24 h desde el «Enviado» de MHD; a los 10 días se deja de mirar.

export type EstadoEntrega = "entregado" | "en_reparto" | "en_transito" | "en_preparacion" | "incidencia" | "desconocido";
export type LecturaEntrega = { estado: EstadoEntrega; texto: string; fecha: string | null; lugar: string | null };

const HORA = 3_600_000;

export function debeMirarEntrega(input: { enviadoAt: string | null; ahora: Date; horasEspera: number; diasMaximo: number }): "esperar" | "mirar" | "caducado" {
  if (!input.enviadoAt) return "esperar";
  const pasado = input.ahora.getTime() - new Date(input.enviadoAt).getTime();
  if (pasado < input.horasEspera * HORA) return "esperar";
  return pasado > input.diasMaximo * 24 * HORA ? "caducado" : "mirar";
}

// Hora de Madrid de la página (fecha y hora sueltas) → instante ISO
export function madridAIso(anio: number, mes: number, dia: number, hora: number, minuto: number) {
  const comoUtc = Date.UTC(anio, mes - 1, dia, hora, minuto);
  const partes = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(comoUtc)).map((parte) => [parte.type, parte.value]));
  const enMadrid = Date.UTC(Number(partes.year), Number(partes.month) - 1, Number(partes.day), Number(partes.hour), Number(partes.minute));
  return new Date(comoUtc - (enMadrid - comoUtc)).toISOString();
}

// Estado a partir del texto del transportista. Lo que no se reconoce queda «desconocido» (no se marca nada).
export function estadoDeTexto(texto: string): EstadoEntrega {
  const t = texto.toLowerCase();
  if (/incidencia|ausente|devuel|rechaz|no entregad|direcci[oó]n incorrecta|siniestr/.test(t)) return "incidencia";
  if (/^entregad[oa]\b/.test(t) || /\bentregad[oa]\b/.test(t) && !/no entregad/.test(t)) return "entregado";
  if (/reparto/.test(t)) return "en_reparto";
  if (/tr[aá]nsito|delegaci[oó]n|recibid|llegad|salid|ruta/.test(t)) return "en_transito";
  if (/creado|grabad|preparaci|admitid|completad|recogid/.test(t)) return "en_preparacion";
  return "desconocido";
}

const ENTIDADES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", ordm: "º", ordf: "ª", iexcl: "¡", iquest: "¿", aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", ntilde: "ñ", Ntilde: "Ñ", uuml: "ü", Uuml: "Ü", ccedil: "ç", middot: "·" };

export function htmlALineas(html: string): string[] {
  const sinCodigo = html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
  const conSaltos = sinCodigo.replace(/<(br|\/p|\/div|\/li|\/tr|\/td|\/th|\/h\d|\/span|\/a|\/label)\b[^>]*>/gi, "\n");
  const texto = conSaltos.replace(/<[^>]+>/g, " ").replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entera, nombre: string) => {
    if (nombre[0] === "#") return String.fromCodePoint(nombre[1].toLowerCase() === "x" ? parseInt(nombre.slice(2), 16) : Number(nombre.slice(1)));
    return ENTIDADES[nombre] ?? entera;
  });
  return texto.split(/\r?\n/).map((linea) => linea.replace(/\s+/g, " ").trim()).filter(Boolean);
}

// Codificación: la de la cabecera o la de <meta>; TDN sirve ISO-8859-1
function decodificar(bytes: ArrayBuffer, contentType: string | null) {
  const crudo = new TextDecoder("latin1").decode(bytes.slice(0, 4000));
  const charset = (contentType?.match(/charset=([\w-]+)/i)?.[1] ?? crudo.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1] ?? "utf-8").toLowerCase();
  try { return new TextDecoder(charset).decode(bytes); } catch { return new TextDecoder("utf-8").decode(bytes); }
}

export async function leerPaginaSeguimiento(url: string, { timeoutMs = 20_000, maxRedirecciones = 6 } = {}) {
  const cookies = new Map<string, string>();
  let actual = url;
  for (let salto = 0; salto <= maxRedirecciones; salto++) {
    const respuesta = await fetch(actual, {
      redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", "Accept": "text/html,application/xhtml+xml", "Accept-Language": "es-ES,es;q=0.9", ...(cookies.size ? { Cookie: [...cookies].map(([nombre, valor]) => `${nombre}=${valor}`).join("; ") } : {}) },
    });
    for (const linea of respuesta.headers.getSetCookie()) {
      const [par] = linea.split(";");
      const igual = par.indexOf("=");
      if (igual > 0) cookies.set(par.slice(0, igual).trim(), par.slice(igual + 1).trim());
    }
    const destino = respuesta.headers.get("location");
    if (respuesta.status >= 300 && respuesta.status < 400 && destino) { actual = new URL(destino, actual).toString(); continue; }
    if (!respuesta.ok) throw new Error(`La página de seguimiento respondió HTTP ${respuesta.status}.`);
    return { url: actual, lineas: htmlALineas(decodificar(await respuesta.arrayBuffer(), respuesta.headers.get("content-type"))) };
  }
  throw new Error("La página de seguimiento redirige demasiadas veces.");
}

// TDN: una línea «Entregado - 037 SALAMANCA - 19/11/2026 10:41» con el último estado
function leerTdn(lineas: string[]): LecturaEntrega | null {
  for (const linea of lineas) {
    const partes = linea.match(/^(.+?) - (.+?) - (\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/);
    if (!partes) continue;
    const [, texto, lugar, dia, mes, anio, hora, minuto] = partes;
    return { estado: estadoDeTexto(texto), texto, fecha: madridAIso(Number(anio), Number(mes), Number(dia), Number(hora), Number(minuto)), lugar };
  }
  return null;
}

// ON TIME (Alertran): tras «Tracking», el último evento: fecha («20 noviembre 2026»), hora, estado y delegación
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
function leerOnTime(lineas: string[]): LecturaEntrega | null {
  const inicio = lineas.findIndex((linea) => linea.toLowerCase() === "tracking");
  if (inicio < 0) return null;
  const fecha = lineas[inicio + 1]?.toLowerCase().match(/^(\d{1,2}) ([a-zñ]+) (\d{4})$/);
  const hora = lineas[inicio + 2]?.match(/^(\d{2}):(\d{2})$/);
  const texto = lineas[inicio + 3];
  const mes = fecha ? MESES.indexOf(fecha[2]) + 1 : 0;
  if (!fecha || !hora || !texto || !mes) return null;
  return { estado: estadoDeTexto(texto), texto, fecha: madridAIso(Number(fecha[3]), mes, Number(fecha[1]), Number(hora[1]), Number(hora[2])), lugar: lineas[inicio + 4] ?? null };
}

// Por carrier_code de MHD. Si un conocido no se puede leer (ha cambiado su página), lo lee la IA y se avisa.
export const LECTORES: Record<string, (lineas: string[]) => LecturaEntrega | null> = { TDN: leerTdn, ONTIME: leerOnTime };

// Decisiones de mhd-order-delivery.ts, aquí para poder probarlas sin Shopify
// Cuándo lo dio MHD por enviado: la fecha del estado «Enviado» de su historial; si no está, la del último cambio
export function enviadoDesde(fila: { mhd_status_payload: { arr_estados?: { estado?: string | null; fecha?: number | string | null }[] } | null; mhd_status_updated_at: string | null }) {
  const entrada = (fila.mhd_status_payload?.arr_estados ?? []).find((item) => /^enviado$/i.test(item.estado?.trim() ?? ""));
  const fecha = entrada?.fecha != null ? new Date(typeof entrada.fecha === "number" ? entrada.fecha : String(entrada.fecha)) : null;
  return fecha && !Number.isNaN(fecha.getTime()) ? fecha.toISOString() : fila.mhd_status_updated_at;
}

export type OrdenPreparacion = { id: string; status: string; deliveryMethod: { methodType: string } | null; assignedLocation: { location: { id: string } | null } | null; destination: { location: { id: string; name: string } | null } | null };
export type PedidoEnShopify = { displayFulfillmentStatus: string; fulfillmentOrders: { nodes: OrdenPreparacion[] }; fulfillments: { id: string; status: string; events: { nodes: { status: string }[] } }[] };
// En la recogida, el pedido de preparación sale asignado al Almacén MHD (de donde sale el stock); para marcarlo «Listo para
// recoger» hay que transferirlo antes a la tienda que eligió el cliente, como el botón «Transferir al lugar de retiro»
// (EV99344, 20-11-2026). mover: los que hay que transferir, de dónde y adónde. El botón mueve también las unidades
// (en existencia) a la tienda; por API el traslado solo mueve lo comprometido y la tienda quedaba en −1 (EV99345), así que
// mhd-order-delivery.ts mueve además las unidades.
export type Traslado = { id: string; origen: string; destino: string; tienda: string };
export type Accion = { tipo: "listo_recoger"; ids: string[]; mover: Traslado[] } | { tipo: "entregado"; ids: string[] } | { tipo: "ya_hecho"; motivo: string } | { tipo: "esperar"; motivo: string };
export function accionEnShopify(pedido: PedidoEnShopify): Accion {
  const recogida = pedido.fulfillmentOrders.nodes.filter((item) => item.deliveryMethod?.methodType === "PICK_UP");
  if (recogida.length) {
    const abiertos = recogida.filter((item) => ["OPEN", "IN_PROGRESS"].includes(item.status));
    const mover = abiertos.flatMap((item) => {
      const destino = item.destination?.location;
      const origen = item.assignedLocation?.location?.id;
      return destino && origen && origen !== destino.id ? [{ id: item.id, origen, destino: destino.id, tienda: destino.name }] : [];
    });
    return abiertos.length ? { tipo: "listo_recoger", ids: abiertos.map((item) => item.id), mover } : { tipo: "ya_hecho", motivo: `recogida ya cerrada en Shopify (${pedido.displayFulfillmentStatus})` };
  }
  const envios = pedido.fulfillments.filter((item) => item.status === "SUCCESS");
  if (!envios.length) return { tipo: "esperar", motivo: "el envío aún no está marcado en Shopify" };
  const sinEntregar = envios.filter((item) => !item.events.nodes.some((evento) => evento.status === "DELIVERED"));
  return sinEntregar.length ? { tipo: "entregado", ids: sinEntregar.map((item) => item.id) } : { tipo: "ya_hecho", motivo: "ya figura como entregado en Shopify" };
}

