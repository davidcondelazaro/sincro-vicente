// Relaciones de Icecat en Shopify (David, 2026-10-30; docs/SINCRONIZACIONES_MHD.md). Una vez al día calcula en la base
// los complementarios y relacionados de cada producto (mhd_relations_calc), y manda solo lo que cambia respecto a lo
// último enviado (mhd_shopify_relations), en una operación masiva. En televisores, portátiles y monitores van primero
// las recetas por familia (complement-recipes.ts) y detrás lo de Icecat, hasta 10. Lo puesto a mano no se pisa: un metacampo que no está
// vacío ni coincide con lo último enviado se deja como está. Un producto que se queda sin relaciones conserva las suyas.
import type { SupabaseClient } from "@supabase/supabase-js";
import { shopifyGraphql, type ShopifyConfig } from "./store-filters";
import { sendAlert } from "./alerts";
import { computeComplements, mergeComplements, type RecipeProduct } from "./complement-recipes";

type Relation = { product_id: string; complementary: string[]; related: string[] };
type Current = { id: string; c: { value: string } | null; r: { value: string } | null };
type UserError = { field?: string[] | null; message: string };
type Field = { ownerId: string; namespace: string; key: string; type: string; value: string };

const NAMESPACE = "shopify--discovery--product_recommendation";
// Seguro: si el cálculo se queda muy por debajo de lo enviado, algo falla en los datos y no se envía nada.
export const RELATIONS_SYNC = { minShare: 0.8, readBatch: 100, fieldsPerLine: 25 };

async function event(db: SupabaseClient, kind: string, detail: Record<string, unknown>) {
  await db.from("mhd_sync_events").insert({ sync: "relaciones", kind, codigo: null, detail });
}

async function allRows<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>) {
  let rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw error;
    rows = rows.concat((data ?? []) as T[]);
    if (!data || data.length < 1000) return rows;
  }
}

