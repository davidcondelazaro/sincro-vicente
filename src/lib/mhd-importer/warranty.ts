// Marca de ampliación de garantía de cada producto (custom.admite_garantia), decidida al importar (David, 2026-10-28):
// el tema y el chatbot solo la leen; el tema pone tramos, productos de garantía y precio mínimo, y sin marca no ofrece
// garantía. Criterio, el de Garantía3: todo lo eléctrico o electrónico (theme-enterprise-vicente/docs/garantias-por-familia.md).
// En este orden:
// 1. La primera regla de su familia en store_warranty_title_rules (por `position`) cuyo patrón casa con el título.
// 2. La casilla de su familia en store_collections (`warranty_eligible`).
// 3. Familia sin decidir (null): no se escribe la marca (y se borra la que hubiera); hay que decidirla en la tabla.
// Se gestionan en Tienda → Garantías. Cuando MHD mande su propio dato, pasa a ser la fuente y estas tablas quedan para corregir.
import type { SupabaseClient } from "@supabase/supabase-js";
import { shopifyGraphql, type ShopifyConfig } from "./store-filters";

type Rule = { id: number; pattern: RegExp; eligible: boolean };
export type WarrantyTables = { byFamily: Map<string, boolean | null>; rules: Map<string, Rule[]> };
export type WarrantyDecision = { eligible: boolean | null; reason: string; ruleId?: number };
let warrantyCache: { at: number; tables: WarrantyTables } | null = null;

export async function loadWarrantyTables(db: SupabaseClient): Promise<WarrantyTables> {
  const [{ data: families, error: familiesError }, { data: rows, error: rulesError }] = await Promise.all([
    db.from("store_collections").select("handle,warranty_eligible").eq("level", "familia"),
    db.from("store_warranty_title_rules").select("id,family_handle,pattern,eligible,position").order("position").order("id"),
  ]);
  if (familiesError) throw familiesError;
  if (rulesError) throw rulesError;
  const rules = new Map<string, Rule[]>();
  for (const row of rows as { id: number; family_handle: string; pattern: string; eligible: boolean }[]) {
    rules.set(row.family_handle, [...(rules.get(row.family_handle) ?? []), { id: row.id, pattern: new RegExp(row.pattern, "i"), eligible: row.eligible }]);
  }
  return { byFamily: new Map((families as { handle: string; warranty_eligible: boolean | null }[]).map((row) => [row.handle, row.warranty_eligible])), rules };
}

export function decideWarranty(tables: WarrantyTables, family: string, title: string): WarrantyDecision {
  const rule = tables.rules.get(family)?.find((item) => item.pattern.test(title));
  if (rule) return { eligible: rule.eligible, reason: `regla por título (${rule.pattern.source})`, ruleId: rule.id };
  const eligible = tables.byFamily.get(family) ?? null;
  return { eligible, reason: eligible === null ? `familia «${family}» sin decidir en store_collections.warranty_eligible` : `familia «${family}»` };
}

