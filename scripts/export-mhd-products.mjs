import { mkdir, writeFile } from "node:fs/promises";

const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const token = process.env.CATALOG_INGEST_TOKEN;
const output = process.argv[2] ?? "outputs/mhd-catalog-products.csv";
if (!baseUrl || !token) throw new Error("Faltan las variables de Supabase para exportar MHD.");

async function call(body) {
  const response = await fetch(`${baseUrl}/functions/v1/import-source-catalog`, { method: "POST", headers: { "Content-Type": "application/json", "x-catalog-ingest-token": token }, body: JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? "No se pudo leer el catálogo MHD.");
  return value;
}

const first = await call({ action: "mhd-view", entity: "products", page: 0 });
const pages = Math.ceil(first.total / 50);
const responses = new Array(pages); responses[0] = first;
let nextPage = 1;
await Promise.all(Array.from({ length: Math.min(12, Math.max(0, pages - 1)) }, async () => {
  while (nextPage < pages) { const page = nextPage++; responses[page] = await call({ action: "mhd-view", entity: "products", page }); }
}));

const columns = ["codigo", "titulo", "nombre_marca", "nombre_familia", "pvp", "stock"];
const headers = ["sku", "nombre", "marca", "familia", "pvp", "stock"];
const escape = (value) => { const text = value == null ? "" : String(value); return /[;\"\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; };
const rows = responses.flatMap((result) => result.rows);
await mkdir(new URL("../outputs/", import.meta.url), { recursive: true });
await writeFile(output, `${headers.join(";")}\n${rows.map((row) => columns.map((column) => escape(row[column])).join(";")).join("\n")}\n`, "utf8");
console.log(`Exportados ${rows.length} productos a ${output}`);
