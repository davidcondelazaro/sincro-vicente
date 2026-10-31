import type { SupabaseClient } from "@supabase/supabase-js";
import { sendAlert } from "./alerts";
import { latestRead } from "./price-stock-sync";
import { shopifyGraphql, type ShopifyConfig } from "./store-filters";

// Opciones de entrega en Shopify (David, 2026-10-26: «se actualizan solas, siempre»; docs/SINCRONIZACIONES_MHD.md). Paso
// de la vuelta: lleva los portes y servicios de cada aparato al metacampo custom.opciones_entrega, del que beben el
// tema, el servicio de portes y la exportación de pedidos. Sin IA. Antes de escribir se mira lo que hay en Shopify, así
// que la primera pasada solo apunta lo que ya coincide. Sin operación masiva (la de precios no admite otra a la vez):
// lo que no quepa en el tiempo de la vuelta sigue en la siguiente.
type Options = Record<string, unknown>;
type Change = { codigo: string; product_id: string; options: Options; sent: Options | null };
type Node = { id: string; metafield: { value: string } | null };
type UserError = { field?: string[] | null; message: string };

export const DELIVERY_OPTIONS_SYNC = { defaultMax: 500, readBatch: 100, writeBatch: 25, budgetMs: 60_000, riseShare: 1.5 };
const SERVICE_KEYS = ["subida_puerta_particulares", "instalacion_particulares", "retirada_usado_particulares"];
const AMOUNT_KEYS = [...SERVICE_KEYS, "gastos_envio_peninsula_particulares", "gastos_envio_baleares_particulares", "gastos_envio_portugal_baremo_1_particulares", "gastos_envio_portugal_baremo_2_particulares"];

const amount = (value: unknown) => value === null || value === undefined || value === "" ? null : Number(value);

// Pura. Compara importes, no texto: «9.90» y 9.9 son lo mismo, y sin metacampo es igual que todo a null.
export function sameDeliveryOptions(a: Options | null, b: Options | null) {
  return AMOUNT_KEYS.every((key) => amount(a?.[key]) === amount(b?.[key]));
}

// Pura. Lo que merece aviso (David, 2026-10-26): un servicio o porte que desaparece, o un importe que sube mucho.
export function notableChanges(before: Options | null, after: Options) {
  const notes: string[] = [];
  for (const key of AMOUNT_KEYS) {
    const was = amount(before?.[key]); const now = amount(after[key]);
    if (was !== null && now === null) notes.push(`${key}: ${was} → sin dato`);
    else if (was !== null && was > 0 && now !== null && now > was * DELIVERY_OPTIONS_SYNC.riseShare) notes.push(`${key}: ${was} → ${now}`);
  }
  return notes;
}

function parsed(metafield: { value: string } | null) {
  if (!metafield) return null;
  try { return JSON.parse(metafield.value) as Options; } catch { return { invalido: true } as Options; }
}

async function event(db: SupabaseClient, kind: string, detail: Record<string, unknown>, codigo: string | null = null) {
  await db.from("mhd_sync_events").insert({ sync: "opciones-entrega", kind, codigo, detail });
}

async function maxChanges(db: SupabaseClient) {
  const { data } = await db.from("store_settings").select("value").eq("key", "delivery_options_max").maybeSingle();
  return Number(data?.value ?? DELIVERY_OPTIONS_SYNC.defaultMax);
}

