// Crea en Shopify un pedido preparado con preparar-pedido-prestashop.mjs.
// Uso: node --env-file=.env.local scripts/crear-pedido-prestashop.mjs ruta/PS-4-5101813.json
// No reintenta: si la respuesta se pierde, hay que buscar el pedido por nombre antes de repetir.
import { readFileSync } from "node:fs";
import { assertSilent } from "../supabase/functions/_shared/pedido-prestashop.ts";

const file = process.argv[2];
if (!file) throw new Error("Falta el JSON del pedido preparado");
const { order, options } = JSON.parse(readFileSync(file, "utf8"));
assertSilent(order, options);

const store = process.env.SHOPIFY_STORE_URL.replace(/^https?:\/\//, "").replace(/\/$/, "");
async function shopify(query, variables = {}) {
  const response = await fetch(`https://${store}/admin/api/2026-10/graphql.json`, { method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN }, body: JSON.stringify({ query, variables }) });
  const body = await response.json();
  if (body.errors?.length) throw new Error(body.errors.map((item) => item.message).join(" | "));
  return body.data;
}

const { orders } = await shopify(`query($q: String!) { orders(first: 1, query: $q) { nodes { id name } } }`, { q: `name:"${order.name}"` });
if (orders.nodes.length) throw new Error(`${order.name} ya existe en Shopify (${orders.nodes[0].id}).`);

const data = await shopify(`mutation($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) { orderCreate(order: $order, options: $options) { order { id name } userErrors { field message code } } }`, { order, options });
const result = data.orderCreate;
if (result.userErrors.length) { console.error(JSON.stringify(result.userErrors, null, 2)); process.exit(1); }
console.log(`Creado ${result.order.name} · ${result.order.id}`);
