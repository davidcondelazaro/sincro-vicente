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
      action: "start" | "rows" | "complete" | "fail" | "sqlserver-start" | "sqlserver-rows" | "sqlserver-progress" | "sqlserver-complete" | "sqlserver-fail" | "sqlserver-list" | "shopify-links-skus" | "shopify-links-upsert" | "mhd-product-detail";
      batchId?: string; sourceType?: "sqlite" | "sqlserver" | "csv"; sourceName?: string; entity?: string; rows?: Record<string, unknown>[]; counts?: Record<string, number>; error?: string;
      tableNames?: string[]; sourceTable?: string; rowStart?: number; progress?: Record<string, unknown>; afterSourceSku?: string;
    };
    if (body.action === "shopify-links-skus") {
      let query = db.from("source_products").select("id").order("id", { ascending: true }).limit(500);
      if (body.afterSourceSku) query = query.gt("id", body.afterSourceSku);
      const { data, error } = await query;
      if (error) throw error;
      return respond({ rows: data ?? [] });
    }
    if (body.action === "shopify-links-upsert") {
      if (!body.rows?.length || body.rows.length > 50) return respond({ error: "El lote de enlaces debe contener entre 1 y 50 filas" }, 400);
      const allowedStatuses = new Set(["linked", "missing_in_shopify", "ambiguous_in_shopify"]);
      const valid = body.rows.every((row) => typeof row.source_sku === "string" && row.source_sku.trim() && allowedStatuses.has(String(row.link_status)) && Number.isInteger(row.shopify_match_count));
      if (!valid) return respond({ error: "Lote de enlaces no válido" }, 400);
      const { error } = await db.from("product_shopify_links").upsert(body.rows, { onConflict: "source_sku" });
      if (error) throw error;
      return respond({ accepted: body.rows.length });
    }
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
    if (body.action === "mhd-list") {
      const { data, error } = await db.from("mhd_catalog_import_runs").select("*").order("started_at", { ascending: false }).limit(30);
      if (error) throw error;
      return respond({ runs: data ?? [] });
    }
    if (body.action === "mhd-view") {
      const entityTables: Record<string, { table: string; select: string; order: string; search: string[]; supportsEan?: boolean }> = {
        products: { table: "mhd_catalog_products", select: "codigo,titulo,nombre_marca,nombre_familia,pvp,stock,loaded_at", order: "codigo", search: ["codigo", "codigo_ean", "titulo"] },
        categories: { table: "mhd_catalog_categories", select: "cd_familia,nombre,nivel,activo,visible,breadcrumb,loaded_at", order: "nombre", search: ["nombre", "cd_familia"] },
        brands: { table: "mhd_catalog_brands", select: "cd_marca,nombre,activo,validada,loaded_at", order: "nombre", search: ["nombre", "cd_marca"] },
        prices: { table: "mhd_catalog_prices", select: "codigo,pvp,pvp_antes,iva,fecha_modificacion_precio,loaded_at", order: "codigo", search: ["codigo"], supportsEan: true },
        stock: { table: "mhd_catalog_stock", select: "codigo,stock,fecha_modificacion_stock,loaded_at", order: "codigo", search: ["codigo"], supportsEan: true },
      };
      const item = entityTables[String((body as Record<string, unknown>).entity ?? "products")];
      if (!item) return respond({ error: "Entidad MHD no válida" }, 400);
      const page = Math.max(0, Number((body as Record<string, unknown>).page ?? 0));
      const search = String((body as Record<string, unknown>).search ?? "").trim();
      let query = db.from(item.table).select(item.select, { count: "exact" }).order(item.order).range(page * 50, page * 50 + 49);
      if (search && item.supportsEan) {
        const { data: eanProducts, error: eanError } = await db.from("mhd_catalog_products").select("codigo").ilike("codigo_ean", `%${search}%`).limit(100);
        if (eanError) throw eanError;
        if (eanProducts?.length) query = query.in("codigo", eanProducts.map((product) => product.codigo));
        else query = query.ilike("codigo", `%${search}%`);
      } else if (search) query = query.or(item.search.map((column) => `${column}.ilike.%${search.replaceAll("%", "\\%").replaceAll(",", "\\,")}%`).join(","));
      const { data, error, count } = await query;
      if (error) throw error;
      return respond({ rows: data ?? [], total: count ?? 0 });
    }
    if (body.action === "mhd-product-detail") {
      const codigo = String((body as Record<string, unknown>).codigo ?? "").trim();
      if (!codigo) return respond({ error: "Falta el código del producto" }, 400);
      const { data, error } = await db.from("mhd_catalog_products").select("codigo,source_payload").eq("codigo", codigo).maybeSingle();
      if (error) throw error;
      if (!data) return respond({ error: "Producto MHD no encontrado" }, 404);
      return respond({ product: data.source_payload });
    }
    if (body.action === "mhd-start") {
      const { data, error } = await db.from("mhd_catalog_import_runs").insert({}).select("*").single();
      if (error) throw error;
      return respond({ run: data }, 201);
    }
    if (body.action?.startsWith("mhd-")) {
      if (!body.batchId) return respond({ error: "Falta batchId" }, 400);
      if (body.action === "mhd-progress") {
        const { error } = await db.from("mhd_catalog_import_runs").update({ progress: body.progress ?? {}, record_counts: body.counts ?? {} }).eq("id", body.batchId).eq("status", "running");
        if (error) throw error;
        return respond({ ok: true });
      }
      if (body.action === "mhd-rows") {
        const allowed = new Set(["products", "categories", "brands", "prices", "stock"]);
        if (!body.entity || !allowed.has(body.entity) || !body.rows?.length || body.rows.length > 1_000) return respond({ error: "Lote MHD no válido" }, 400);
        const rows = body.rows.map((row) => ({ import_run_id: body.batchId, entity_type: body.entity, source_id: String(row.source_id ?? ""), payload: row.payload, loaded_at: new Date().toISOString() }));
        if (!rows.every((row) => row.source_id && row.payload && typeof row.payload === "object" && !Array.isArray(row.payload))) return respond({ error: "Fila MHD no válida" }, 400);
        const { error } = await db.from("mhd_catalog_raw_rows").upsert(rows, { onConflict: "import_run_id,entity_type,source_id" });
        if (error) throw error;
        return respond({ accepted: rows.length });
      }
      if (body.action === "mhd-complete") {
        const { data, error } = await db.rpc("replace_mhd_catalog_from_run", { p_run_id: body.batchId });
        if (error) throw error;
        return respond({ counts: data });
      }
      if (body.action === "mhd-fail") {
        const { error } = await db.from("mhd_catalog_import_runs").update({ status: "failed", error_message: body.error ?? "Error de copia MHD", completed_at: new Date().toISOString() }).eq("id", body.batchId).eq("status", "running");
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
