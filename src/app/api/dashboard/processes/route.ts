import { createClient as createSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Status = "queued" | "running" | "paused" | "stopped" | "completed" | "failed";
type RawRun = {
  id: string; status: Status; total_count?: number; processed_count?: number; created_count?: number; updated_count?: number;
  unchanged_count?: number; warning_count?: number; error_count?: number; existing_count?: number;
  mode?: string; filters?: Record<string, unknown>; parameters?: Record<string, unknown>; started_at?: string | null; finished_at?: string | null; created_at: string;
};
type Process = {
  id: string; entity: string; family: string; href: string; status: Status; total: number; processed: number;
  created: number; updated: number; unchanged: number; warnings: number; errors: number; syncType: string; startedAt: string | null; finishedAt: string | null; createdAt: string;
};
type SqlServerRun = {
  id: string; status: "running" | "completed" | "failed"; record_counts: Record<string, number>;
  started_at: string; completed_at: string | null;
};

const catalogEntities = [
  ["manufacturers", "Marcas", "/importacion-catalogo"], ["categories", "Categorías", "/importacion-catalogo"],
  ["features", "Características", "/importacion-catalogo"], ["products", "Productos", "/importacion-catalogo"],
  ["priorities", "Ordenación de productos", "/ordenacion-productos"], ["icecat", "Icecat", "/importacion-icecat"],
] as const;

const activeStatuses: Status[] = ["queued", "running", "paused"];

async function sqlServerRuns(): Promise<SqlServerRun[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const token = process.env.CATALOG_INGEST_TOKEN;
  if (!url || !token) return [];
  try {
    const response = await fetch(`${url}/functions/v1/import-source-catalog`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-catalog-ingest-token": token },
      body: JSON.stringify({ action: "sqlserver-list" }),
      cache: "no-store",
    });
    if (!response.ok) return [];
    const body = await response.json() as { runs?: SqlServerRun[] };
    return body.runs ?? [];
  } catch { return []; }
}

function normalize(run: RawRun, entity: string, family: string, href: string): Process {
  return {
    id: run.id, entity, family, href, status: run.status, total: Number(run.total_count ?? 0), processed: Number(run.processed_count ?? 0),
    created: Number(run.created_count ?? 0), updated: Number(run.updated_count ?? 0), unchanged: Number(run.unchanged_count ?? run.existing_count ?? 0),
    warnings: Number(run.warning_count ?? 0), errors: Number(run.error_count ?? 0), syncType: syncType(run), startedAt: run.started_at ?? null, finishedAt: run.finished_at ?? null, createdAt: run.created_at,
  };
}

function syncType(run: RawRun) {
  if (run.mode === "all") return "Completa";
  if (run.mode === "partial") return "Parcial";
  if (run.mode === "selective" || run.mode === "id") return "Selectiva";
  if (run.mode === "from_date") return "Desde fecha";
  if (run.mode === "latest") return "Últimos registros";
  const filters = run.filters ?? run.parameters ?? {};
  if (filters.modifiedSince || filters.changedSince) return "Parcial";
  if (Object.values(filters).some((value) => Array.isArray(value) && value.length || typeof value === "string" && value)) return "Selectiva";
  return "Completa";
}

export async function GET() {
  const supabase = await createSupabaseClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims.sub) return Response.json({ error: "Necesitas iniciar sesión." }, { status: 401 });

  const [customersResult, catalogResult, priceStockResult, sqlServer] = await Promise.all([
    supabase.from("customer_import_runs").select("*").order("created_at", { ascending: false }).limit(80),
    supabase.from("catalog_import_runs").select("*").order("created_at", { ascending: false }).limit(160),
    supabase.from("price_stock_import_runs").select("*").order("created_at", { ascending: false }).limit(80),
    sqlServerRuns(),
  ]);
  if (customersResult.error || catalogResult.error || priceStockResult.error) return Response.json({ error: "No se pudo recuperar el resumen de procesos." }, { status: 500 });

  const processes: Process[] = [];
  for (const run of (customersResult.data ?? []) as RawRun[]) processes.push(normalize(run, "Clientes", "Importación", "/importacion-clientes"));
  for (const run of (catalogResult.data ?? []) as Array<RawRun & { entity_type: string }>) {
    const entry = catalogEntities.find(([type]) => type === run.entity_type);
    if (entry) processes.push(normalize(run, entry[1], "Catálogo", entry[2]));
  }
  for (const run of (priceStockResult.data ?? []) as Array<RawRun & { import_type: "prices" | "stock" }>) {
    processes.push(normalize(run, run.import_type === "prices" ? "Precios" : "Stock", "Actualización", run.import_type === "prices" ? "/importacion-precios" : "/importacion-stock"));
  }
  for (const run of sqlServer) {
    processes.push({
      id: run.id, entity: "Copia SQL Server", family: "Origen de datos", href: "/importar-datos-sql-server", status: run.status,
      total: 0, processed: Object.values(run.record_counts ?? {}).reduce((total, count) => total + Number(count), 0),
      created: 0, updated: 0, unchanged: 0, warnings: 0, errors: 0, syncType: "Copia de origen", startedAt: run.started_at, finishedAt: run.completed_at, createdAt: run.started_at,
    });
  }

  const active = processes.filter((process) => activeStatuses.includes(process.status)).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const summaries = [
    ...catalogEntities.map(([type, entity, href]) => ({ type: `catalog:${type}`, entity, family: "Catálogo", href })),
    { type: "customers", entity: "Clientes", family: "Importación", href: "/importacion-clientes" },
    { type: "prices", entity: "Precios", family: "Actualización", href: "/importacion-precios" },
    { type: "stock", entity: "Stock", family: "Actualización", href: "/importacion-stock" },
    { type: "sqlserver", entity: "Copia SQL Server", family: "Origen de datos", href: "/importar-datos-sql-server" },
  ].map((summary) => ({ ...summary, latest: processes.find((process) => process.entity === summary.entity && process.status === "completed") ?? null }));

  return Response.json({ active, summaries });
}
