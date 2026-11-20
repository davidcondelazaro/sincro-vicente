// Avisos de pagos de Shopify (2026-11-20): asunto, cuerpo y Excel con el pago real del 20-11-2026.
import assert from "node:assert/strict";
import test from "node:test";
import { inflateRawSync } from "node:zlib";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": new URL("../src", import.meta.url).pathname } });
const { buildPayoutEmail, euros } = await jiti.import("../src/lib/shopify-payouts.ts");

const money = (amount) => ({ amount });
const zero = money("0.0");
const payout = {
  id: "gid://shopify/ShopifyPaymentsPayout/169084322124", legacyResourceId: "169084322124", issuedAt: "2026-11-20T00:00:00Z", status: "PAID", net: { amount: "114.33", currencyCode: "EUR" },
  summary: { adjustmentsFee: zero, adjustmentsGross: zero, advanceFees: zero, advanceGross: zero, chargesFee: money("2.47"), chargesGross: money("116.8"), refundsFee: zero, refundsFeeGross: zero, reservedFundsFee: zero, reservedFundsGross: zero, retriedPayoutsFee: zero, retriedPayoutsGross: zero },
};
const tx = (date, order, amount, fee, net) => ({ type: "CHARGE", transactionDate: date, amount: money(amount), fee: money(fee), net: money(net), associatedOrder: { id: "gid://shopify/Order/1", name: order }, sourceOrderTransactionId: null, card: "Mastercard", associatedPayout: { id: payout.id } });
const transactions = [tx("2026-11-17T14:23:30Z", "EV99344", "98.8", "1.88", "96.92"), tx("2026-11-17T17:34:42Z", "EV99345", "18.0", "0.59", "17.41")];

// Lee un archivo del ZIP (el .xlsx) por su nombre.
function unzip(buffer, name) {
  for (let offset = 0; buffer.readUInt32LE(offset) === 0x04034b50;) {
    const size = buffer.readUInt32LE(offset + 18); const nameLength = buffer.readUInt16LE(offset + 26); const extra = buffer.readUInt16LE(offset + 28);
    const fileName = buffer.toString("utf8", offset + 30, offset + 30 + nameLength); const start = offset + 30 + nameLength + extra;
    if (fileName === name) return inflateRawSync(buffer.subarray(start, start + size)).toString("utf8");
    offset = start + size;
  }
  return null;
}

test("pagos: importes en formato español", () => {
  assert.equal(euros(114.33), "114,33 €");
  assert.equal(euros(1234.5), "1.234,50 €");
});

test("pagos: asunto y cuerpo", () => {
  const email = buildPayoutEmail(payout, transactions);
  assert.equal(email.subject, "[Electrónica Vicente Utils] Nuevo pago de Shopify de 114,33 €");
  for (const line of ["Fecha: 20/11/2026", "Estado: Pagado", "Importe neto: 114,33 €", "Cargos: 116,80 €", "Comisiones: 2,47 €"]) assert.ok(email.text.includes(line), line);
});

test("pagos: Excel con resumen y una fila por transacción", () => {
  const { xlsx } = buildPayoutEmail(payout, transactions);
  const workbook = unzip(xlsx, "xl/workbook.xml");
  assert.match(workbook, /name="Transacciones".*name="Resumen"/); // el detalle es la primera hoja
  const detail = unzip(xlsx, "xl/worksheets/sheet1.xml");
  assert.equal((detail.match(/<row /g) ?? []).length, 4); // cabecera, dos transacciones y total
  for (const value of ["EV99344", "EV99345", "Mastercard", "<v>96.92</v>", "<v>0.59</v>", "<v>114.33</v>"]) assert.ok(detail.includes(value), value);
  assert.ok(unzip(xlsx, "xl/worksheets/sheet2.xml").includes("<v>116.8</v>"));
});
