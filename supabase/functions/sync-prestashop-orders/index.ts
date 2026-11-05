import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import mysql from "npm:mysql2@3.23.3/promise";
import { assertSilent, buildOrder, cleanEmail, loadOrder } from "../_shared/pedido-prestashop.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
type ShopifyError = { field?: string[] | null; message: string; code?: string };

// Igual que la de clientes: tandas de menos de 2 minutos enlazadas por el cron, muy por debajo de los 300 s de visibilidad del mensaje.
const batchMilliseconds = 110_000;
const maxConsecutiveFailures = 5;
// El reclamo de la ejecución dura más que una tanda y menos que la visibilidad del mensaje (300 s).
const leaseSeconds = 240;
// Tiendas de desarrollo o en prueba: Shopify solo deja crear 5 pedidos por minuto y responde «Too many attempts».
const devStoreOrderInterval = 12_500;
class TransientError extends Error {}
// orderCreate rechazado por el límite de pedidos por minuto: el pedido no se ha creado y se puede repetir.
class RateLimitedError extends Error {}

function env(name: string) { const value = Deno.env.get(name); if (!value) throw new Error(`Falta ${name}`); return value; }
function shopifyUrl() { return `https://${env("SHOPIFY_STORE_URL").replace(/^https?:\/\//, "").replace(/\/$/, "")}/admin/api/2026-10/graphql.json`; }
// `retry: false` para orderCreate: si la respuesta se pierde, repetir podría duplicar el pedido. El siguiente intento lo busca antes por nombre.
async function shopify<T>(query: string, variables: Record<string, unknown>, retry = true) {
  let failure = "";
  for (let attempt = 0; attempt < (retry ? 4 : 1); attempt++) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 1_000 * 2 ** attempt));
    let response: Response; let body: T & { errors?: { message: string; extensions?: { code?: string } }[] };
    try {
      response = await fetch(shopifyUrl(), { method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": env("SHOPIFY_ACCESS_TOKEN") }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(30_000) });
      if (response.status === 429 || response.status >= 500) { failure = `Shopify ${response.status}`; continue; }
      body = await response.json();
    } catch (error) { failure = error instanceof Error ? error.message : String(error); continue; }
    if (body.errors?.some((item) => item.extensions?.code === "THROTTLED")) { failure = "Shopify THROTTLED"; continue; }
    if (body.errors?.some((item) => /too many attempts/i.test(item.message))) throw new RateLimitedError(body.errors[0].message);
    if (!response.ok || body.errors?.length) throw new Error(body.errors?.[0]?.message ?? `Shopify ${response.status}`);
    return body;
  }
  throw new TransientError(failure);
}

async function mysqlConnection() {
  return mysql.createConnection({ host: env("MYSQL_HOST"), port: Number(Deno.env.get("MYSQL_PORT") ?? 3306), database: env("MYSQL_DATABASE"), user: env("MYSQL_USER"), password: env("MYSQL_PASSWORD"), ssl: Deno.env.get("MYSQL_SSL") === "true" ? {} : undefined, connectTimeout: 10_000, dateStrings: true });
}

async function idsForRun(runId: string, cursor: number | null, remaining: number) {
  let query = db.from("order_import_queue").select("prestashop_order_id").eq("run_id", runId).order("prestashop_order_id", { ascending: false }).limit(Math.min(25, remaining));
  if (cursor) query = query.lt("prestashop_order_id", cursor);
  const { data, error } = await query; if (error) throw new TransientError(error.message);
  return (data ?? []).map((row) => Number(row.prestashop_order_id));
}

async function findOrder(name: string) {
  const body = await shopify<{ data: { orders: { nodes: { id: string }[] } } }>(`query($q:String!){orders(first:1,query:$q){nodes{id}}}`, { q: `name:"${name}"` });
  return body.data.orders.nodes[0]?.id ?? null;
}
// La búsqueda de Shopify tarda unos segundos en ver un pedido recién creado; nuestro registro lo ve al instante.
async function alreadyCreated(id: number) {
  const { data, error } = await db.from("order_import_events").select("shopify_order_id").eq("prestashop_order_id", id).eq("outcome", "created").not("shopify_order_id", "is", null).limit(1);
  if (error) throw new TransientError(error.message);
  return data?.[0]?.shopify_order_id as string | undefined ?? null;
}
async function isDevelopmentStore() {
  const body = await shopify<{ data: { shop: { plan: { partnerDevelopment: boolean; publicDisplayName: string } } } }>(`{shop{plan{partnerDevelopment publicDisplayName}}}`, {});
  const plan = body.data.shop.plan;
  return plan.partnerDevelopment || /trial|prueba|development|desarrollo/i.test(plan.publicDisplayName);
}
async function findCustomer(email: string) {
  const body = await shopify<{ data: { customerByIdentifier: { id: string } | null } }>(`query($email:String!){customerByIdentifier(identifier:{emailAddress:$email}){id}}`, { email });
  return body.data.customerByIdentifier?.id ?? null;
}

