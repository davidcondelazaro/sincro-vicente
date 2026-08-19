import { createClient as createSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const activeJobs = new Set<string>();
const entities = [
  { name: "categories", endpoint: "categories", id: "cd_familia" },
  { name: "brands", endpoint: "brands", id: "cd_marca" },
  { name: "products", endpoint: "products", id: "codigo" },
  { name: "prices", endpoint: "prices", id: "codigo" },
  { name: "stock", endpoint: "stocks", id: "codigo" },
] as const;

function required(name: string) { const value = process.env[name]; if (!value) throw new Error(`Falta la variable ${name}.`); return value; }
function configured() { return ["NEXT_PUBLIC_SUPABASE_URL", "CATALOG_INGEST_TOKEN", "MHD_API_URL", "MHD_API_VERSION", "MHD_API_SUB_PATH", "MHD_API_USER", "MHD_API_PASS"].every((name) => Boolean(process.env[name])); }
async function signedIn() { const supabase = await createSupabaseClient(); const { data } = await supabase.auth.getClaims(); return Boolean(data?.claims.sub); }
async function catalogRequest(body: Record<string, unknown>) {
  const response = await fetch(`${required("NEXT_PUBLIC_SUPABASE_URL")}/functions/v1/import-source-catalog`, { method: "POST", headers: { "Content-Type": "application/json", "x-catalog-ingest-token": required("CATALOG_INGEST_TOKEN") }, body: JSON.stringify(body), cache: "no-store" });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "No se pudo guardar la importación MHD.");
  return payload;
}
function mhdUrl(path: string, page: number) { return `${required("MHD_API_URL").replace(/\/$/, "")}/api/${required("MHD_API_VERSION").replace(/^\/+|\/+$/g, "")}/${required("MHD_API_SUB_PATH").replace(/^\/+|\/+$/g, "")}/${path}?page=${page}&pageSize=1000`; }
function mhdHeaders() { return { Accept: "application/json", Authorization: `Basic ${Buffer.from(`${required("MHD_API_USER")}:${required("MHD_API_PASS")}`).toString("base64")}` }; }
type MhdResponse = { success?: boolean; data?: Record<string, unknown>[]; extra?: { totalRecords?: number; records?: number } ; errors?: unknown };

async function copy(runId: string) {
  const counts: Record<string, number> = {};
  const entityTimings: Record<string, { started_at: string; completed_at?: string }> = {};
  try {
    for (const [index, entity] of entities.entries()) {
      entityTimings[entity.name] = { started_at: new Date().toISOString() };
      const seen = new Set<string>(); let page = 1; let total: number | null = null;
      while (total === null || seen.size < total) {
        await catalogRequest({ action: "mhd-progress", batchId: runId, counts, progress: { phase: "reading", entity: entity.name, entityIndex: index + 1, totalEntities: entities.length, page, expected: total, entity_timings: entityTimings } });
        let response: Response | null = null; let body: MhdResponse | null = null;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          response = await fetch(mhdUrl(entity.endpoint, page), { headers: mhdHeaders(), cache: "no-store", signal: AbortSignal.timeout(45_000) });
          body = await response.json().catch(() => null) as MhdResponse | null;
          if (response.ok && body?.success && Array.isArray(body.data)) break;
          await new Promise((resolve) => setTimeout(resolve, 1_000 * (attempt + 1)));
        }
        if (!response?.ok || !body?.success || !Array.isArray(body.data)) throw new Error(`MHD no pudo devolver ${entity.name}, página ${page} (HTTP ${response?.status ?? "sin respuesta"}).`);
        total ??= Number(body.extra?.totalRecords);
        if (!Number.isInteger(total) || total < 0) throw new Error(`MHD no informó un total válido para ${entity.name}.`);
        if (!body.data.length && seen.size < total) throw new Error(`MHD devolvió una página vacía antes de completar ${entity.name}.`);
        const rows = body.data.map((payload) => ({ source_id: String(payload[entity.id] ?? ""), payload }));
        if (rows.some((row) => !row.source_id) || rows.some((row) => seen.has(row.source_id))) throw new Error(`MHD devolvió identificadores duplicados o vacíos en ${entity.name}.`);
        rows.forEach((row) => seen.add(row.source_id));
        await catalogRequest({ action: "mhd-rows", batchId: runId, entity: entity.name, rows });
        counts[entity.name] = seen.size;
        if (seen.size > total) throw new Error(`MHD devolvió más registros de los declarados para ${entity.name}.`);
        page += 1;
      }
      entityTimings[entity.name].completed_at = new Date().toISOString();
      await catalogRequest({ action: "mhd-progress", batchId: runId, counts, progress: { phase: "reading", entity: entity.name, entityIndex: index + 1, totalEntities: entities.length, page: page - 1, expected: total, entity_timings: entityTimings } });
    }
    await catalogRequest({ action: "mhd-progress", batchId: runId, counts, progress: { phase: "normalizing", entity_timings: entityTimings } });
    await catalogRequest({ action: "mhd-complete", batchId: runId, counts });
  } catch (error) {
    await catalogRequest({ action: "mhd-fail", batchId: runId, error: error instanceof Error ? error.message : "Error inesperado al importar MHD." }).catch(() => undefined);
  } finally { activeJobs.delete(runId); }
}

export async function GET() {
  if (!await signedIn()) return Response.json({ error: "Necesitas iniciar sesión." }, { status: 401 });
  if (!configured()) return Response.json({ error: "Falta configurar la API MHD en este entorno." }, { status: 503 });
  try { return Response.json(await catalogRequest({ action: "mhd-list" })); } catch { return Response.json({ error: "No se pudo consultar el historial MHD." }, { status: 500 }); }
}
export async function POST() {
  if (!await signedIn()) return Response.json({ error: "Necesitas iniciar sesión." }, { status: 401 });
  if (!configured()) return Response.json({ error: "Falta configurar la API MHD en este entorno." }, { status: 503 });
  if (activeJobs.size) return Response.json({ error: "Ya hay una importación MHD en curso." }, { status: 409 });
  try { const started = await catalogRequest({ action: "mhd-start" }); const run = started.run as { id: string }; activeJobs.add(run.id); void copy(run.id); return Response.json({ run }, { status: 202 }); } catch { return Response.json({ error: "No se pudo iniciar la importación MHD." }, { status: 500 }); }
}
