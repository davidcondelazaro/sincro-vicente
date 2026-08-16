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
  return ["SQL_SERVER_PROXY_URL", "SQL_SERVER_PROXY_TOKEN", "CATALOG_INGEST_TOKEN", "NEXT_PUBLIC_SUPABASE_URL"].every((name) => Boolean(process.env[name]));
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

async function readTableFromProxy(sourceTable: SourceTable) {
  const response = await fetch(required("SQL_SERVER_PROXY_URL"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${required("SQL_SERVER_PROXY_TOKEN")}`,
    },
    body: JSON.stringify({ query: `SELECT * FROM [dbo].[${sourceTable}]` }),
    signal: AbortSignal.timeout(180_000),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null) as { rows?: unknown; error?: string } | null;
  if (!response.ok) throw new Error(payload?.error ?? `El puente SQL Server devolvió HTTP ${response.status}.`);
  if (!Array.isArray(payload?.rows) || !payload.rows.every((row) => row && typeof row === "object" && !Array.isArray(row))) {
    throw new Error(`El puente SQL Server devolvió un resultado no válido para ${sourceTable}.`);
  }
  return payload.rows as Record<string, unknown>[];
}

async function copyTables(runId: string, sourceTables: SourceTable[]) {
  const batchSize = 1_000;
  const counts: Record<string, number> = {};
  try {
    for (const [tableIndex, sourceTable] of sourceTables.entries()) {
      await catalogRequest({ action: "sqlserver-progress", batchId: runId, progress: { phase: "reading", currentTable: sourceTable, tableIndex: tableIndex + 1, totalTables: sourceTables.length }, counts });
      const rows = await retry(() => readTableFromProxy(sourceTable));
      for (let rowStart = 0; rowStart < rows.length; rowStart += batchSize) {
        const batch = rows.slice(rowStart, rowStart + batchSize);
        await catalogRequest({ action: "sqlserver-rows", batchId: runId, sourceTable, rowStart, rows: batch });
        counts[sourceTable] = rowStart + batch.length;
        await catalogRequest({ action: "sqlserver-progress", batchId: runId, progress: { phase: "reading", currentTable: sourceTable, tableIndex: tableIndex + 1, totalTables: sourceTables.length, currentTableTotal: rows.length }, counts });
      }
      counts[sourceTable] ??= 0;
    }
    await catalogRequest({ action: "sqlserver-progress", batchId: runId, progress: { phase: "normalizing", totalTables: sourceTables.length }, counts });
    await catalogRequest({ action: "sqlserver-complete", batchId: runId, counts });
  } catch (error) {
    await catalogRequest({ action: "sqlserver-fail", batchId: runId, error: error instanceof Error ? error.message : "Error inesperado al copiar SQL Server." }).catch(() => undefined);
  } finally {
    activeJobs.delete(runId);
  }
}

export async function GET() {
  if (!await assertSignedIn()) return Response.json({ error: "Necesitas iniciar sesión." }, { status: 401 });
  if (!configured()) return Response.json({ error: "Falta configurar el puente de SQL Server en este entorno." }, { status: 503 });
  try {
    return Response.json(await catalogRequest({ action: "sqlserver-list" }));
  } catch {
    return Response.json({ error: "No se pudo consultar el historial de copias." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!await assertSignedIn()) return Response.json({ error: "Necesitas iniciar sesión." }, { status: 401 });
  if (!configured()) return Response.json({ error: "Falta configurar el puente de SQL Server en este entorno." }, { status: 503 });
  if (activeJobs.size) return Response.json({ error: "Ya hay una copia de SQL Server en curso." }, { status: 409 });
  try {
    const body = await request.json() as { tables?: string[] };
    const selected = (body.tables ?? []).filter((name): name is SourceTable => (tables as readonly string[]).includes(name));
    if (!selected.length) return Response.json({ error: "Selecciona al menos una tabla." }, { status: 422 });
    const started = await catalogRequest({ action: "sqlserver-start", sourceName: "SQL Server Pladisel (puente HTTPS)", tableNames: selected });
    const run = started.run as { id: string };
    activeJobs.add(run.id);
    void copyTables(run.id, selected);
    return Response.json({ run }, { status: 202 });
  } catch {
    return Response.json({ error: "No se pudo iniciar la copia desde SQL Server." }, { status: 500 });
  }
}