// Las recetas se calculan sobre lo último enviado, para no cambiar lo que sigue siendo válido.
export function withRecipes(icecat: Relation[], products: RecipeProduct[], sent: Relation[]) {
  const rows = new Map(icecat.map((row) => [row.product_id, row]));
  const recipes = computeComplements(products, new Map(sent.map((row) => [row.product_id, row.complementary])));
  for (const [product_id, slots] of recipes) {
    if (!slots.length) continue;
    const row = rows.get(product_id);
    rows.set(product_id, { product_id, complementary: mergeComplements(slots, row?.complementary ?? []), related: row?.related ?? [] });
  }
  return [...rows.values()];
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const listField = (ownerId: string, key: string, ids: string[]): Field => ({ ownerId, namespace: NAMESPACE, key, type: "list.product_reference", value: JSON.stringify(ids) });

// Puede escribirse si está vacío o sigue como lo dejamos. Lo demás lo ha cambiado alguien.
function writable(current: { value: string } | null | undefined, sent: string[] | undefined) {
  if (!current) return true;
  return sent !== undefined && same(JSON.parse(current.value), sent);
}

export async function syncRelations(deps: { db: SupabaseClient; shopify: ShopifyConfig }, options: { dryRun?: boolean } = {}) {
  const { db, shopify } = deps;
  await checkLastBulk(deps);
  const icecat = await allRows<Relation>((from, to) => db.rpc("mhd_relations_calc").range(from, to));
  const products = await allRows<RecipeProduct>((from, to) => db.rpc("mhd_complements_source").range(from, to));
  const sentRows = await allRows<Relation>((from, to) => db.from("mhd_shopify_relations").select("product_id,complementary,related").order("product_id").range(from, to));
  const calculated = withRecipes(icecat, products, sentRows);
  if (calculated.length < sentRows.length * RELATIONS_SYNC.minShare) {
    const reason = `El cálculo da ${calculated.length} productos y hay ${sentRows.length} enviados.`;
    if (!options.dryRun) {
      await event(db, "freno", { reason });
      await sendAlert(db, { key: "relaciones:freno", subject: "Relaciones de Icecat paradas", lines: ["No se ha enviado nada a Shopify:", reason] });
    }
    return { ok: false, reason };
  }
  const sent = new Map(sentRows.map((row) => [row.product_id, row]));
  const changes = calculated.filter((row) => !same(row.complementary, sent.get(row.product_id)?.complementary ?? []) || !same(row.related, sent.get(row.product_id)?.related ?? []));
  const summary = { calculated: calculated.length, changes: changes.length, sent: 0, manual: 0, errors: [] as string[] };
  if (!changes.length) {
    if (!options.dryRun) await event(db, "vuelta", summary);
    return { ok: true, dryRun: options.dryRun ?? false, ...summary };
  }

  const current = new Map<string, Current>();
  for (let i = 0; i < changes.length; i += RELATIONS_SYNC.readBatch) {
    const { nodes } = await shopifyGraphql<{ nodes: (Current | null)[] }>(shopify, `query($ids: [ID!]!) { nodes(ids: $ids) { ... on Product { id c: metafield(namespace: "${NAMESPACE}", key: "complementary_products") { value } r: metafield(namespace: "${NAMESPACE}", key: "related_products") { value } } } }`, { ids: changes.slice(i, i + RELATIONS_SYNC.readBatch).map((row) => row.product_id) });
    for (const node of nodes) if (node) current.set(node.id, node);
  }
  const groups: { product: string; row: Relation; fields: Field[] }[] = [];
  for (const row of changes) {
    const node = current.get(row.product_id);
    if (!node) continue; // Borrado en Shopify
    const before = sent.get(row.product_id);
    const fields: Field[] = [];
    const saved: Relation = { product_id: row.product_id, complementary: before?.complementary ?? [], related: before?.related ?? [] };
    if (row.complementary.length && !same(row.complementary, before?.complementary ?? [])) {
      if (writable(node.c, before?.complementary)) { fields.push(listField(row.product_id, "complementary_products", row.complementary)); saved.complementary = row.complementary; }
      else summary.manual += 1;
    }
    if (row.related.length && !same(row.related, before?.related ?? [])) {
      if (writable(node.r, before?.related)) {
        fields.push(listField(row.product_id, "related_products", row.related));
        fields.push({ ownerId: row.product_id, namespace: NAMESPACE, key: "related_products_display", type: "single_line_text_field", value: "only manual" });
        saved.related = row.related;
      } else summary.manual += 1;
    }
    if (fields.length) groups.push({ product: row.product_id, row: saved, fields });
  }
  if (options.dryRun) return { ok: true, dryRun: true, ...summary, toWrite: groups.length, sample: groups.slice(0, 5).map((group) => group.product) };
  if (!groups.length) { await event(db, "vuelta", summary); return { ok: true, ...summary }; }

  // Cada línea de la operación masiva admite 25 metacampos.
  const lines: { fields: Field[]; products: string[] }[] = [];
  for (const group of groups) {
    let line = lines[lines.length - 1];
    if (!line || line.fields.length + group.fields.length > RELATIONS_SYNC.fieldsPerLine) { line = { fields: [], products: [] }; lines.push(line); }
    line.fields.push(...group.fields);
    line.products.push(group.product);
  }
  try {
    const bulk = await launchBulk(shopify, lines.map((line) => line.fields));
    const rows = groups.map((group) => ({ ...group.row, sent_at: new Date().toISOString() }));
    for (let i = 0; i < rows.length; i += 1000) {
      const { error } = await db.from("mhd_shopify_relations").upsert(rows.slice(i, i + 1000));
      if (error) summary.errors.push(`Guardar lo enviado: ${error.message}`);
    }
    summary.sent = groups.length;
    await event(db, "masivo", { bulk, lines: lines.map((line) => line.products) });
  } catch (caught) { summary.errors.push(caught instanceof Error ? caught.message : String(caught)); }
  await event(db, summary.errors.length ? "error" : "vuelta", { ...summary, errors: summary.errors.slice(0, 20) });
  if (summary.errors.length) await sendAlert(db, { key: "relaciones:error", subject: "Relaciones de Icecat: errores al enviar a Shopify", lines: summary.errors.slice(0, 10) });
  return { ok: summary.errors.length === 0, ...summary };
}

async function launchBulk(shopify: ShopifyConfig, lines: Field[][]) {
  const { currentBulkOperation: running } = await shopifyGraphql<{ currentBulkOperation: { id: string; status: string } | null }>(shopify, `{ currentBulkOperation(type: MUTATION) { id status } }`);
  if (running && ["CREATED", "RUNNING"].includes(running.status)) throw new Error(`Ya hay una operación masiva en marcha (${running.id}).`);
  const staged = await shopifyGraphql<{ stagedUploadsCreate: { stagedTargets: { url: string; parameters: { name: string; value: string }[] }[] } }>(shopify, `mutation { stagedUploadsCreate(input: [{ resource: BULK_MUTATION_VARIABLES, filename: "relaciones.jsonl", mimeType: "text/jsonl", httpMethod: POST }]) { stagedTargets { url parameters { name value } } } }`);
  const target = staged.stagedUploadsCreate.stagedTargets[0];
  const form = new FormData();
  for (const { name, value } of target.parameters) form.append(name, value);
  form.append("file", new Blob([lines.map((metafields) => JSON.stringify({ metafields })).join("\n")], { type: "text/jsonl" }), "relaciones.jsonl");
  const upload = await fetch(target.url, { method: "POST", body: form });
  if (!upload.ok) throw new Error(`Subida del fichero de relaciones: HTTP ${upload.status}`);
  const key = target.parameters.find((item) => item.name === "key")!.value;
  const run = await shopifyGraphql<{ bulkOperationRunMutation: { bulkOperation: { id: string } | null; userErrors: UserError[] } }>(shopify, `mutation($path: String!) { bulkOperationRunMutation(mutation: "mutation($metafields: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $metafields) { metafields { id } userErrors { field message } } }", stagedUploadPath: $path) { bulkOperation { id } userErrors { field message } } }`, { path: key });
  if (!run.bulkOperationRunMutation.bulkOperation) throw new Error(run.bulkOperationRunMutation.userErrors.map((item) => item.message).join("; "));
  return run.bulkOperationRunMutation.bulkOperation.id;
}

// Repasa la última operación masiva: lo que falló deja de constar como enviado y sale en la pasada siguiente.
async function checkLastBulk(deps: { db: SupabaseClient; shopify: ShopifyConfig }) {
  const { data: last } = await deps.db.from("mhd_sync_events").select("id,detail").eq("sync", "relaciones").eq("kind", "masivo").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!last) return;
  const { data: checked } = await deps.db.from("mhd_sync_events").select("id").eq("sync", "relaciones").eq("kind", "masivo-revisado").contains("detail", { event: last.id }).limit(1).maybeSingle();
  if (checked) return;
  const { bulk, lines } = last.detail as { bulk: string; lines: string[][] };
  const { node } = await shopifyGraphql<{ node: { status: string; url: string | null; errorCode: string | null } | null }>(deps.shopify, `query($id: ID!) { node(id: $id) { ... on BulkOperation { status url errorCode } } }`, { id: bulk });
  if (!node || ["CREATED", "RUNNING"].includes(node.status)) return;
  let failed: string[] = node.status === "COMPLETED" ? [] : lines.flat();
  if (node.status === "COMPLETED" && node.url) {
    const text = await (await fetch(node.url)).text();
    failed = text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { __lineNumber?: number; data?: { metafieldsSet?: { userErrors?: UserError[] } } })
      .filter((row) => (row.data?.metafieldsSet?.userErrors?.length ?? 0) > 0).flatMap((row) => lines[row.__lineNumber ?? -1] ?? []);
  }
  for (let i = 0; i < failed.length; i += 500) await deps.db.from("mhd_shopify_relations").delete().in("product_id", failed.slice(i, i + 500));
  await event(deps.db, "masivo-revisado", { event: last.id, bulk, status: node.status, errorCode: node.errorCode, failed: failed.length });
}
