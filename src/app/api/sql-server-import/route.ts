import sql from "mssql";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const tables = [
  "ELECTRONICA_VICENTE_B2C_Productos",
  "ELECTRONICA_VICENTE_B2C_Caracteristicas",
  "ELECTRONICA_VICENTE_B2C_CaracteristicasValores",
  "ELECTRONICA_VICENTE_B2C_Categorias_Web",
  "ELECTRONICA_VICENTE_B2C_Fabricantes",
  "ELECTRONICA_VICENTE_B2C_Precios",
  "ELECTRONICA_VICENTE_B2C_Producto_Relacionados",
  "ELECTRONICA_VICENTE_B2C_Stocks",
] as const;

type SourceTable = (typeof tables)[number];
const activeJobs = new Set<string>();

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la configuración local ${name}.`);
  return value;
}

function configured() {
  return ["SQL_SERVER_HOST", "SQL_SERVER_DATABASE", "SQL_SERVER_USER", "SQL_SERVER_PASSWORD", "CATALOG_INGEST_TOKEN", "NEXT_PUBLIC_SUPABASE_URL"].every((name) => Boolean(process.env[name]));
}

async function assertSignedIn() {
  const supabase = await createSupabaseClient();
  const { data } = await supabase.auth.getClaims();
  return Boolean(data?.claims.sub);
}

async function catalogRequest(body: Record<string, unknown>) {
  const response = await fetch(`${required("NEXT_PUBLIC_SUPABASE_URL")}/functions/v1/import-source-catalog`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-catalog-ingest-token": required("CATALOG_INGEST_TOKEN") },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "No se pudo guardar el lote en Supabase.");
  return payload;
}

function connectionConfig(): sql.config {
  return {
    server: required("SQL_SERVER_HOST"),
    port: Number(process.env.SQL_SERVER_PORT ?? 1433),
    database: required("SQL_SERVER_DATABASE"),
    user: required("SQL_SERVER_USER"),
    password: required("SQL_SERVER_PASSWORD"),
    connectionTimeout: 30_000,
    requestTimeout: 180_000,
    options: { encrypt: process.env.SQL_SERVER_ENCRYPT === "true", trustServerCertificate: process.env.SQL_SERVER_TRUST_SERVER_CERTIFICATE === "true" },
  };
}

async function retry<T>(task: () => Promise<T>) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return await task(); } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1_000 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("La consulta de SQL Server no pudo completarse.");
}

async function streamTable(
  pool: sql.ConnectionPool,
  query: string,
  batchSize: number,
  onBatch: (rows: Record<string, unknown>[], rowStart: number) => Promise<void>,
) {
  await new Promise<void>((resolve, reject) => {
    const request = pool.request();
    request.stream = true;
    let rows: Record<string, unknown>[] = [];
    let rowStart = 0;
    let queue = Promise.resolve();
    let failed = false;
    const flush = (batch: Record<string, unknown>[]) => {
      request.pause();
      queue = queue.then(async () => {
        await onBatch(batch, rowStart);
        rowStart += batch.length;
        request.resume();
      }).catch((error) => {
        failed = true;
        request.cancel();
        reject(error);
      });
    };
    request.on("row", (row: Record<string, unknown>) => {
      if (failed) return;
      rows.push(row);
      if (rows.length >= batchSize) { const batch = rows; rows = []; flush(batch); }
    });
    request.on("error", (error) => { if (!failed) { failed = true; reject(error); } });
    request.on("done", () => {
      queue.then(async () => {
        if (failed) return;
        if (rows.length) await onBatch(rows, rowStart);
        resolve();
      }).catch(reject);
    });
    request.query(query);
  });
}

async function copyTables(runId: string, sourceTables: SourceTable[]) {
  const pool = await new sql.ConnectionPool(connectionConfig()).connect();
  const batchSize = 1_000;
  const counts: Record<string, number> = {};
  try {
    for (const sourceTable of sourceTables) {
      const escaped = `[dbo].[${sourceTable}]`;
      await retry(() => streamTable(pool, `SELECT * FROM ${escaped}`, batchSize, async (rows, rowStart) => {
        await catalogRequest({ action: "sqlserver-rows", batchId: runId, sourceTable, rowStart, rows });
        counts[sourceTable] = rowStart + rows.length;
      }));
    }
    await catalogRequest({ action: "sqlserver-progress", batchId: runId, progress: { phase: "normalizing", totalTables: sourceTables.length }, counts });
    await catalogRequest({ action: "sqlserver-complete", batchId: runId, counts });
  } catch (error) {
    await catalogRequest({ action: "sqlserver-fail", batchId: runId, error: error instanceof Error ? error.message : "Error inesperado al copiar SQL Server." }).catch(() => undefined);
  } finally {
    activeJobs.delete(runId);
    await pool.close();
  }
}

export async function GET() {
  if (!await assertSignedIn()) return Response.json({ error: "Necesitas iniciar sesión." }, { status: 401 });
  if (!configured()) return Response.json({ error: "El importador de SQL Server sólo está configurado en el entorno local." }, { status: 503 });
  try {
    return Response.json(await catalogRequest({ action: "sqlserver-list" }));
  } catch {
    return Response.json({ error: "No se pudo consultar el historial de copias." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!await assertSignedIn()) return Response.json({ error: "Necesitas iniciar sesión." }, { status: 401 });
  if (!configured()) return Response.json({ error: "El importador de SQL Server sólo está disponible localmente, con la VPN conectada." }, { status: 503 });
  if (activeJobs.size) return Response.json({ error: "Ya hay una copia de SQL Server en curso." }, { status: 409 });
  try {
    const body = await request.json() as { tables?: string[] };
    const selected = (body.tables ?? []).filter((name): name is SourceTable => (tables as readonly string[]).includes(name));
    if (!selected.length) return Response.json({ error: "Selecciona al menos una tabla." }, { status: 422 });
    const started = await catalogRequest({ action: "sqlserver-start", sourceName: "SQL Server Pladisel", tableNames: selected });
    const run = started.run as { id: string };
    activeJobs.add(run.id);
    void copyTables(run.id, selected);
    return Response.json({ run }, { status: 202 });
  } catch {
    return Response.json({ error: "No se pudo iniciar la copia desde SQL Server." }, { status: 500 });
  }
}
