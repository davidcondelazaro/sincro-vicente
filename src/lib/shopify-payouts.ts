import type { SupabaseClient } from "@supabase/supabase-js";
import { EMAIL_PREFIX, escapeHtml, sendEmail } from "@/lib/email";
import { buildXlsx, type Cell } from "@/lib/xlsx";

// Avisos de pagos de Shopify Payments (2026-11-20, David): cada pago («payout») que Shopify ingresa en el banco de la
// tienda sale por correo con un Excel de su detalle por pedido, como lo enseña el admin en Configuración › Pagos. Solo
// lectura en Shopify. Lo llama pg_cron cada día a las 10:00 de Madrid (src/app/api/pagos-shopify).
//
// Estado en mhd_sync_events (sync «pagos-shopify», codigo = id del pago): «inicial» para los que ya existían cuando se
// encendió (no se avisan) y «aviso» con detail.sent por cada correo. Un pago se da por avisado si tiene «inicial» o un
// «aviso» enviado; si el envío falla, se reintenta al día siguiente. Destinatarios en store_settings
// «pagos_shopify_emails»: { para: [...], copia: [...] }.

type Env = Record<string, string | undefined>;
type Money = { amount: string };
export type Payout = {
  id: string; legacyResourceId: string; issuedAt: string; status: string; net: Money & { currencyCode: string };
  summary: Record<"adjustmentsFee" | "adjustmentsGross" | "advanceFees" | "advanceGross" | "chargesFee" | "chargesGross" | "refundsFee" | "refundsFeeGross" | "reservedFundsFee" | "reservedFundsGross" | "retriedPayoutsFee" | "retriedPayoutsGross", Money>;
};
export type BalanceTransaction = { type: string; transactionDate: string; amount: Money; fee: Money; net: Money; associatedOrder: { id: string; name: string } | null; associatedPayout: { id: string | null } | null; sourceOrderTransactionId: string | null; card?: string };

const SYNC = "pagos-shopify";
const API = "2026-10";

