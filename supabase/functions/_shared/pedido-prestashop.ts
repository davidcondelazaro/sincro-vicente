// Traducción de un pedido de PrestaShop al `orderCreate` de Shopify. La usan el script local
// (scripts/preparar-pedido-prestashop.mjs) y la Edge Function sync-prestashop-orders.
// Reglas en docs/IMPORTACION_PEDIDOS_PRESTASHOP.md. Solo lee: no escribe en MySQL ni en Shopify.
// deno-lint-ignore-file no-explicit-any
type Row = Record<string, any>;
type Query = (sql: string, values?: unknown[]) => Promise<Row[]>;

export const LOCATION_ID = "gid://shopify/Location/114068816204"; // Electrónica Vicente
const SHIPPING_TITLE = "Servicio estándar. Envío 100% asegurado";
export const PAID_STATES = [2, 3, 4, 5, 9, 11, 22, 24, 27, 29, 32];
export const SHIPPED_STATES = [4, 5, 27];
export const CANCELLED_STATES = [6, 25];
const PREFIX: Record<string, string> = { PT: "+351", ES: "+34", FR: "+33", IT: "+39", DE: "+49", GB: "+44" };
export const ORDER_OPTIONS = { sendReceipt: false, sendFulfillmentReceipt: false, inventoryBehaviour: "BYPASS" };

// Pedidos que se importan: cobrados alguna vez y no cancelados; sin enviar, solo los reembolsados (los 138 cobrados sin enviar esperan a Vicente).
export const IMPORTABLE_ORDERS_SQL = `SELECT o.id_order FROM ev_orders o
  WHERE o.current_state NOT IN (${CANCELLED_STATES}) AND EXISTS (SELECT 1 FROM ev_order_history h WHERE h.id_order = o.id_order AND h.id_order_state IN (${PAID_STATES}))
  AND (o.current_state IN (7, 18) OR EXISTS (SELECT 1 FROM ev_order_history h WHERE h.id_order = o.id_order AND h.id_order_state IN (${SHIPPED_STATES})))`;