export async function syncDeliveryOptions(deps: { db: SupabaseClient; shopify: ShopifyConfig }, options: { runId?: string; dryRun?: boolean; budgetMs?: number } = {}) {
  const { db, shopify } = deps;
  const deadline = Date.now() + (options.budgetMs ?? DELIVERY_OPTIONS_SYNC.budgetMs);
  const read = await latestRead(db, options.runId);
  if (!read.ok) return { skipped: true, reason: read.reason };
  let changes: Change[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.rpc("mhd_delivery_options_changes", { p_run: read.run, p_limit: 50_000 }).range(from, from + 999);
    if (error) throw error;
    changes = changes.concat((data ?? []) as Change[]);
    if (!data || data.length < 1000) break;
  }
  // Freno: muchos cambios de golpe en lo ya comprobado suelen ser datos rotos. Si es real, se sube delivery_options_max.
  const known = changes.filter((item) => item.sent !== null).length;
  const max = await maxChanges(db);
  if (known > max) {
    const reason = `${known} productos con portes o servicios cambiados en una vuelta (máximo ${max}).`;
    if (!options.dryRun) {
      await event(db, "freno", { reason, run: read.run, sample: changes.slice(0, 5).map((item) => item.codigo) });
      await sendAlert(db, { key: "opciones-entrega:freno", quietMinutes: 24 * 60, subject: "Opciones de entrega paradas", lines: ["No se ha enviado nada a Shopify:", reason, "Si el cambio es real, sube delivery_options_max en store_settings."] });
    }
    return { skipped: true, reason };
  }

  const summary = { changes: changes.length, known, checked: 0, same: 0, sent: 0, pending: 0, errors: [] as string[], notable: [] as string[] };
  for (let i = 0; i < changes.length && Date.now() < deadline; i += DELIVERY_OPTIONS_SYNC.readBatch) {
    const batch = changes.slice(i, i + DELIVERY_OPTIONS_SYNC.readBatch);
    const { nodes } = await shopifyGraphql<{ nodes: (Node | null)[] }>(shopify, `query($ids: [ID!]!) { nodes(ids: $ids) { ... on Product { id metafield(namespace: "custom", key: "opciones_entrega") { value } } } }`, { ids: batch.map((item) => item.product_id) });
    const current = new Map(nodes.filter((node): node is Node => Boolean(node)).map((node) => [node.id, parsed(node.metafield)]));
    const live = batch.filter((item) => current.has(item.product_id)); // Los demás, borrados en Shopify
    const same = live.filter((item) => sameDeliveryOptions(current.get(item.product_id)!, item.options));
    const different = live.filter((item) => !same.includes(item));
    summary.checked += batch.length; summary.same += same.length;
    if (options.dryRun) { summary.sent += different.length; continue; }
    const done = [...same];
    for (let j = 0; j < different.length; j += DELIVERY_OPTIONS_SYNC.writeBatch) {
      const group = different.slice(j, j + DELIVERY_OPTIONS_SYNC.writeBatch);
      const result = await shopifyGraphql<{ metafieldsSet: { userErrors: UserError[] } }>(shopify, `mutation($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { field message } } }`, { m: group.map((item) => ({ ownerId: item.product_id, namespace: "custom", key: "opciones_entrega", type: "json", value: JSON.stringify(item.options) })) });
      if (result.metafieldsSet.userErrors.length) { summary.errors.push(...result.metafieldsSet.userErrors.map((error) => error.message)); continue; }
      done.push(...group); summary.sent += group.length;
      const events = group.map((item) => ({ sync: "opciones-entrega", kind: "cambio", codigo: item.codigo, detail: { antes: current.get(item.product_id), ahora: item.options } }));
      await db.from("mhd_sync_events").insert(events);
      for (const item of group) summary.notable.push(...notableChanges(current.get(item.product_id)!, item.options).map((note) => `${item.codigo} · ${note}`));
    }
    if (done.length) {
      const { error } = await db.from("mhd_shopify_delivery_options").upsert(done.map((item) => ({ codigo: item.codigo, product_id: item.product_id, options: item.options, sent_at: new Date().toISOString() })));
      if (error) summary.errors.push(`Guardar lo enviado: ${error.message}`);
    }
  }
  summary.pending = changes.length - summary.checked;
  if (options.dryRun) return { dryRun: true, ...summary };
  await event(db, summary.errors.length ? "error" : "vuelta", { ...summary, errors: summary.errors.slice(0, 20), notable: summary.notable.slice(0, 50) });
  if (summary.notable.length) await sendAlert(db, { key: "opciones-entrega:cambios", quietMinutes: 24 * 60, subject: `Portes o servicios: ${summary.notable.length} cambios a revisar`, lines: ["Ya están en la web. MHD ha quitado un dato o subido un importe más de un 50 %:", ...summary.notable.slice(0, 20)] });
  if (summary.errors.length) await sendAlert(db, { key: "opciones-entrega:error", quietMinutes: 24 * 60, subject: `Opciones de entrega: ${summary.errors.length} errores al enviar a Shopify`, lines: summary.errors.slice(0, 10) });
  return { ...summary, errors: summary.errors.slice(0, 20), notable: summary.notable.slice(0, 50) };
}
