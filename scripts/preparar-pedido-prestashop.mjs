// Prepara el `orderCreate` de Shopify para un pedido de PrestaShop, sin enviarlo.
// Uso: node --env-file=.env.local scripts/preparar-pedido-prestashop.mjs 4-5101813 [carpeta-salida]
// Las reglas están en supabase/functions/_shared/pedido-prestashop.ts (las mismas que usa la importación de la app).
import mysql from "mysql2/promise";
import { mkdirSync, writeFileSync } from "node:fs";
import { buildOrder, cleanEmail, euros, loadOrder, shortDate } from "../supabase/functions/_shared/pedido-prestashop.ts";

const reference = process.argv[2];
const outDir = process.argv[3] ?? "outputs/pedidos-prestashop";
if (!reference) throw new Error("Falta la referencia del pedido (p. ej. 4-5101813)");

const env = process.env;
const db = await mysql.createConnection({ host: env.MYSQL_HOST, port: Number(env.MYSQL_PORT || 3306), database: env.MYSQL_DATABASE, user: env.MYSQL_USER, password: env.MYSQL_PASSWORD, ssl: env.MYSQL_SSL === "true" ? { rejectUnauthorized: false } : undefined, dateStrings: true });
const q = async (sql, values = []) => (await db.query(sql, values))[0];

async function shopify(query, variables = {}) {
  const store = env.SHOPIFY_STORE_URL.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const response = await fetch(`https://${store}/admin/api/2026-10/graphql.json`, { method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": env.SHOPIFY_ACCESS_TOKEN }, body: JSON.stringify({ query, variables }) });
  const body = await response.json();
  if (body.errors?.length) throw new Error(body.errors.map((item) => item.message).join(" | "));
  return body.data;
}

const data = await loadOrder(q, { reference });
await db.end();
if (!data) throw new Error(`No existe el pedido ${reference}`);
const { order, delivery, invoice } = data;

const customer = (await shopify(`query($email: String!) { customerByIdentifier(identifier: { emailAddress: $email }) { id displayName addressesV2(first: 20) { nodes { address1 } } } }`, { email: cleanEmail(order.email) })).customerByIdentifier;
const { input, options, warnings, summary } = buildOrder(data, customer?.id ?? null);
const [existing] = (await shopify(`query($q: String!) { orders(first: 1, query: $q) { nodes { id name } } }`, { q: `name:"${input.name}"` })).orders.nodes;
if (existing) warnings.push(`Ya existe en Shopify el pedido ${existing.name} (${existing.id}).`);

mkdirSync(outDir, { recursive: true });
const file = `${outDir}/${input.name}.json`;
writeFileSync(file, JSON.stringify({ order: input, options }, null, 2));

const { total, computed, orderTax, shipping, discountTotal, discountName, financialStatus, refunds, refunded, shipped, trackings, historyText } = summary;
console.log(`Pedido ${input.name} · ${shortDate(order.date_add)} (Madrid) → processedAt ${input.processedAt}`);
console.log(`Cliente: ${customer ? `${customer.displayName} (${customer.id}), ${customer.addressesV2.nodes.length} direcciones en su ficha` : "NO EXISTE en Shopify"} · ${order.email}`);
console.log(`Envío: ${[delivery?.address1, delivery?.postcode, delivery?.city, delivery?.country_code].join(", ")} · Facturación: ${[invoice?.address1, invoice?.postcode, invoice?.city].join(", ")}`);
console.log("Líneas:");
for (const line of input.lineItems) console.log(`  ${line.quantity} × ${line.title.slice(0, 60)} [${line.sku ?? "sin SKU"}] ${euros(Number(line.priceSet.shopMoney.amount))}${line.taxLines.length ? ` · ${line.taxLines[0].title} ${euros(Number(line.taxLines[0].priceSet.shopMoney.amount))}` : " · sin IVA"}`);
console.log(`Portes: ${euros(shipping)} · Descuento: ${discountTotal > 0 ? `${euros(discountTotal)} «${discountName}»` : "ninguno"} · Total: ${euros(total)} (calculado ${euros(computed)}) · IVA del pedido ${euros(orderTax)}`);
console.log(`Pago: ${financialStatus} · ${order.payment}${refunds.length ? ` · devuelto ${euros(refunded)}` : ""} · Enviado: ${shipped ? `sí${trackings.length ? `, seguimiento ${trackings.map((item) => `${item.company} ${item.number}`).join(" / ")}` : ", sin seguimiento"}` : "no"}`);
console.log(`Nota: ${input.note ?? "(ninguna)"}`);
console.log(`Atributos: ${JSON.stringify(input.customAttributes ?? [])}`);
console.log(`\nHistorial (metacampo prestashop.historial):\n${historyText}`);
console.log(`\nAvisos: ${warnings.length ? `\n  - ${warnings.join("\n  - ")}` : "ninguno"}`);
console.log(`\nGuardado en ${file}`);
