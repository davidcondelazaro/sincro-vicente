import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { escapeHtml, sendEmail, type SendResult } from "@/lib/email";

// Facturas de MHD para el cliente (docs/PEDIDOS_MHD_FASE_1.md › Facturas en Shopify y correo de factura):
// - El metacampo de pedido mhd.facturas (JSON [{ url, nombre }]) lo leen la «Confirmación de envío» de Shopify, Elvi y
//   el helpdesk.
// - El correo de factura sale cuando aparece una factura que el cliente no ha recibido: no iba en el correo de envío
//   (marcado sin «Avisar al cliente») o llegó después. mhd_order_exports.facturas_cliente guarda las ya recibidas.

export type ShopifyInvoice = { url: string; nombre: string | null };
export type InvoiceSent = { url: string; via: "envio" | "correo"; at: string; resend_id?: string };

function required(name: string) { const value = process.env[name]; if (!value) throw new Error(`Falta la variable ${name}.`); return value; }
async function shopify<T>(query: string, variables: Record<string, unknown>) {
  const store = required("SHOPIFY_STORE_URL").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const response = await fetch(`https://${store}/admin/api/2026-07/graphql.json`, { method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": required("SHOPIFY_ACCESS_TOKEN") }, cache: "no-store", signal: AbortSignal.timeout(20_000), body: JSON.stringify({ query, variables }) });
  const body = await response.json().catch(() => ({})) as { data?: T; errors?: { message: string }[] };
  if (!response.ok || body.errors?.length || !body.data) throw new Error(body.errors?.map((item) => item.message).join(" ") || `Shopify devolvió HTTP ${response.status}.`);
  return body.data;
}

export function toShopifyInvoices(invoices: { url_factura: string; nombre_factura: string | null }[]): ShopifyInvoice[] {
  return invoices.map((invoice) => ({ url: invoice.url_factura, nombre: invoice.nombre_factura }));
}
export const sameInvoices = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export async function writeInvoicesToShopify(shopifyOrderId: string, invoices: ShopifyInvoice[]) {
  const data = await shopify<{ metafieldsSet: { userErrors: { message: string }[] } }>(`mutation($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { message } } }`,
    { m: [{ ownerId: shopifyOrderId, namespace: "mhd", key: "facturas", type: "json", value: JSON.stringify(invoices) }] });
  if (data.metafieldsSet.userErrors.length) throw new Error(`Shopify no guardó las facturas: ${data.metafieldsSet.userErrors.map((item) => item.message).join("; ")}`);
}

// ---------- Correo de factura ----------

// Interruptor y fecha de corte en utils (store_settings): apagado no se envía nada, y los pedidos exportados a MHD
// antes de factura_correo_desde nunca reciben el correo (así no les llega al rellenarse el campo por primera vez).
export async function invoiceEmailSettings(db: SupabaseClient) {
  const { data } = await db.from("store_settings").select("key,value").in("key", ["factura_correo_activo", "factura_correo_desde"]);
  const values = new Map((data ?? []).map((row) => [row.key as string, row.value as unknown]));
  const since = typeof values.get("factura_correo_desde") === "string" ? String(values.get("factura_correo_desde")) : null;
  return { enabled: values.get("factura_correo_activo") === true && Boolean(since), since };
}

// Remitente para clientes (no el utils@ del equipo). Las respuestas van a soporte.
const CUSTOMER_FROM = "Electrónica Vicente <pedidos@mail.electronicavicente.com>";
const CUSTOMER_REPLY_TO = "soporte@electronicavicente.com";

// Diseño de las notificaciones de la tienda: theme-enterprise-vicente/notificaciones/piezas (cabecera, ayuda y pie)
// y el layout de chatbot-vicente (src/email/send.ts), sin la firma de Elvi.
const CDN = "https://cdn.shopify.com/s/files/1/0994/3269/4092/files/";
const C = { azul: "#015594", texto: "#2a2b2a", suave: "#6b6e72", cuerpo: "#4a4c4f", fondo: "#f1f2f4", linea: "#e7e8ea" };
const FONT = "'DM Sans', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";
const SHOP = "https://www.electronicavicente.com";
const ADVANTAGES: [string, string, string, string][] = [
  ["garantia", "Garantía oficial", "de 3 años, ampliable", "/collections/garantias"],
  ["devoluciones", "Devoluciones", "14 días para devolver", "/policies/refund-policy"],
  ["asesoramiento", "Asesoramiento", "antes y después", "/pages/preguntas-frecuentes"],
  ["tiendas", "Dos tiendas", "en Burgos", "/pages/tiendas"],
];
const LEGAL = { razon: "HOGARCONECTADO S.L.", cif: "B70420286", domicilio: "Ledin 18, 15866 Balcaide - Teo (A Coruña)", tienda: "Calle de la Concepción, 16 · 09002 Burgos", correo: "soporte@electronicavicente.com" };

function button(href: string, label: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:14px;"><tr><td class="btn" bgcolor="${C.azul}" style="background:${C.azul};border-radius:12px;">
    <a href="${escapeHtml(href)}" target="_blank" style="display:inline-block;white-space:nowrap;padding:15px 28px;border-radius:12px;font-family:${FONT};font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;">${escapeHtml(label)}&nbsp;&rarr;</a>
  </td></tr></table>`;
}

function layout(title: string, tag: string, preheader: string, body: string) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${escapeHtml(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,700&display=swap" rel="stylesheet">
<style>body{margin:0;padding:0;background:${C.fondo};-webkit-text-size-adjust:100%}table{border-collapse:collapse}img{border:0;display:block;outline:none;text-decoration:none}a{color:${C.azul}}.btn:hover{background:#01467a!important}
@media (max-width:620px){.wrap{width:100%!important}.half{display:inline-block!important;width:50%!important;box-sizing:border-box!important;padding-bottom:20px!important}.px{padding-left:20px!important;padding-right:20px!important}.h1{font-size:25px!important;line-height:32px!important}}</style></head>
<body style="margin:0;padding:0;background:${C.fondo};" bgcolor="${C.fondo}">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${C.fondo};opacity:0">${escapeHtml(preheader)}${"&#8199;&#847;".repeat(80)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.fondo};" bgcolor="${C.fondo}"><tr><td align="center" style="padding:28px 12px 40px;">
  <table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" style="width:600px;"><tr><td align="center" style="padding:4px 0 24px;">
    <a href="${SHOP}" target="_blank"><img src="${CDN}correo-logo-electronica-vicente.png" width="210" alt="Electrónica Vicente · electrodomésticos" style="width:210px;height:auto;"></a>
  </td></tr></table>
  <table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="width:600px;background:#ffffff;border-radius:18px;overflow:hidden;">
    <tr><td class="px" style="padding:40px 48px 8px;font-family:${FONT};color:${C.texto};font-size:16px;line-height:25px;">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="#eef6d9" style="background:#eef6d9;color:#4f6b00;border-radius:999px;padding:6px 14px;font-family:${FONT};font-size:13px;font-weight:700;letter-spacing:.2px;">${escapeHtml(tag)}</td></tr></table>
      <h1 class="h1" style="margin:20px 0 12px;font-family:${FONT};font-size:30px;line-height:38px;font-weight:700;color:${C.texto};">${escapeHtml(title)}</h1>
      <div style="color:${C.cuerpo};">${body}</div>
    </td></tr>
    <tr><td class="px" style="padding:26px 48px 40px;font-family:${FONT};">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.linea};border-radius:14px;"><tr>
        <td style="padding:20px 22px;font-family:${FONT};font-size:14px;line-height:22px;color:#4a4c4f;">
          <strong style="font-size:16px;color:${C.texto};">¿Alguna duda con tu pedido?</strong><br>
          Te ayudamos antes y después de la compra. Escríbenos desde nuestra <a href="${SHOP}/pages/contacto" style="color:${C.azul};font-weight:700;text-decoration:none;">página de contacto</a>. También puedes responder a este correo.
        </td></tr></table>
    </td></tr>
  </table>
  <table role="presentation" class="wrap" width="600" cellpadding="0" cellspacing="0" style="width:600px;"><tr><td style="padding:30px 8px 6px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${ADVANTAGES.map(([icon, heading, text, path]) => `
      <td class="half" width="25%" align="center" valign="top" style="padding:0 6px;font-family:${FONT};"><a href="${SHOP}${path}" target="_blank" style="text-decoration:none;display:block;">
        <img src="${CDN}correo-icono-${icon}.png" width="44" height="44" alt="" style="width:44px;height:44px;margin:0 auto 10px;">
        <div style="font-size:13px;line-height:18px;font-weight:700;color:${C.texto};">${heading}</div>
        <div style="font-size:12px;line-height:17px;color:${C.suave};">${text}</div></a></td>`).join("")}
    </tr></table>
  </td></tr><tr>
    <td class="px" align="center" style="padding:26px 36px 0;font-family:${FONT};font-size:12px;line-height:19px;color:#8a8d91;">
      <strong style="color:#5d6064;">Electrónica Vicente</strong><br>
      ${LEGAL.tienda}<br>
      <a href="${SHOP}" style="color:#5d6064;font-weight:700;text-decoration:none;">electronicavicente.com</a><br>
      <span style="font-size:11px;">${LEGAL.razon} · CIF ${LEGAL.cif} · ${LEGAL.domicilio}</span>
      <div style="padding:14px 0;"><a href="${SHOP}/policies/refund-policy" style="color:#5d6064;">Devoluciones</a>&nbsp;&nbsp;·&nbsp;&nbsp;<a href="${SHOP}/policies/terms-of-service" style="color:#5d6064;">Condiciones de venta</a>&nbsp;&nbsp;·&nbsp;&nbsp;<a href="${SHOP}/policies/privacy-policy" style="color:#5d6064;">Privacidad</a></div>
      <p style="margin:0;text-align:left;">${LEGAL.razon} (Electrónica Vicente) trata tus datos para gestionar tu pedido, su entrega, la facturación y la atención posventa, en ejecución del contrato de compra. Puedes ejercer tus derechos de acceso, rectificación, supresión, oposición, limitación y portabilidad escribiendo a <a href="mailto:${LEGAL.correo}" style="color:#8a8d91;">${LEGAL.correo}</a>. Más información en nuestra <a href="${SHOP}/policies/privacy-policy" style="color:#8a8d91;">política de privacidad</a>. Si has recibido este mensaje por error, avísanos y elimínalo.</p>
    </td></tr></table>
</td></tr></table></body></html>`;
}

export function invoiceEmail(input: { orderName: string; firstName: string | null; invoices: ShopifyInvoice[]; statusUrl: string | null }) {
  const several = input.invoices.length > 1;
  const title = several ? `Tus facturas del pedido ${input.orderName}` : `Tu factura del pedido ${input.orderName}`;
  const greeting = input.firstName ? `Hola, ${input.firstName}:` : "Hola:";
  const intro = several ? `Ya tienes disponibles las facturas de tu pedido ${input.orderName}. Puedes descargarlas cuando quieras:` : `Ya tienes disponible la factura de tu pedido ${input.orderName}. Puedes descargarla cuando quieras:`;
  const buttons = input.invoices.map((invoice) => `${several && invoice.nombre ? `<div style="margin-top:18px;font-size:14px;color:${C.suave};">${escapeHtml(invoice.nombre)}</div>` : ""}${button(invoice.url, "Descargar factura")}`).join("");
  const orderLink = input.statusUrl ? `<p style="margin:22px 0 0;font-size:15px;"><a href="${escapeHtml(input.statusUrl)}" target="_blank" style="color:${C.azul};font-weight:700;text-decoration:none;">Ver mi pedido &rarr;</a></p>` : "";
  const html = layout(title, several ? "Facturas" : "Factura", `${title}. Descárgala desde este correo.`, `<p style="margin:0 0 6px;">${escapeHtml(greeting)}</p><p style="margin:0;">${escapeHtml(intro)}</p>${buttons}${orderLink}`);
  const text = [greeting, "", intro, "", ...input.invoices.map((invoice) => `${invoice.nombre ?? "Factura"}: ${invoice.url}`), ...(input.statusUrl ? ["", `Ver mi pedido: ${input.statusUrl}`] : []), "", "¿Alguna duda con tu pedido? Responde a este correo o escríbenos desde electronicavicente.com/pages/contacto.", "", "Electrónica Vicente"].join("\n");
  return { subject: title, html, text };
}

export async function sendInvoiceEmail(to: string, email: { subject: string; html: string; text: string }, idempotencyKey?: string): Promise<SendResult> {
  return sendEmail({ to: [to], ...email, from: process.env.EMAIL_FROM_CUSTOMER || CUSTOMER_FROM, replyTo: CUSTOMER_REPLY_TO, idempotencyKey });
}

type PendingRow = { id: string; created_at: string; mhd_order_id: number; mhd_status_payload: { facturas?: { url_factura: string; nombre_factura: string | null }[] } | null; facturas_cliente: InvoiceSent[] | null; order: { shopify_order_id: string; shopify_order_name: string; email: string | null; shopify_fulfillment_payload: unknown } | null };

// Envía las facturas que el cliente aún no ha recibido. Solo tras marcar el envío desde sincro-vicente (antes, la
// factura irá en la «Confirmación de envío»); con el interruptor apagado o en pedidos exportados antes de la fecha de
// corte no hace nada. Devuelve los errores para que quien llama los junte con los suyos.
export async function sendPendingInvoiceEmails(db: SupabaseClient, exportIds?: string[]) {
  const errors: string[] = [];
  let sent = 0;
  const settings = await invoiceEmailSettings(db);
  if (!settings.enabled || !settings.since || (exportIds && !exportIds.length)) return { sent, errors };
  let query = db.from("mhd_order_exports")
    .select("id,created_at,mhd_order_id,mhd_status_payload,facturas_cliente,order:shopify_mhd_orders(shopify_order_id,shopify_order_name,email,shopify_fulfillment_payload)")
    .eq("status", "exported").gte("created_at", settings.since);
  if (exportIds) query = query.in("id", exportIds);
  const { data, error } = await query;
  if (error) return { sent, errors: [`Correo de factura: ${error.message}`] };
  for (const row of (data ?? []) as unknown as PendingRow[]) {
    const order = row.order;
    if (!order?.shopify_fulfillment_payload || !order.email) continue;
    const received = new Set((row.facturas_cliente ?? []).map((item) => item.url));
    const pending = toShopifyInvoices(row.mhd_status_payload?.facturas ?? []).filter((invoice) => !received.has(invoice.url));
    if (!pending.length) continue;
    try {
      const info = await shopify<{ order: { statusPageUrl: string | null; customer: { firstName: string | null } | null; shippingAddress: { firstName: string | null } | null } | null }>(
        `query($id: ID!) { order(id: $id) { statusPageUrl customer { firstName } shippingAddress { firstName } } }`, { id: order.shopify_order_id });
      const result = await sendInvoiceEmail(order.email, invoiceEmail({ orderName: order.shopify_order_name, firstName: info.order?.customer?.firstName ?? info.order?.shippingAddress?.firstName ?? null, invoices: pending, statusUrl: info.order?.statusPageUrl ?? null }),
        `factura-${row.id}-${createHash("sha256").update(pending.map((invoice) => invoice.url).join("|")).digest("hex").slice(0, 16)}`);
      if (!result.ok) throw new Error(result.error);
      const at = new Date().toISOString();
      const { error: saveError } = await db.from("mhd_order_exports").update({ facturas_cliente: [...(row.facturas_cliente ?? []), ...pending.map((invoice) => ({ url: invoice.url, via: "correo", at, resend_id: result.id }))] }).eq("id", row.id);
      if (saveError) throw new Error(`enviado, pero no se guardó el registro: ${saveError.message}`);
      sent += 1;
    } catch (caught) {
      errors.push(`Pedido MHD #${row.mhd_order_id} (${order.shopify_order_name}), correo de factura: ${caught instanceof Error ? caught.message : String(caught)}`);
    }
  }
  return { sent, errors };
}
