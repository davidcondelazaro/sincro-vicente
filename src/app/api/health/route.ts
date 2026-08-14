import mysql from "mysql2/promise";
import sql from "mssql";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEALTH_CACHE_MS = 5 * 60 * 1_000;

type Health = {
  mysql: boolean;
  shopify: boolean;
  sqlServer: boolean;
  mhd: boolean;
  icecat: boolean;
  errors: Partial<Record<"mysql" | "shopify" | "sqlServer" | "mhd" | "icecat", string>>;
  checkedAt: string;
};


function failureMessage(result: PromiseSettledResult<unknown>) {
  if (result.status === "fulfilled") return undefined;
  const value = result.reason instanceof Error ? result.reason.message : String(result.reason);
  return value.replace(/\s+/g, " ").trim().slice(0, 220) || "La conexión no está disponible.";
}

let cachedHealth: Health | null = null;
let healthCheckInFlight: Promise<Health> | null = null;

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

async function checkSqlServer() {
  const configured = ["SQL_SERVER_HOST", "SQL_SERVER_DATABASE", "SQL_SERVER_USER", "SQL_SERVER_PASSWORD"].every((name) => Boolean(process.env[name]));
  if (!configured) return false;
  const pool = await new sql.ConnectionPool({
    server: required("SQL_SERVER_HOST"), port: Number(process.env.SQL_SERVER_PORT ?? 1433), database: required("SQL_SERVER_DATABASE"),
    user: required("SQL_SERVER_USER"), password: required("SQL_SERVER_PASSWORD"), connectionTimeout: 15_000, requestTimeout: 30_000,
    options: { encrypt: process.env.SQL_SERVER_ENCRYPT === "true", trustServerCertificate: process.env.SQL_SERVER_TRUST_SERVER_CERTIFICATE === "true" },
  }).connect();
  try { await pool.request().query("SELECT 1 AS connected"); return true; } finally { await pool.close(); }
}

async function checkMhd() {
  const baseUrl = required("MHD_API_URL").replace(/\/$/, "");
  const version = required("MHD_API_VERSION");
  const subPath = required("MHD_API_SUB_PATH");
  const user = required("MHD_API_USER");
  const password = required("MHD_API_PASS");
  const response = await fetch(`${baseUrl}/api/${version}/${subPath}/categories?page=1&pageSize=1`, {
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`,
    },
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  });
  const body = await response.json().catch(() => null) as { success?: boolean } | null;
  if (!response.ok || body?.success !== true) throw new Error(`MHD: ${response.status}`);
}

async function checkIcecat() {
  const query = new URLSearchParams({
    UserName: required("ICECAT_USERNAME"),
    Language: process.env.ICECAT_LANGUAGE || "es",
    GTIN: "0000000000000",
    app_key: required("ICECAT_APP_KEY"),
  });
  const response = await fetch(`https://live.icecat.biz/api?${query.toString()}`, {
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  // El GTIN de prueba no tiene por qué existir: 200, 400 o 404 demuestran que
  // Icecat ha recibido y atendido correctamente las credenciales y la petición.
  if (![200, 400, 404].includes(response.status)) {
    throw new Error(`Icecat: HTTP ${response.status} ${response.statusText}`.trim());
  }
}

async function checkHealth(): Promise<Health> {
  const [mysqlResult, shopifyResult, sqlServerResult, mhdResult, icecatResult] = await Promise.allSettled([checkMySql(), checkShopify(), checkSqlServer(), checkMhd(), checkIcecat()]);
  const mysqlOk = mysqlResult.status === "fulfilled";
  const shopifyOk = shopifyResult.status === "fulfilled";
  const sqlServerOk = sqlServerResult.status === "fulfilled" && sqlServerResult.value;
  const mhdOk = mhdResult.status === "fulfilled";
  const icecatOk = icecatResult.status === "fulfilled";

  if (!mysqlOk) console.error(JSON.stringify({ level: "error", message: "MySQL health check failed", error: String(mysqlResult.reason) }));
  if (!shopifyOk) console.error(JSON.stringify({ level: "error", message: "Shopify health check failed", error: String(shopifyResult.reason) }));
  if (sqlServerResult.status === "rejected") console.error(JSON.stringify({ level: "error", message: "SQL Server health check failed" }));
  if (!mhdOk) console.error(JSON.stringify({ level: "error", message: "MHD health check failed", error: String(mhdResult.reason) }));
  if (!icecatOk) console.error(JSON.stringify({ level: "error", message: "Icecat health check failed", error: String(icecatResult.reason) }));

  return { mysql: mysqlOk, shopify: shopifyOk, sqlServer: sqlServerOk, mhd: mhdOk, icecat: icecatOk, errors: { ...(mysqlOk ? {} : { mysql: failureMessage(mysqlResult) }), ...(shopifyOk ? {} : { shopify: failureMessage(shopifyResult) }), ...(sqlServerOk ? {} : { sqlServer: failureMessage(sqlServerResult) }), ...(mhdOk ? {} : { mhd: failureMessage(mhdResult) }), ...(icecatOk ? {} : { icecat: failureMessage(icecatResult) }) }, checkedAt: new Date().toISOString() };
}

export async function GET(request: Request) {
  const refresh = new URL(request.url).searchParams.get("refresh") === "1";
  const isFresh = cachedHealth && Date.now() - new Date(cachedHealth.checkedAt).getTime() < HEALTH_CACHE_MS;
  if (refresh || !isFresh) {
    healthCheckInFlight ??= checkHealth().then((health) => {
      cachedHealth = health;
      return health;
    }).finally(() => {
      healthCheckInFlight = null;
    });
    await healthCheckInFlight;
  }

  const health = cachedHealth!;
  return Response.json(health, {
    status: health.mysql && health.shopify && health.mhd && health.icecat ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
