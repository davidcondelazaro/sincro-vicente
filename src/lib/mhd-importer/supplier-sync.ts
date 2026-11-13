import type { SupabaseClient } from "@supabase/supabase-js";
import { sendAlert } from "./alerts";
import { publishedCodes } from "./delivery-options-sync";
import { latestRead } from "./price-stock-sync";
import { shopifyGraphql, type ShopifyConfig } from "./store-filters";

// Proveedor de MHD en Shopify (David, 2026-11-13; docs/SINCRONIZACIONES_MHD.md › Proveedor). Paso de la vuelta: lleva
// `cd_proveedor` y `nombre_proveedor` del listado a los metacampos custom.proveedor_codigo y custom.proveedor_nombre,
// de los que cuelgan reglas. Mismo esquema que las opciones de entrega: se compara con lo último registrado
// (`mhd_shopify_suppliers`) y, antes de escribir, con lo que hay en Shopify. Lo que MHD ya no trae no se borra.
export type Supplier = { codigo: number; nombre: string };
type Change = { codigo: string; product_id: string; supplier: Supplier; sent: Supplier | null };
type Node = { id: string; codigo: { value: string } | null; nombre: { value: string } | null };
type UserError = { field?: string[] | null; message: string };

// metafieldsSet admite 25 metacampos por llamada: 12 productos de dos metacampos.
export const SUPPLIER_SYNC = { defaultMax: 300, compareBatch: 1000, readBatch: 100, writeBatch: 12, budgetMs: 30_000 };

// Pura. Lo que hay en Shopify, o null si no tiene los dos metacampos.
export function shopifySupplier(node: Pick<Node, "codigo" | "nombre">): Supplier | null {
  const codigo = Number(node.codigo?.value);
  const nombre = node.nombre?.value?.trim();
  return Number.isInteger(codigo) && nombre ? { codigo, nombre } : null;
}

export function sameSupplier(a: Supplier | null, b: Supplier | null) {
  return a?.codigo === b?.codigo && a?.nombre === b?.nombre;
}

// Pura. Un cambio de proveedor de verdad (no el primer relleno ni un retoque del nombre): merece aviso, porque puede
// cambiar las reglas que le tocan al producto.
export function supplierSwitched(before: Supplier | null, after: Supplier) {
  return before !== null && before.codigo !== after.codigo;
}

export const supplierMetafields = (ownerId: string, supplier: Supplier) => [
  { ownerId, namespace: "custom", key: "proveedor_codigo", type: "number_integer", value: String(supplier.codigo) },
  { ownerId, namespace: "custom", key: "proveedor_nombre", type: "single_line_text_field", value: supplier.nombre },
];

async function event(db: SupabaseClient, kind: string, detail: Record<string, unknown>, codigo: string | null = null) {
  await db.from("mhd_sync_events").insert({ sync: "proveedor", kind, codigo, detail });
}

async function maxSwitches(db: SupabaseClient) {
  const { data } = await db.from("store_settings").select("value").eq("key", "supplier_switch_max").maybeSingle();
  return Number(data?.value ?? SUPPLIER_SYNC.defaultMax);
}

