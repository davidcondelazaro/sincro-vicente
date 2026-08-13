import mysql from "mysql2/promise";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name}.`);
  return value;
}

async function checkMySql() {
  const connection = await mysql.createConnection({
    host: required("MYSQL_HOST"),
    port: Number(process.env.MYSQL_PORT ?? 3306),
    database: required("MYSQL_DATABASE"),
    user: required("MYSQL_USER"),
    password: required("MYSQL_PASSWORD"),
    ssl: process.env.MYSQL_SSL === "true" ? {} : undefined,
    connectTimeout: 10_000,
  });
  try {
    await connection.query("SELECT 1");
  } finally {
    await connection.end();
  }
}

async function checkShopify() {
  const store = required("SHOPIFY_STORE_URL").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const response = await fetch(`https://${store}/admin/api/2026-07/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": required("SHOPIFY_ACCESS_TOKEN") },
    body: JSON.stringify({ query: "query Health { shop { id } }" }),
    cache: "no-store",
  });
  const body = await response.json() as { errors?: { message: string }[] };
  if (!response.ok || body.errors?.length) throw new Error(`Shopify: ${body.errors?.[0]?.message ?? response.statusText}`);
}

export async function GET() {
  const [mysqlResult, shopifyResult] = await Promise.allSettled([checkMySql(), checkShopify()]);
  const mysqlOk = mysqlResult.status === "fulfilled";
  const shopifyOk = shopifyResult.status === "fulfilled";

  if (!mysqlOk) console.error(JSON.stringify({ level: "error", message: "MySQL health check failed", error: String(mysqlResult.reason) }));
  if (!shopifyOk) console.error(JSON.stringify({ level: "error", message: "Shopify health check failed", error: String(shopifyResult.reason) }));

  return Response.json({ mysql: mysqlOk, shopify: shopifyOk, checkedAt: new Date().toISOString() }, { status: mysqlOk && shopifyOk ? 200 : 503 });
}