// PrestaShop guarda la hora de Madrid sin zona: se convierte a UTC con el desfase real de ese día.
export function madridToIso(value: string) {
  const naive = new Date(`${value.replace(" ", "T")}Z`);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(naive).map((part) => [part.type, Number(part.value)]));
  const asMadrid = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return new Date(naive.getTime() - (asMadrid - naive.getTime())).toISOString();
}
const money = (amount: number) => ({ shopMoney: { amount: Number(amount).toFixed(2), currencyCode: "EUR" } });
export const euros = (amount: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(amount);
export const shortDate = (value: string) => `${value.slice(8, 10)}/${value.slice(5, 7)}/${value.slice(0, 4)} ${value.slice(11, 16)}`;
const plain = (html: unknown) => String(html ?? "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
const round2 = (value: number) => Math.round(value * 100) / 100;
// Las mismas erratas que corrige el importador de clientes: así el pedido encuentra a su cliente.
export function cleanEmail(value: string) { return value.trim().replace(/\.+@/, "@").replace(/(\.[a-z]{2,})\d+$/i, "$1"); }

function phone(raw: unknown, countryCode: string) {
  const value = String(raw ?? "").replace(/[^\d+]/g, "");
  if (value.length < 9) return undefined;
  return value.startsWith("+") ? value : value.startsWith("00") ? `+${value.slice(2)}` : `${PREFIX[countryCode] ?? ""}${value}`;
}
function address(row: Row | undefined) {
  if (!row) return undefined;
  return {
    firstName: row.firstname || undefined, lastName: row.lastname || undefined,
    company: [row.dni, row.company].filter((value) => value?.trim()).join(" ") || undefined,
    address1: row.address1 || undefined, address2: row.address2 || undefined,
    city: row.city || undefined, zip: row.postcode || undefined, countryCode: row.country_code,
    provinceCode: row.state_iso ? row.state_iso.replace(/^[A-Z]{2}-/, "") : undefined,
    phone: phone(row.phone_mobile || row.phone, row.country_code),
  };
}
function tracking(html: string) {
  const field = (label: string) => plain(html.match(new RegExp(`${label}:?</strong>([^<]*)`, "i"))?.[1]);
  const url = html.match(/Seguimiento:<\/strong>\s*<a href=["']?([^"'\s>]+)/i)?.[1];
  return { company: field("Enviado por"), number: field("Código/Número de seguimiento"), url };
}

// Todo lo que hace falta de MySQL para un pedido; `by` es la referencia («4-5101813») o el id_order.
export async function loadOrder(q: Query, by: { reference?: string; id?: number }) {
  const [order] = await q(`SELECT o.*, c.email, c.firstname c_first, c.lastname c_last FROM ev_orders o JOIN ev_customer c USING(id_customer) WHERE ${by.id ? "o.id_order" : "o.reference"} = ?`, [by.id ?? by.reference]);
  if (!order) return null;
  const addressSql = `SELECT a.*, co.iso_code country_code, s.iso_code state_iso FROM ev_address a JOIN ev_country co USING(id_country) LEFT JOIN ev_state s ON s.id_state = a.id_state WHERE a.id_address = ?`;
  const [delivery] = await q(addressSql, [order.id_address_delivery]);
  const [invoice] = await q(addressSql, [order.id_address_invoice]);
  const details = await q(`SELECT * FROM ev_order_detail WHERE id_order = ? ORDER BY id_order_detail`, [order.id_order]);
  const cartRules = await q(`SELECT name, value, free_shipping FROM ev_order_cart_rule WHERE id_order = ? ORDER BY id_order_cart_rule`, [order.id_order]);
  const history = await q(`SELECT h.date_add, h.id_order_state, l.name state, TRIM(CONCAT(IFNULL(e.firstname, ''), ' ', IFNULL(e.lastname, ''))) employee FROM ev_order_history h JOIN ev_order_state_lang l ON l.id_order_state = h.id_order_state AND l.id_lang = 1 LEFT JOIN ev_employee e ON e.id_employee = h.id_employee WHERE h.id_order = ? ORDER BY h.date_add, h.id_order_history`, [order.id_order]);
  const messages = await q(`SELECT m.date_add, m.message, m.private, m.id_employee, TRIM(CONCAT(IFNULL(e.firstname, ''), ' ', IFNULL(e.lastname, ''))) employee FROM ev_customer_thread t JOIN ev_customer_message m USING(id_customer_thread) LEFT JOIN ev_employee e ON e.id_employee = m.id_employee WHERE t.id_order = ? ORDER BY m.date_add, m.id_customer_message`, [order.id_order]);
  const [legacyNote] = await q(`SELECT message FROM ev_message WHERE id_order = ? ORDER BY date_add LIMIT 1`, [order.id_order]);
  const payments = await q(`SELECT amount, payment_method, transaction_id, date_add FROM ev_order_payment WHERE order_reference = ? ORDER BY date_add`, [order.reference]);
  const redsysRefunds = await q(`SELECT amount_refunded, refund_date, ds_order, ds_authorisationcode, ds_response, id_tpv FROM ev_redsys_refund WHERE id_order = ? ORDER BY refund_date`, [order.id_order]);
  // Cobros aceptados por Redsys (tarjeta y Bizum): respuesta 0000-0099.
  const redsysCharges = await q(`SELECT ds_order, ds_authorisationcode, ds_response, id_tpv, amount, transaction_date FROM ev_redsys_transaction WHERE id_order = ? AND ds_response BETWEEN '0000' AND '0099' ORDER BY transaction_date`, [order.id_order]);
  const [paypal] = await q(`SELECT id_transaction, id_payment, payment_status FROM ev_paypal_order WHERE id_order = ? ORDER BY id_paypal_order DESC LIMIT 1`, [order.id_order]);
  const [partial] = await q(`SELECT value FROM ev_kb_order_field_customer_mapping WHERE id_order = ? AND id_field = 1 ORDER BY date_upd DESC LIMIT 1`, [order.id_order]);
  const [stateName] = await q(`SELECT name FROM ev_order_state_lang WHERE id_order_state = ? AND id_lang = 1`, [order.current_state]);
  return { order, delivery, invoice, details, cartRules, history, messages, legacyNote, payments, redsysRefunds, redsysCharges, paypal, partial, stateName };
}
export type OrderData = NonNullable<Awaited<ReturnType<typeof loadOrder>>>;

// `customerId`: el cliente de Shopify con ese email, o null si aún no existe.
export function buildOrder(data: OrderData, customerId: string | null) {
  const { order, delivery, invoice, details, cartRules, history, messages, legacyNote, payments, redsysRefunds, redsysCharges, paypal, partial, stateName } = data;
  const reference = order.reference;
  const warnings: string[] = [];
  const total = Number(order.total_paid_tax_incl);
  const orderTax = round2(total - Number(order.total_paid_tax_excl));
  const shipping = Number(order.total_shipping_tax_incl);
  const shippingTax = round2(shipping - Number(order.total_shipping_tax_excl));

  // Líneas: precio final pagado; el IVA se deduce de precio con y sin IVA y se reparte para cuadrar con el del pedido (los cupones lo rebajan).
  const rawLines = details.map((row) => {
    const premium = /^Servicio Premium/i.test(row.product_name);
    const incl = Number(row.total_price_tax_incl), excl = Number(row.total_price_tax_excl);
    const rate = excl > 0 ? Math.round((incl / excl - 1) * 100) / 100 : 0;
    return { row, premium, incl, tax: round2(incl - excl), rate };
  }).sort((a, b) => Number(a.premium) - Number(b.premium)); // el envío premium, siempre al final
  const linesTax = rawLines.reduce((sum, line) => sum + line.tax, 0);
  const targetLinesTax = round2(orderTax - shippingTax);
  let assigned = 0;
  const lineItems = rawLines.map((line, index) => {
    const last = index === rawLines.length - 1;
    const tax = linesTax > 0 ? (last ? round2(targetLinesTax - assigned) : round2(line.tax * targetLinesTax / linesTax)) : 0;
    assigned = round2(assigned + tax);
    // Los EAN 9999999… son códigos internos de servicios, no de producto.
    const ean = line.premium || /^9{7}/.test(line.row.product_ean13 ?? "") ? null : line.row.product_ean13;
    return {
      title: line.premium ? "Envío premium" : line.row.product_name,
      sku: line.premium ? "PREMIUM" : line.row.product_reference || undefined,
      quantity: Number(line.row.product_quantity),
      priceSet: money(Number(line.row.unit_price_tax_incl)),
      // El premium también se marca como enviado: si no requiere envío, el pedido queda «parcialmente preparado».
      requiresShipping: true,
      taxable: line.rate > 0,
      taxLines: line.rate > 0 ? [{ title: "IVA", rate: line.rate.toFixed(2), priceSet: money(tax) }] : [],
      variantTitle: ean ? `EAN ${ean}` : undefined, // se ve bajo el título, sin el </> de las propiedades
    };
  });

  // Descuentos: la API admite uno; con varios cupones se unen los nombres.
  const discountTotal = Number(order.total_discounts_tax_incl);
  const discountName = cartRules.map((rule) => rule.name.trim()).join(" + ");
  if (cartRules.length && Math.abs(cartRules.reduce((sum, rule) => sum + Number(rule.value), 0) - discountTotal) > 0.02) warnings.push("La suma de los cupones no coincide con el descuento del pedido.");

  // Reembolsos: Redsys + pagos negativos que no sean de tarjeta (si no hay Redsys, todos), con el total como máximo.
  const isCard = (method: string | null) => /tarjeta|redsys|bizum/i.test(method ?? "");
  const negative = payments.filter((payment) => Number(payment.amount) < 0);
  const entries: { date: string; text: string }[] = []; // historial del pedido (metacampo prestashop.historial)
  const refundEvents: { amount: number; date: string; source: string; redsys?: Row }[] = [
    ...redsysRefunds.map((refund) => ({ amount: Number(refund.amount_refunded), date: refund.refund_date, source: "Redsys", redsys: refund })),
    ...negative.filter((payment) => !redsysRefunds.length || !isCard(payment.payment_method)).map((payment) => ({ amount: -Number(payment.amount), date: payment.date_add, source: payment.payment_method })),
  ];
  // Lo cobrado por encima del total corresponde a líneas anuladas tras pagar (o a otros pedidos de la misma compra):
  // sus devoluciones no son reembolsos de este pedido.
  const charged = payments.filter((payment) => Number(payment.amount) > 0).reduce((sum, payment) => sum + Number(payment.amount), 0);
  let excess = round2(Math.max(charged - total, 0));
  if (excess > 0) warnings.push(`Se cobraron ${euros(charged)} sobre un total de ${euros(total)}: ${euros(excess)} de devoluciones no cuentan como reembolso.`);
  let refunded = 0;
  const refunds: typeof refundEvents = [];
  for (const event of refundEvents) {
    const absorbed = Math.min(event.amount, excess);
    excess = round2(excess - absorbed);
    if (absorbed > 0) entries.push({ date: event.date, text: `Devolución de ${euros(absorbed)} por líneas anuladas tras el pago (${event.source}); no figura como reembolso en Shopify` });
    if (event.amount - absorbed <= 0.005) continue;
    const amount = round2(Math.min(event.amount - absorbed, total - refunded));
    if (amount <= 0) { warnings.push(`Devolución de ${euros(event.amount)} por encima del total del pedido (compra dividida en varios pedidos).`); continue; }
    refunded = round2(refunded + amount);
    refunds.push({ ...event, amount });
  }
  const everPaid = history.some((item) => PAID_STATES.includes(item.id_order_state));
  let financialStatus = refunded <= 0 ? "PAID" : refunded >= total - 0.01 ? "REFUNDED" : "PARTIALLY_REFUNDED";
  if (refunded <= 0 && order.current_state === 7) { financialStatus = "REFUNDED"; refunds.push({ amount: total, date: history.at(-1)!.date_add, source: "importe no registrado en PrestaShop" }); }
  if (refunded <= 0 && order.current_state === 18) warnings.push("Reembolso parcial sin importe registrado: queda como pagado.");
  if (!everPaid) warnings.push("El historial no muestra ningún cobro.");

  // Mensajes: el original (comentario del pedido) va a la nota; lo demás, al historial.
  const orderStart = new Date(`${order.date_add.replace(" ", "T")}Z`).getTime();
  const isOriginal = (message: Row) => !message.id_employee && message.private && Math.abs(new Date(`${message.date_add.replace(" ", "T")}Z`).getTime() - orderStart) < 120_000;
  const original = messages.find(isOriginal)?.message ?? legacyNote?.message;
  const isNoise = (text: string) => /^Se ha informado a SeQura/i.test(text) || /- Detalles Pedido -/i.test(text);
  const trackings: ReturnType<typeof tracking>[] = [];
  for (const message of messages) {
    if (isOriginal(message) || isNoise(message.message)) continue;
    if (/^A continuación están detallados/i.test(message.message)) {
      const found = tracking(message.message);
      if (found.number) trackings.push(found);
      const text = [found.company, found.number, found.url].filter(Boolean).join(" · ");
      entries.push({ date: message.date_add, text: text ? `Datos de envío enviados al cliente: ${text}` : "Aviso de envío enviado al cliente, sin datos de seguimiento" });
      continue;
    }
    const who = message.id_employee ? (message.private ? `Nota interna (${message.employee})` : `Enviado al cliente (${message.employee})`) : message.private ? "Nota" : "Mensaje del cliente";
    entries.push({ date: message.date_add, text: `${who}: ${plain(message.message)}` });
  }
  for (const item of history) entries.push({ date: item.date_add, text: `Estado: ${item.state}${item.employee ? ` (${item.employee})` : ""}` });
  // ev_redsys_refund guarda el nº sin los ceros iniciales: se rellena a 12 cifras como en el cobro.
  const redsysOrder = (value: string | undefined) => /^\d+$/.test(value ?? "") ? value!.padStart(12, "0") : value;
  // Datos de Redsys para localizar la operación en su portal; van también en el recibo de cada transacción.
  const redsysReceipt = (row: Row | undefined) => row ? { redsys_pedido: redsysOrder(row.ds_order), codigo_autorizacion: row.ds_authorisationcode, respuesta: row.ds_response, terminal: row.id_tpv } : undefined;
  const redsysText = (row: Row | undefined) => row ? ` · Nº Redsys ${redsysOrder(row.ds_order)} · Autorización ${row.ds_authorisationcode}` : "";
  const firstPayment = payments.find((payment) => Number(payment.amount) > 0);
  const charge = redsysCharges.find((row) => row.ds_order === firstPayment?.transaction_id) ?? redsysCharges[0];
  if (charge) entries.push({ date: charge.transaction_date, text: `Cobro de ${euros(Number(charge.amount))} (${order.payment})${redsysText(charge)}` });
  // Cetelem: si el pago no trae la autorización, la anotaban a mano en un mensaje («cetelem autorizado 5252622347»).
  const cetelemId = order.module === "cetelem" ? firstPayment?.transaction_id || messages.map((message) => message.message.match(/cetelem\D{0,40}(\d{8,})/i)?.[1]).find(Boolean) : undefined;
  const saleCode = charge ? redsysOrder(charge.ds_order) : paypal?.id_transaction || cetelemId || firstPayment?.transaction_id || undefined;
  const saleReceipt = charge ? redsysReceipt(charge)
    : paypal ? { paypal_transaccion: paypal.id_transaction, paypal_pago: paypal.id_payment, estado: paypal.payment_status }
    : cetelemId ? { cetelem_autorizacion: cetelemId } : undefined;
  for (const refund of refunds) entries.push({ date: refund.date, text: `Devolución de ${euros(refund.amount)} (${refund.source})${redsysText(refund.redsys)}` });
  entries.sort((a, b) => a.date.localeCompare(b.date));
  const historyText = [
    `Pedido PrestaShop ${reference} · ${stateName?.name ?? order.current_state} · ${order.payment}`,
    cartRules.length > 1 ? `Descuentos: ${cartRules.map((rule) => `${rule.name.trim()} (${euros(Number(rule.value))})`).join(" + ")}` : null,
    ...entries.map((entry) => `[${shortDate(entry.date)}] ${entry.text}`),
  ].filter(Boolean).join("\n");

  if (!customerId) warnings.push(`El cliente ${order.email} no existe en Shopify: habría que importarlo antes.`);
  const processedAt = madridToIso(order.date_add);
  const transactions = [
    { kind: "SALE", status: "SUCCESS", gateway: order.payment, amountSet: money(total), processedAt, authorizationCode: saleCode, receiptJson: saleReceipt },
    ...refunds.map((refund) => ({ kind: "REFUND", status: "SUCCESS", gateway: order.payment, amountSet: money(refund.amount), processedAt: madridToIso(refund.date), authorizationCode: redsysOrder(refund.redsys?.ds_order), receiptJson: redsysReceipt(refund.redsys) })),
  ];
  const shipped = history.some((item) => SHIPPED_STATES.includes(item.id_order_state));
  const input = {
    name: `PS-${reference}`,
    sourceIdentifier: String(order.id_order),
    processedAt,
    closedAt: madridToIso(history.at(-1)?.date_add ?? order.date_upd),
    currency: "EUR",
    email: cleanEmail(order.email),
    customer: customerId ? { toAssociate: { id: customerId } } : undefined,
    billingAddress: address(invoice),
    shippingAddress: address(delivery),
    taxesIncluded: true,
    lineItems,
    shippingLines: [{ title: SHIPPING_TITLE, priceSet: money(shipping), taxLines: shippingTax > 0 ? [{ title: "IVA", rate: (Number(order.carrier_tax_rate) / 100).toFixed(2), priceSet: money(shippingTax) }] : [] }],
    discountCode: discountTotal > 0 ? { itemFixedDiscountCode: { code: discountName || "Descuento PrestaShop", amountSet: money(discountTotal) } } : undefined,
    financialStatus,
    transactions,
    fulfillment: shipped ? { locationId: LOCATION_ID, notifyCustomer: false, trackingCompany: trackings[0]?.company || undefined, trackingNumbers: trackings.length ? [...new Set(trackings.map((item) => item.number))] : undefined } : undefined,
    note: original ? plain(original) : undefined,
    customAttributes: partial?.value === "false" ? [{ key: "Enviar todo junto", value: "Sí" }] : undefined,
    tags: ["PrestaShop"],
    metafields: [
      { namespace: "prestashop", key: "estado", type: "single_line_text_field", value: stateName?.name ?? String(order.current_state) },
      { namespace: "prestashop", key: "forma_pago", type: "single_line_text_field", value: order.payment },
      { namespace: "prestashop", key: "historial", type: "multi_line_text_field", value: historyText },
    ],
  };

  const linesSum = lineItems.reduce((sum, line) => sum + Number(line.priceSet.shopMoney.amount) * line.quantity, 0);
  const computed = round2(linesSum + shipping - discountTotal);
  if (Math.abs(computed - total) > 0.01) warnings.push(`El total calculado (${euros(computed)}) no cuadra con el de PrestaShop (${euros(total)}).`);
  return { input, options: ORDER_OPTIONS, warnings, summary: { total, computed, orderTax, shipping, discountTotal, discountName, financialStatus, refunded, refunds, shipped, trackings, historyText } };
}

// Última barrera antes de crear: nada de lo que se importa puede avisar al cliente.
export function assertSilent(input: Row, options: Row) {
  if (options.sendReceipt !== false || options.sendFulfillmentReceipt !== false || (input.fulfillment && input.fulfillment.notifyCustomer !== false)) throw new Error("El pedido avisaría al cliente: se cancela.");
}