async function shopify<T>(env: Env, query: string, variables: Record<string, unknown> = {}): Promise<{ data?: T; errors?: { message: string; extensions?: { code?: string } }[] }> {
  const store = (env.SHOPIFY_STORE_URL ?? "").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const response = await fetch(`https://${store}/admin/api/${API}/graphql.json`, { method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": env.SHOPIFY_ACCESS_TOKEN ?? "" }, cache: "no-store", body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Shopify respondió ${response.status}`);
  return response.json();
}

const MONEY = "{ amount }";
const SUMMARY = `summary { ${["adjustmentsFee", "adjustmentsGross", "advanceFees", "advanceGross", "chargesFee", "chargesGross", "refundsFee", "refundsFeeGross", "reservedFundsFee", "reservedFundsGross", "retriedPayoutsFee", "retriedPayoutsGross"].map((field) => `${field} ${MONEY}`).join(" ")} }`;

// Los últimos pagos, del más reciente al más antiguo.
export async function listPayouts(env: Env, first = 50): Promise<Payout[]> {
  const result = await shopify<{ shopifyPaymentsAccount: { payouts: { nodes: Payout[] } } | null }>(env, `query($first: Int!) { shopifyPaymentsAccount { payouts(first: $first, reverse: true) { nodes { id legacyResourceId issuedAt status net { amount currencyCode } ${SUMMARY} } } } }`, { first });
  if (result.errors?.length) throw new Error(`Shopify: ${result.errors.map((error) => error.message).join("; ")}`);
  return result.data?.shopifyPaymentsAccount?.payouts.nodes ?? [];
}

// Transacciones del pago, sin la línea de la transferencia (type TRANSFER), que no es una venta. El filtro de Shopify
// por id de pago no funciona; el de fecha de pago sí, y luego se afina por id por si hay dos pagos el mismo día.
export async function payoutTransactions(env: Env, payout: Payout): Promise<BalanceTransaction[]> {
  const rows: BalanceTransaction[] = []; let after: string | null = null;
  for (let page = 0; page < 20; page++) {
    const result: Awaited<ReturnType<typeof shopify<{ shopifyPaymentsAccount: { balanceTransactions: { nodes: BalanceTransaction[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } }>>> = await shopify(env, `query($q: String!, $after: String) { shopifyPaymentsAccount { balanceTransactions(first: 250, after: $after, query: $q) { nodes { type transactionDate amount ${MONEY} fee ${MONEY} net ${MONEY} associatedOrder { id name } associatedPayout { id } sourceOrderTransactionId } pageInfo { hasNextPage endCursor } } } }`, { q: `payout_date:${payout.issuedAt.slice(0, 10)}`, after });
    if (result.errors?.length) throw new Error(`Shopify: ${result.errors.map((error) => error.message).join("; ")}`);
    const connection = result.data!.shopifyPaymentsAccount.balanceTransactions;
    rows.push(...connection.nodes);
    if (!connection.pageInfo.hasNextPage) break;
    after = connection.pageInfo.endCursor;
  }
  const mine = rows.filter((row) => row.associatedPayout?.id === payout.id && row.type !== "TRANSFER").sort((a, b) => a.transactionDate.localeCompare(b.transactionDate));
  await addCards(env, mine);
  return mine;
}

// Tarjeta con la que se pagó cada pedido (p. ej. «Mastercard (Apple Pay)»), como el icono del admin. Solo marca y
// monedero; nada de números de tarjeta. Si no se puede leer, la columna queda vacía.
const WALLETS: Record<string, string> = { APPLE_PAY: "Apple Pay", GOOGLE_PAY: "Google Pay", ANDROID_PAY: "Google Pay", SHOPIFY_PAY: "Shop Pay" };
type OrderPayments = { id: string; transactions: { id: string; paymentDetails: { company?: string | null; wallet?: string | null } | null }[] };
async function addCards(env: Env, rows: BalanceTransaction[]) {
  const ids = [...new Set(rows.map((row) => row.associatedOrder?.id).filter((id): id is string => Boolean(id)))];
  const orders = new Map<string, OrderPayments>();
  try {
    for (let start = 0; start < ids.length; start += 50) {
      const result = await shopify<{ nodes: (OrderPayments | null)[] }>(env, `query($ids: [ID!]!) { nodes(ids: $ids) { ... on Order { id transactions(first: 20) { id paymentDetails { ... on CardPaymentDetails { company wallet } } } } } }`, { ids: ids.slice(start, start + 50) });
      for (const order of result.data?.nodes ?? []) if (order?.id) orders.set(order.id, order);
    }
  } catch { return; }
  for (const row of rows) {
    const transactions = orders.get(row.associatedOrder?.id ?? "")?.transactions ?? [];
    const details = (transactions.find((item) => row.sourceOrderTransactionId && item.id.endsWith(`/${row.sourceOrderTransactionId}`)) ?? transactions.find((item) => item.paymentDetails?.company))?.paymentDetails;
    if (details?.company) row.card = details.wallet ? `${details.company} (${WALLETS[details.wallet] ?? details.wallet})` : details.company;
  }
}

const num = (money: Money | undefined) => Number(money?.amount ?? 0);
export const euros = (value: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", useGrouping: "always" }).format(value).replace(/ /g, " ");
const day = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
const STATUS: Record<string, string> = { PAID: "Pagado", SCHEDULED: "Programado", FAILED: "Fallido", CANCELED: "Cancelado" };
const TYPES: Record<string, string> = { CHARGE: "Cargo", REFUND: "Reembolso", REFUND_FAILURE: "Reembolso fallido", ADJUSTMENT: "Ajuste", CHARGE_ADJUSTMENT: "Ajuste de cargo", REFUND_ADJUSTMENT: "Ajuste de reembolso", DISPUTE_WITHDRAWAL: "Contracargo", DISPUTE_REVERSAL: "Contracargo revertido", CHARGEBACK_FEE: "Comisión por contracargo", CHARGEBACK_FEE_REFUND: "Devolución de comisión por contracargo", RESERVED_FUNDS: "Fondos reservados", RESERVED_FUNDS_WITHDRAWAL: "Retención de fondos", RESERVED_FUNDS_REVERSAL: "Liberación de fondos", RISK_WITHDRAWAL: "Retención por riesgo", RISK_REVERSAL: "Liberación por riesgo", APPLICATION_FEE_REFUND: "Devolución de comisión", SHIPPING_LABEL: "Etiqueta de envío", ADVANCE: "Anticipo", ADVANCE_FUNDING: "Financiación de anticipo", CURRENCY_CONVERSION: "Cambio de divisa" };
export const typeLabel = (type: string) => TYPES[type] ?? type;

// Filas del resumen, como el admin: bruto y comisión por tipo. Solo los tipos con importe, y siempre los cargos.
const SUMMARY_ROWS = [["Cargos", "chargesGross", "chargesFee"], ["Reembolsos", "refundsFeeGross", "refundsFee"], ["Ajustes", "adjustmentsGross", "adjustmentsFee"], ["Fondos reservados", "reservedFundsGross", "reservedFundsFee"], ["Pagos reintentados", "retriedPayoutsGross", "retriedPayoutsFee"], ["Anticipos", "advanceGross", "advanceFees"]] as const;
export function payoutSummary(payout: Payout) {
  const rows = SUMMARY_ROWS.map(([label, gross, fee]) => ({ label, gross: num(payout.summary[gross]), fee: num(payout.summary[fee]) })).filter((row, index) => index === 0 || row.gross || row.fee);
  return { rows, gross: rows.reduce((sum, row) => sum + row.gross, 0), fee: rows.reduce((sum, row) => sum + row.fee, 0), net: num(payout.net) };
}

// Las comisiones van en negativo, como en el admin de Shopify (David, 2026-11-20).
export function buildPayoutEmail(payout: Payout, transactions: BalanceTransaction[]) {
  const summary = payoutSummary(payout);
  const status = STATUS[payout.status] ?? payout.status;
  const subject = `${EMAIL_PREFIX} Nuevo pago de Shopify de ${euros(summary.net)}`;
  const lines: [string, string][] = [["Fecha", day(payout.issuedAt)], ["Estado", status], ["Importe neto", euros(summary.net)], ["Cargos", euros(num(payout.summary.chargesGross))], ["Comisiones", euros(-summary.fee)]];
  const orders = transactions.filter((row) => row.associatedOrder).length;
  const intro = `Shopify ha ingresado un pago en el banco de la tienda. En el Excel adjunto va el detalle (${transactions.length} ${transactions.length === 1 ? "transacción" : "transacciones"}${orders ? `, ${orders} ${orders === 1 ? "pedido" : "pedidos"}` : ""}).`;
  const text = [intro, "", ...lines.map(([label, value]) => `${label}: ${value}`)].join("\n");
  const html = `<p>${escapeHtml(intro)}</p><table cellpadding="4" style="border-collapse:collapse">${lines.map(([label, value]) => `<tr><td style="color:#555">${escapeHtml(label)}</td><td><strong>${escapeHtml(value)}</strong></td></tr>`).join("")}</table>`;

  const head = (labels: string[]): Cell[] => labels.map((label) => ({ bold: label }));
  const resumen: Cell[][] = [
    [{ bold: "Pago de Shopify" }, payout.legacyResourceId], ["Fecha", day(payout.issuedAt)], ["Estado", status], ["Importe neto", { euros: summary.net }], [],
    head(["Tipo", "Bruto", "Comisión", "Neto"]),
    ...summary.rows.map((row): Cell[] => [row.label, { euros: row.gross }, { euros: -row.fee }, { euros: row.gross - row.fee }]),
    [{ bold: "Total" }, { euros: summary.gross }, { euros: -summary.fee }, { euros: summary.net }],
  ];
  const detalle: Cell[][] = [
    head(["Fecha", "Tipo", "Tarjeta", "Pedido", "Cargo", "Comisión", "Neto"]),
    ...transactions.map((row): Cell[] => [{ date: new Date(row.transactionDate) }, typeLabel(row.type), row.card ?? "", row.associatedOrder?.name ?? "", { euros: num(row.amount) }, { euros: -num(row.fee) }, { euros: num(row.net) }]),
    [{ bold: "Total" }, "", "", "", { euros: transactions.reduce((sum, row) => sum + num(row.amount), 0) }, { euros: -transactions.reduce((sum, row) => sum + num(row.fee), 0) }, { euros: transactions.reduce((sum, row) => sum + num(row.net), 0) }],
  ];
  const xlsx = buildXlsx([{ name: "Transacciones", rows: detalle, widths: [18, 14, 26, 12, 14, 14, 14] }, { name: "Resumen", rows: resumen, widths: [20, 16, 14, 14] }]) // el detalle primero: es lo que se ve al abrirlo;
  return { subject, text, html, xlsx, filename: `pago-shopify-${payout.issuedAt.slice(0, 10)}-${payout.legacyResourceId}.xlsx` };
}

type Recipients = { para: string[]; copia: string[] };
async function recipients(db: SupabaseClient): Promise<Recipients | null> {
  const { data } = await db.from("store_settings").select("value").eq("key", "pagos_shopify_emails").maybeSingle();
  const value = (data?.value ?? {}) as Partial<Recipients>;
  const clean = (list: unknown) => (Array.isArray(list) ? list.map(String).map((item) => item.trim()).filter(Boolean) : []);
  const para = clean(value.para);
  return para.length ? { para, copia: clean(value.copia) } : null;
}

async function sendPayout(env: Env, payout: Payout, to: Recipients, idempotencyKey: string, test = false) {
  const transactions = await payoutTransactions(env, payout);
  const email = buildPayoutEmail(payout, transactions);
  const result = await sendEmail({ to: to.para, cc: to.copia.length ? to.copia : undefined, subject: test ? email.subject.replace("] ", "] [Prueba] ") : email.subject, html: email.html, text: email.text, idempotencyKey, attachments: [{ filename: email.filename, content: email.xlsx.toString("base64") }] });
  return { result, subject: email.subject, transactions: transactions.length };
}

// Envío de prueba de un pago concreto (o el último), solo a quien se diga; no toca el estado.
export async function testPayoutNotice(env: Env, to: string[], payoutId?: string) {
  const payouts = await listPayouts(env);
  const payout = payoutId ? payouts.find((item) => item.legacyResourceId === payoutId) : payouts[0];
  if (!payout) return { ok: false, error: "No encuentro ese pago" };
  const sent = await sendPayout(env, payout, { para: to, copia: [] }, `pago-shopify-prueba-${payout.legacyResourceId}-${Date.now()}`, true);
  return { ok: sent.result.ok, payout: payout.legacyResourceId, ...sent };
}

// La pasada diaria. La primera vez (sin nada en mhd_sync_events) marca como avisados los pagos que ya hay, salvo los
// de `avisarAlEmpezar`, para no mandar correos atrasados.
export async function runPayoutNotices(db: SupabaseClient, env: Env, options: { avisarAlEmpezar?: string[] } = {}) {
  const payouts = await listPayouts(env);
  const { data: events, error } = await db.from("mhd_sync_events").select("codigo,kind,detail").eq("sync", SYNC).in("kind", ["inicial", "aviso"]);
  if (error) throw new Error(error.message);
  let done: Set<string>; let inicial: string[] = [];
  if (!events?.length) {
    const marked = payouts.filter((payout) => !options.avisarAlEmpezar?.includes(payout.legacyResourceId));
    if (marked.length) {
      const { error: insertError } = await db.from("mhd_sync_events").insert(marked.map((payout) => ({ sync: SYNC, kind: "inicial", codigo: payout.legacyResourceId, detail: { date: payout.issuedAt.slice(0, 10), net: payout.net.amount, status: payout.status } })));
      if (insertError) throw new Error(insertError.message);
    }
    inicial = marked.map((payout) => payout.legacyResourceId); done = new Set(inicial);
  } else {
    done = new Set(events.filter((event) => event.kind === "inicial" || (event.detail as { sent?: boolean })?.sent === true).map((event) => event.codigo));
  }
  // Solo los ya ingresados (PAID); los programados se avisan cuando se paguen. Del más antiguo al más reciente.
  const pending = payouts.filter((payout) => payout.status === "PAID" && !done.has(payout.legacyResourceId)).reverse();
  if (!pending.length) return { ok: true, inicial, sent: [] };
  const to = await recipients(db);
  if (!to) return { ok: false, inicial, error: "Faltan los destinatarios (store_settings «pagos_shopify_emails»)", pending: pending.map((payout) => payout.legacyResourceId) };
  const sent = [];
  for (const payout of pending) {
    const outcome = await sendPayout(env, payout, to, `pago-shopify-${payout.legacyResourceId}`);
    await db.from("mhd_sync_events").insert({ sync: SYNC, kind: "aviso", codigo: payout.legacyResourceId, detail: { date: payout.issuedAt.slice(0, 10), net: payout.net.amount, subject: outcome.subject, to: to.para, cc: to.copia, transactions: outcome.transactions, sent: outcome.result.ok, error: outcome.result.ok ? null : outcome.result.error } });
    sent.push({ payout: payout.legacyResourceId, ok: outcome.result.ok, ...(outcome.result.ok ? {} : { error: outcome.result.error }) });
  }
  return { ok: sent.every((item) => item.ok), inicial, sent };
}