export async function syncSuppliers(deps: { db: SupabaseClient; shopify: ShopifyConfig }, options: { runId?: string; dryRun?: boolean; budgetMs?: number } = {}) {
  const { db, shopify } = deps;
  const deadline = Date.now() + (options.budgetMs ?? SUPPLIER_SYNC.budgetMs);
  const read = await latestRead(db, options.runId);
  if (!read.ok) return { skipped: true, reason: read.reason };
  const codes = await publishedCodes(db);
  let changes: Change[] = [];
  for (let i = 0; i < codes.length; i += SUPPLIER_SYNC.compareBatch) {
    const { data, error } = await db.rpc("mhd_supplier_changes", { p_run: read.run, p_codigos: codes.slice(i, i + SUPPLIER_SYNC.compareBatch) });
    if (error) throw new Error(error.message);
    changes = changes.concat((data ?? []) as Change[]);
  }
  // Primero lo ya comprobado, que es lo que de verdad ha cambiado
  changes.sort((a, b) => Number(a.sent === null) - Number(b.sent === null));
  // Freno: muchos productos que cambian de proveedor en una vuelta huele a dato roto de MHD. Si es real, se sube
  // supplier_switch_max en store_settings.
  const switches = changes.filter((item) => supplierSwitched(item.sent, item.supplier));
  const max = await maxSwitches(db);
  if (switches.length > max) {
    const reason = `${switches.length} productos cambian de proveedor en una vuelta (máximo ${max}).`;
    if (!options.dryRun) {
      await event(db, "freno", { reason, run: read.run, sample: switches.slice(0, 5).map((item) => item.codigo) });
      await sendAlert(db, { key: "proveedor:freno", quietMinutes: 24 * 60, subject: "Proveedor parado", lines: ["No se ha enviado nada a Shopify:", reason, "Si el cambio es real, sube supplier_switch_max en store_settings."] });
    }
    return { skipped: true, reason };
  }

  const summary = { changes: changes.length, checked: 0, same: 0, sent: 0, pending: 0, errors: [] as string[], switched: [] as string[] };
  for (let i = 0; i < changes.length && Date.now() < deadline; i += SUPPLIER_SYNC.readBatch) {
    const batch = changes.slice(i, i + SUPPLIER_SYNC.readBatch);
    const { nodes } = await shopifyGraphql<{ nodes: (Node | null)[] }>(shopify, `query($ids: [ID!]!) { nodes(ids: $ids) { ... on Product { id codigo: metafield(namespace: "custom", key: "proveedor_codigo") { value } nombre: metafield(namespace: "custom", key: "proveedor_nombre") { value } } } }`, { ids: batch.map((item) => item.product_id) });
    const current = new Map(nodes.filter((node): node is Node => Boolean(node?.id)).map((node) => [node.id, shopifySupplier(node)]));
    const live = batch.filter((item) => current.has(item.product_id)); // Los demás, borrados en Shopify
    const same = live.filter((item) => sameSupplier(current.get(item.product_id)!, item.supplier));
    const different = live.filter((item) => !same.includes(item));
    summary.checked += batch.length; summary.same += same.length;
    if (options.dryRun) { summary.sent += different.length; continue; }
    const done = [...same];
    for (let j = 0; j < different.length; j += SUPPLIER_SYNC.writeBatch) {
      const group = different.slice(j, j + SUPPLIER_SYNC.writeBatch);
      const result = await shopifyGraphql<{ metafieldsSet: { userErrors: UserError[] } }>(shopify, `mutation($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { field message } } }`, { m: group.flatMap((item) => supplierMetafields(item.product_id, item.supplier)) });
      if (result.metafieldsSet.userErrors.length) { summary.errors.push(...result.metafieldsSet.userErrors.map((error) => error.message)); continue; }
      done.push(...group); summary.sent += group.length;
      await db.from("mhd_sync_events").insert(group.map((item) => ({ sync: "proveedor", kind: "cambio", codigo: item.codigo, detail: { antes: current.get(item.product_id), ahora: item.supplier } })));
      for (const item of group) {
        const before = current.get(item.product_id)!;
        if (supplierSwitched(before, item.supplier)) summary.switched.push(`${item.codigo} · ${before!.nombre} → ${item.supplier.nombre}`);
      }
    }
    if (done.length) {
      const { error } = await db.from("mhd_shopify_suppliers").upsert(done.map((item) => ({ codigo: item.codigo, product_id: item.product_id, supplier: item.supplier, sent_at: new Date().toISOString() })));
      if (error) summary.errors.push(`Guardar lo enviado: ${error.message}`);
    }
  }
  summary.pending = changes.length - summary.checked;
  if (options.dryRun) return { dryRun: true, ...summary };
  await event(db, summary.errors.length ? "error" : "vuelta", { ...summary, errors: summary.errors.slice(0, 20), switched: summary.switched.slice(0, 50) });
  if (summary.switched.length) await sendAlert(db, { key: "proveedor:cambios", quietMinutes: 24 * 60, subject: `Proveedor: ${summary.switched.length} productos cambian de proveedor`, lines: ["Ya está en la web. Revisa si les afecta alguna regla:", ...summary.switched.slice(0, 20)] });
  if (summary.errors.length) await sendAlert(db, { key: "proveedor:error", quietMinutes: 24 * 60, subject: `Proveedor: ${summary.errors.length} errores al enviar a Shopify`, lines: summary.errors.slice(0, 10) });
  return { ...summary, errors: summary.errors.slice(0, 20), switched: summary.switched.slice(0, 50) };
}
