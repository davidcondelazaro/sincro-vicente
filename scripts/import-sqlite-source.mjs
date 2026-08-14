import { execFileSync } from "node:child_process";

const dbFile = process.argv[2] ?? "../electronica_vicente.db";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ingestToken = process.env.CATALOG_INGEST_TOKEN;
if (!url || !ingestToken) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o CATALOG_INGEST_TOKEN en .env.local.");

const sources = [
  ["productos", "products"], ["categorias_web", "categories"], ["fabricantes", "manufacturers"], ["caracteristicas", "features"],
  ["caracteristicas_valores", "feature_values"], ["stocks", "stock"], ["precios", "prices"], ["producto_relacionados", "related_products"],
  ["categorias_metas", "category_metadata"], ["marcas_metas", "manufacturer_metadata"],
];
const booleanFields = new Set(["available_for_order", "active", "on_sale", "overlay_energetica", "online_only", "additional_delivery_times", "show_price"]);
const rename = { Precio_tarifa: "precio_tarifa", Desde: "desde", Hasta: "hasta" };
const post = async (body) => {
  const response = await fetch(`${url}/functions/v1/import-source-catalog`, { method: "POST", headers: { "Content-Type": "application/json", "x-catalog-ingest-token": ingestToken }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : JSON.stringify(result.error ?? result));
  return result;
};
const normalize = (row) => Object.fromEntries(Object.entries(row).map(([key, value]) => {
  const name = rename[key] ?? key;
  return [name, booleanFields.has(name) && value !== null ? Boolean(value) : value];
}));

const { batchId } = await post({ action: "start", sourceType: "sqlite", sourceName: dbFile });
const counts = {};
try {
  for (const [sqliteTable, entity] of sources) {
    const raw = execFileSync("sqlite3", ["-json", dbFile, `SELECT * FROM ${sqliteTable}`], { encoding: "utf8", maxBuffer: 100 * 1024 * 1024 });
    const rows = JSON.parse(raw || "[]").map(normalize);
    counts[entity] = rows.length;
    for (let index = 0; index < rows.length; index += 500) await post({ action: "rows", batchId, entity, rows: rows.slice(index, index + 500) });
    console.log(`${entity}: ${rows.length}`);
  }
  await post({ action: "complete", batchId, counts });
  console.log(`Carga completada. Lote: ${batchId}`);
} catch (error) {
  await post({ action: "fail", batchId, error: error instanceof Error ? error.message : String(error) });
  throw error;
}