type Outcome = { outcome: "created" | "existing" | "error"; reference: string | null; shopifyId: string | null; message: string; warned: boolean };
type Pacer = { beforeCreate: () => Promise<boolean> };
async function importOrder(connection: mysql.Connection, id: number, pacer: Pacer): Promise<Outcome | null> {
  const q = async (sql: string, values: unknown[] = []) => (await connection.query(sql, values))[0] as Record<string, any>[];
  const data = await loadOrder(q, { id });
  if (!data) return { outcome: "error", reference: null, shopifyId: null, message: "El pedido no existe en PrestaShop.", warned: false };
  const reference = data.order.reference as string;
  const recorded = await alreadyCreated(id);
  if (recorded) return { outcome: "existing", reference, shopifyId: recorded, message: "El pedido ya se había creado en una ejecución anterior.", warned: false };
  const existing = await findOrder(`PS-${reference}`);
  if (existing) return { outcome: "existing", reference, shopifyId: existing, message: "El pedido ya estaba en Shopify.", warned: false };
  // Sin su cliente el pedido quedaría suelto: se deja como error para reintentarlo cuando el cliente exista.
  const customerId = await findCustomer(cleanEmail(data.order.email));
  if (!customerId) return { outcome: "error", reference, shopifyId: null, message: `El cliente ${data.order.email} no existe en Shopify.`, warned: false };
  const { input, options, warnings } = buildOrder(data, customerId);
  assertSilent(input, options);
  // Sin tiempo para esperar el siguiente hueco: se deja el pedido para la próxima tanda sin marcarlo.
  if (!await pacer.beforeCreate()) return null;
  const body = await shopify<{ data: { orderCreate: { order: { id: string } | null; userErrors: ShopifyError[] } } }>(`mutation($order:OrderCreateOrderInput!,$options:OrderCreateOptionsInput){orderCreate(order:$order,options:$options){order{id} userErrors{field message code}}}`, { order: input, options }, false);
  const result = body.data.orderCreate;
  if (!result.order || result.userErrors.length) return { outcome: "error", reference, shopifyId: null, message: result.userErrors.map((item) => `${item.field?.join(".") ?? ""} ${item.message}`.trim()).join(" · ") || "Shopify no creó el pedido.", warned: false };
  return { outcome: "created", reference, shopifyId: result.order.id, message: `Pedido creado en Shopify.${warnings.length ? ` Avisos: ${warnings.join(" ")}` : ""}`, warned: warnings.length > 0 };
}

async function event(runId: string, values: Record<string, unknown>) { const { error } = await db.from("order_import_events").insert({ run_id: runId, ...values }); if (error) throw error; }
async function archive(messageId: number) { const { error } = await db.rpc("archive_order_import_message", { p_message_id: messageId }); if (error) throw error; }
async function release(messageId: number, delaySeconds = 0) { const { error } = await db.rpc("release_order_import_job", { p_message_id: messageId, p_delay_seconds: delaySeconds }); if (error) throw error; }