/** Para la subida: tablas leídas una vez por hora. */
export async function warrantyEligible(db: SupabaseClient, family: string, title: string): Promise<WarrantyDecision> {
  if (!warrantyCache || Date.now() - warrantyCache.at > 3_600_000) warrantyCache = { at: Date.now(), tables: await loadWarrantyTables(db) };
  return decideWarranty(warrantyCache.tables, family, title);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Vuelve a calcular la marca de todos los productos de MHD de la tienda (los que llevan custom.familia) y escribe solo las
 * que cambian: tras tocar el cuadro o las reglas, sin esperar a que el importador refresque cada producto. Una consulta
 * masiva para leer y metafieldsSet/metafieldsDelete de 25 en 25 para escribir.
 */
export async function reapplyWarranty(db: SupabaseClient, shopify: ShopifyConfig, options: { dryRun?: boolean; maxWaitMs?: number; budgetMs?: number } = {}) {
  // Tope de tiempo para escribir (la función de Vercel dura 300 s): lo que no quepa se hace al volver a pulsar.
  const stopAt = Date.now() + (options.budgetMs ?? 250_000);
  const tables = await loadWarrantyTables(db);
  type Started = { bulkOperationRunQuery: { bulkOperation: { id: string } | null; userErrors: { message: string }[] } };
  const started = await shopifyGraphql<Started>(shopify, `mutation($q: String!) { bulkOperationRunQuery(query: $q) { bulkOperation { id } userErrors { message } } }`,
    { q: `{ products { edges { node { id title familia: metafield(namespace: "custom", key: "familia") { value } marca: metafield(namespace: "custom", key: "admite_garantia") { value } } } } }` });
  const operation = started.bulkOperationRunQuery.bulkOperation;
  if (!operation) throw new Error(`Shopify no aceptó la consulta masiva (puede haber otra en marcha, p. ej. el espejo): ${started.bulkOperationRunQuery.userErrors.map((item) => item.message).join("; ")}`);
  type Status = { bulkOperation: { status: string; url: string | null; errorCode: string | null } | null };
  const deadline = Date.now() + (options.maxWaitMs ?? 180_000);
  let url: string | null = null;
  for (let wait = 1_000; ; wait = Math.min(wait * 1.5, 5_000)) {
    const { bulkOperation } = await shopifyGraphql<Status>(shopify, `query($id: ID!) { bulkOperation(id: $id) { status url errorCode } }`, { id: operation.id });
    if (bulkOperation?.status === "COMPLETED") { url = bulkOperation.url; break; }
    if (bulkOperation && ["FAILED", "CANCELED", "EXPIRED"].includes(bulkOperation.status)) throw new Error(`La consulta masiva de Shopify terminó en ${bulkOperation.status} (${bulkOperation.errorCode ?? "sin código"}).`);
    if (Date.now() > deadline) throw new Error("La consulta masiva de Shopify no terminó a tiempo.");
    await sleep(wait);
  }
  const text = url ? await (await fetch(url, { signal: AbortSignal.timeout(120_000) })).text() : "";
  const set: { ownerId: string; namespace: string; key: string; type: string; value: string }[] = [];
  const remove: { ownerId: string; namespace: string; key: string }[] = [];
  const examples: { title: string; before: string | null; after: boolean | null; reason: string }[] = [];
  let products = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const node = JSON.parse(line) as { id: string; title: string; familia: { value: string } | null; marca: { value: string } | null };
    if (!node.familia) continue; // Solo lo de MHD: garantías, servicios y tarjeta regalo no llevan marca.
    products++;
    const decision = decideWarranty(tables, node.familia.value, node.title);
    const before = node.marca?.value ?? null;
    const after = decision.eligible === null ? null : String(decision.eligible);
    if (before === after) continue;
    if (after === null) remove.push({ ownerId: node.id, namespace: "custom", key: "admite_garantia" });
    else set.push({ ownerId: node.id, namespace: "custom", key: "admite_garantia", type: "boolean", value: after });
    if (examples.length < 20) examples.push({ title: node.title, before, after: decision.eligible, reason: decision.reason });
  }
  let written = 0;
  if (!options.dryRun) {
    for (let i = 0; i < set.length && Date.now() < stopAt; i += 25) {
      const done = await shopifyGraphql<{ metafieldsSet: { userErrors: { message: string }[] } }>(shopify, `mutation($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { message } } }`, { m: set.slice(i, i + 25) });
      if (done.metafieldsSet.userErrors.length) throw new Error(`Shopify no guardó la marca: ${done.metafieldsSet.userErrors.map((item) => item.message).join("; ")}`);
      written += set.slice(i, i + 25).length;
    }
    for (let i = 0; i < remove.length && Date.now() < stopAt; i += 25) {
      const done = await shopifyGraphql<{ metafieldsDelete: { userErrors: { message: string }[] } }>(shopify, `mutation($m: [MetafieldIdentifierInput!]!) { metafieldsDelete(metafields: $m) { userErrors { message } } }`, { m: remove.slice(i, i + 25) });
      if (done.metafieldsDelete.userErrors.length) throw new Error(`Shopify no borró la marca: ${done.metafieldsDelete.userErrors.map((item) => item.message).join("; ")}`);
      written += remove.slice(i, i + 25).length;
    }
  }
  return { products, toYes: set.filter((item) => item.value === "true").length, toNo: set.filter((item) => item.value === "false").length, removed: remove.length, pending: options.dryRun ? 0 : set.length + remove.length - written, examples, dryRun: Boolean(options.dryRun) };
}
