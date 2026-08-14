import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const token = Deno.env.get("CATALOG_INGEST_TOKEN");
const entities: Record<string, { table: string; key: string }> = {
  products: { table: "source_products", key: "id" }, categories: { table: "source_categories", key: "id" },
  manufacturers: { table: "source_manufacturers", key: "id" }, features: { table: "source_features", key: "id" },
  feature_values: { table: "source_feature_values", key: "id" }, stock: { table: "source_stock", key: "id" },
  prices: { table: "source_prices", key: "id" }, related_products: { table: "source_related_products", key: "id" },
  category_metadata: { table: "source_category_metadata", key: "id_category" }, manufacturer_metadata: { table: "source_manufacturer_metadata", key: "id_manufacturer" },
};
const respond = (body: unknown, status = 200) => Response.json(body, { status });

Deno.serve(async (request) => {
  if (request.method !== "POST") return respond({ error: "Método no permitido" }, 405);
  if (!token || request.headers.get("x-catalog-ingest-token") !== token) return respond({ error: "No autorizado" }, 401);
  try {
    const body = await request.json() as {
      action: "start" | "rows" | "complete" | "fail" | "sqlserver-start" | "sqlserver-rows" | "sqlserver-progress" | "sqlserver-complete" | "sqlserver-fail" | "sqlserver-list";
      batchId?: string; sourceType?: "sqlite" | "sqlserver" | "csv"; sourceName?: string; entity?: string; rows?: Record<string, unknown>[]; counts?: Record<string, number>; error?: string;
      tableNames?: string[]; sourceTable?: string; rowStart?: number; progress?: Record<string, unknown>;
    };
    if (body.action === "sqlserver-list") {
      const { data, error } = await db.from("source_sqlserver_import_runs").select("*").order("started_at", { ascending: false }).limit(15);
      if (error) throw error;
      return respond({ runs: data ?? [] });
    }
    if (body.action === "sqlserver-start") {
      if (!body.tableNames?.length) return respond({ error: "Selecciona al menos una tabla" }, 400);
      const { data, error } = await db.from("source_sqlserver_import_runs").insert({ source_name: body.sourceName ?? "SQL Server Pladisel", table_names: body.tableNames }).select("*").single();
      if (error) throw error;
      return respond({ run: data }, 201);
    }
    if (body.action?.startsWith("sqlserver-")) {
      if (!body.batchId) return respond({ error: "Falta batchId" }, 400);
      if (body.action === "sqlserver-progress") {
        const patch = { progress: body.progress ?? {}, ...(body.counts ? { record_counts: body.counts } : {}) };
        const { error } = await db.from("source_sqlserver_import_runs").update(patch).eq("id", body.batchId);
        if (error) throw error;
        return respond({ ok: true });
      }
      if (body.action === "sqlserver-rows") {
        if (!body.sourceTable || !body.rows?.length || !Number.isInteger(body.rowStart) || body.rowStart! < 0) return respond({ error: "Lote de SQL Server no válido" }, 400);
        const loadedAt = new Date().toISOString();
        const rows = body.rows.map((payload, index) => ({ import_run_id: body.batchId, source_table: body.sourceTable, row_number: body.rowStart! + index, payload, loaded_at: loadedAt }));
        const { error: rowError } = await db.from("source_sqlserver_rows").upsert(rows, { onConflict: "import_run_id,source_table,row_number" });
        if (rowError) throw rowError;
        return respond({ accepted: rows.length });
      }
      if (body.action === "sqlserver-complete") {
        const { data: currentRun, error: currentRunError } = await db.from("source_sqlserver_import_runs").select("table_names").eq("id", body.batchId).single();
        if (currentRunError) throw currentRunError;
        const { data: normalized, error: normalizeError } = await db.rpc("replace_source_catalog_from_sqlserver", { p_run_id: body.batchId });
        if (normalizeError) throw normalizeError;
        const { error: deleteError } = await db.from("source_sqlserver_rows").delete().in("source_table", currentRun.table_names).neq("import_run_id", body.batchId);
        if (deleteError) throw deleteError;
        const { error: completeError } = await db.from("source_sqlserver_import_runs").update({ status: "completed", active: true, progress: { phase: "completed", normalized }, record_counts: body.counts ?? {}, completed_at: new Date().toISOString(), error_message: null }).eq("id", body.batchId);
        if (completeError) throw completeError;
        return respond({ ok: true });
      }
      if (body.action === "sqlserver-fail") {
        const { error: deleteError } = await db.from("source_sqlserver_rows").delete().eq("import_run_id", body.batchId);
        if (deleteError) throw deleteError;
        const { error } = await db.from("source_sqlserver_import_runs").update({ status: "failed", error_message: body.error ?? "Error de copia", completed_at: new Date().toISOString() }).eq("id", body.batchId);
        if (error) throw error;
        return respond({ ok: true });
      }
    }
    if (body.action === "start") {
      const { data, error } = await db.from("source_catalog_batches").insert({ source_type: body.sourceType, source_name: body.sourceName }).select("id").single();
      if (error) throw error;
      return respond({ batchId: data.id }, 201);
    }
    if (!body.batchId) return respond({ error: "Falta batchId" }, 400);
    if (body.action === "rows") {
      const entity = body.entity ? entities[body.entity] : undefined;
      if (!entity || !body.rows?.length) return respond({ error: "Entidad o filas no válidas" }, 400);
      const rows = body.rows.map((row) => ({ ...row, source_batch_id: body.batchId, loaded_at: new Date().toISOString() }));
      const { error } = await db.from(entity.table).upsert(rows, { onConflict: entity.key });
      if (error) throw error;
      return respond({ accepted: rows.length });
    }
    const patch = body.action === "complete" ? { status: "completed", record_counts: body.counts ?? {}, completed_at: new Date().toISOString(), error_message: null } : { status: "failed", error_message: body.error ?? "Error de carga", completed_at: new Date().toISOString() };
    const { error } = await db.from("source_catalog_batches").update(patch).eq("id", body.batchId);
    if (error) throw error;
    return respond({ ok: true });
  } catch (error) { return respond({ error: error instanceof Error ? error.message : JSON.stringify(error) }, 500); }
});