async function processMessage(message: any) {
  const messageId = Number(message.msg_id); const runId = typeof message.message?.run_id === "string" ? message.message.run_id : null; const deadline = Date.now() + batchMilliseconds;
  if (!runId) return archive(messageId);
  const { data: run } = await db.from("order_import_runs").select("*").eq("id", runId).maybeSingle();
  if (!run || ["completed", "stopped", "failed"].includes(run.status)) return archive(messageId);
  if (run.status === "paused") return;
  // Un solo trabajador por ejecución. Un mensaje que no es el de la ejecución y no consigue el reclamo es un duplicado.
  const { data: claimed, error: claimError } = await db.rpc("claim_order_import_run", { p_run_id: runId, p_message_id: messageId, p_seconds: leaseSeconds });
  if (claimError) throw claimError;
  if (!claimed) {
    if (run.queue_message_id && Number(run.queue_message_id) !== messageId) { await event(runId, { level: "warning", outcome: "status", message: `Mensaje duplicado ${messageId} descartado: la ejecución ya tiene su trabajador.` }); return archive(messageId); }
    return;
  }
  await db.from("order_import_runs").update({ status: "running", started_at: run.started_at ?? new Date().toISOString() }).eq("id", runId);
  let connection: mysql.Connection | null = null;
  try {
    // Ritmo de creación: en tienda de desarrollo, un pedido cada 12,5 s; ante «Too many attempts», esperar y repetir el mismo pedido.
    const interval = await isDevelopmentStore() ? devStoreOrderInterval : 0;
    let lastCreate = 0;
    const wait = async (milliseconds: number) => { if (Date.now() + milliseconds > deadline) return false; await new Promise((resolve) => setTimeout(resolve, milliseconds)); return true; };
    const pacer: Pacer = { beforeCreate: async () => { const pending = lastCreate + interval - Date.now(); if (pending > 0 && !await wait(pending)) return false; lastCreate = Date.now(); return true; } };
    let current = run;
    while (current.processed_count < current.total_count) {
      const { data: fresh } = await db.from("order_import_runs").select("*").eq("id", runId).single(); current = fresh;
      if (current.status === "stopped") return archive(messageId);
      if (current.status !== "running") return;
      const ids = await idsForRun(runId, current.cursor_order_id, current.total_count - current.processed_count);
      if (!ids.length) break;
      connection ??= await mysqlConnection().catch((error) => { throw new TransientError(`MySQL: ${error.message}`); });
      for (const id of ids) {
        if (Date.now() > deadline) return release(messageId);
        const { data: control } = await db.from("order_import_runs").select("status").eq("id", runId).single();
        if (control?.status === "stopped") return archive(messageId);
        if (control?.status !== "running") return;
        let result: Outcome | null = null;
        for (;;) {
          try { result = await importOrder(connection, id, pacer); break; }
          catch (error) {
            if (error instanceof RateLimitedError) { lastCreate = Date.now(); if (await wait(20_000)) continue; break; }
            if (error instanceof TransientError) throw error;
            // Un fallo de MySQL a media tanda no es culpa del pedido: se reintenta la tanda con una conexión nueva.
            if (/ECONN|PROTOCOL_CONNECTION_LOST|ETIMEDOUT|closed state/i.test(String((error as Error)?.message ?? error))) throw new TransientError(String((error as Error).message));
            result = { outcome: "error", reference: null, shopifyId: null, message: error instanceof Error ? error.message : String(error), warned: false }; break;
          }
        }
        // Sin resultado: no dio tiempo a crearlo en esta tanda. El cursor no avanza y la siguiente tanda empieza por él.
        if (!result) return release(messageId);
        const counts = { processed_count: current.processed_count + 1, cursor_order_id: id, created_count: current.created_count + (result.outcome === "created" ? 1 : 0), existing_count: current.existing_count + (result.outcome === "existing" ? 1 : 0), error_count: current.error_count + (result.outcome === "error" ? 1 : 0), warning_count: current.warning_count + (result.warned ? 1 : 0), consecutive_failures: 0, updated_at: new Date().toISOString() };
        const { error: countsError } = await db.from("order_import_runs").update(counts).eq("id", runId); if (countsError) throw countsError;
        await event(runId, { level: result.outcome === "error" ? "error" : result.warned || result.outcome === "existing" ? "warning" : "success", outcome: result.outcome, prestashop_order_id: id, order_reference: result.reference, shopify_order_id: result.shopifyId, message: result.message }); current = { ...current, ...counts };
      }
    }
    await db.from("order_import_runs").update({ status: "completed", finished_at: new Date().toISOString() }).eq("id", runId); await event(runId, { level: "info", outcome: "status", message: "Importación completada." }); await archive(messageId);
  } catch (error) {
    // El cursor no ha avanzado: ningún pedido se pierde. Tras varios fallos seguidos se pausa para poder reanudar a mano.
    const text = error instanceof Error ? error.message : String(error);
    const { data: latest } = await db.from("order_import_runs").select("consecutive_failures").eq("id", runId).single(); const failures = Number(latest?.consecutive_failures ?? 0) + 1;
    if (failures >= maxConsecutiveFailures) { await db.from("order_import_runs").update({ status: "paused", consecutive_failures: 0 }).eq("id", runId); await event(runId, { level: "error", outcome: "status", message: `Importación pausada tras ${failures} fallos seguidos: ${text}` }); }
    else { await db.from("order_import_runs").update({ status: "queued", consecutive_failures: failures }).eq("id", runId); await event(runId, { level: "warning", outcome: "status", message: `Reintento ${failures}: ${text}` }); await release(messageId, 60 * failures); }
  } finally {
    await connection?.end().catch(() => undefined);
    await db.rpc("release_order_import_run", { p_run_id: runId, p_message_id: messageId });
  }
}

Deno.serve(async (request) => { if (request.method !== "POST") return json({ error: "Método no permitido" }, 405); const { data, error } = await db.rpc("read_order_import_message"); if (error) return json({ error: error.message }, 500); if (!data) return json({ accepted: false, empty: true }); EdgeRuntime.waitUntil(processMessage(data)); return json({ accepted: true, runId: data.message?.run_id ?? null }, 202); });
