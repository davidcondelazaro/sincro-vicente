import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import mysql from "npm:mysql2@3.23.3/promise";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

type Row = { id_customer: number; firstname: string; lastname: string; email: string; newsletter: number; note: string | null; fecha_alta: string; total_pedidos: number; importe_total: number | string | null; cuentas: string };
type Address = { firstname: string | null; lastname: string | null; address1: string | null; address2: string | null; city: string | null; postcode: string | null; phone: string | null; dni: string | null; company: string | null; vat_number: string | null; province_name: string | null; country_code: string | null };
type Parameters = { customerId?: string; fromDate?: string; until?: string; latest?: number; maxCustomerId: number; onlyWithValidOrders?: boolean; sourceRunId?: string };
type ShopifyError = { field?: string[] | null; message: string };

// El cron arranca en el segundo 0: cortar antes del minuto 2 enlaza cada tanda con la siguiente y queda muy por debajo de los 300 s de visibilidad del mensaje.
const batchMilliseconds = 110_000;
const maxConsecutiveFailures = 5;
class TransientError extends Error {}

const province: Record<string, string> = { Baleares: "Balears", Orense: "Ourense" };
const prefix: Record<string, string> = { PT: "+351", ES: "+34", FR: "+33", IT: "+39", DE: "+49", GB: "+44", UK: "+44" };

function env(name: string) { const value = Deno.env.get(name); if (!value) throw new Error(`Falta ${name}`); return value; }
function shopifyUrl() { return `https://${env("SHOPIFY_STORE_URL").replace(/^https?:\/\//, "").replace(/\/$/, "")}/admin/api/2026-07/graphql.json`; }
async function shopify<T>(query: string, variables: Record<string, unknown>) {
  let failure = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await new Promise((resolve) => setTimeout(resolve, 1_000 * 2 ** attempt));
    let response: Response; let body: T & { errors?: { message: string; extensions?: { code?: string } }[] };
    try {
      response = await fetch(shopifyUrl(), { method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": env("SHOPIFY_ACCESS_TOKEN") }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(20_000) });
      if (response.status === 429 || response.status >= 500) { failure = `Shopify ${response.status}`; continue; }
      body = await response.json();
    } catch (error) { failure = error instanceof Error ? error.message : String(error); continue; }
    if (body.errors?.some((item) => item.extensions?.code === "THROTTLED")) { failure = "Shopify THROTTLED"; continue; }
    if (!response.ok || body.errors?.length) throw new Error(body.errors?.[0]?.message ?? `Shopify ${response.status}`);
    return body;
  }
  throw new TransientError(failure);
}

async function mysqlConnection() {
  return mysql.createConnection({ host: env("MYSQL_HOST"), port: Number(Deno.env.get("MYSQL_PORT") ?? 3306), database: env("MYSQL_DATABASE"), user: env("MYSQL_USER"), password: env("MYSQL_PASSWORD"), ssl: Deno.env.get("MYSQL_SSL") === "true" ? {} : undefined, connectTimeout: 10_000 });
}

async function idsForRun(mode: string, parameters: Parameters, cursor: number | null, remaining: number) {
  if (mode === "id") return cursor ? [] : [Number(parameters.customerId)];
  if (mode === "retry_errors") {
    let query = db.from("customer_import_events").select("prestashop_customer_id").eq("run_id", parameters.sourceRunId!).eq("outcome", "error").not("prestashop_customer_id", "is", null).order("prestashop_customer_id", { ascending: false }).limit(Math.min(25, remaining));
    if (cursor) query = query.lt("prestashop_customer_id", cursor);
    const { data, error } = await query; if (error) throw new TransientError(error.message);
    return (data ?? []).map((row) => Number(row.prestashop_customer_id));
  }
  const connection = await mysqlConnection();
  try {
    const values: (number | string)[] = [parameters.maxCustomerId];
    let where = "c.active = 1 AND c.deleted = 0 AND c.id_customer <= ?";
    if (parameters.onlyWithValidOrders) where += " AND EXISTS (SELECT 1 FROM ev_orders o WHERE o.id_customer = c.id_customer AND o.valid = 1)";
    if (cursor) { where += " AND c.id_customer < ?"; values.push(cursor); }
    if (mode === "from_date") { where += " AND c.date_add >= ? AND c.date_add <= ?"; values.push(parameters.fromDate!, parameters.until!); }
    values.push(Math.min(25, remaining));
    const [rows] = await connection.execute<mysql.RowDataPacket[]>(`SELECT c.id_customer FROM ev_customer c WHERE ${where} ORDER BY c.id_customer DESC LIMIT ?`, values);
    return rows.map((row) => Number(row.id_customer));
  } finally { await connection.end(); }
}

async function loadCustomer(id: number) {
  const connection = await mysqlConnection();
  try {
    // Varias cuentas con el mismo email son un solo cliente en Shopify: se suman sus pedidos y direcciones.
    const [customers] = await connection.execute<mysql.RowDataPacket[]>(`SELECT t.id_customer,t.firstname,t.lastname,t.email,t.note,MAX(c.newsletter) AS newsletter,MIN(c.date_add) AS fecha_alta,COUNT(DISTINCT o.id_order) AS total_pedidos,SUM(od.total_price_tax_incl) AS importe_total,GROUP_CONCAT(DISTINCT c.id_customer) AS cuentas FROM ev_customer t JOIN ev_customer c ON c.email=t.email AND c.active=1 AND c.deleted=0 LEFT JOIN ev_orders o ON c.id_customer=o.id_customer AND o.valid=1 LEFT JOIN ev_order_detail od ON o.id_order=od.id_order WHERE t.id_customer=? AND t.active=1 AND t.deleted=0 GROUP BY t.id_customer,t.firstname,t.lastname,t.email,t.note`, [id]);
    const customer = customers[0] as Row | undefined;
    if (!customer) return null;
    const [addresses] = await connection.execute<mysql.RowDataPacket[]>(`SELECT a.firstname,a.lastname,a.address1,a.address2,a.city,a.postcode,a.phone,a.dni,a.company,a.vat_number,s.name AS province_name,co.iso_code AS country_code FROM ev_address a LEFT JOIN ev_state s ON a.id_state=s.id_state LEFT JOIN ev_country co ON a.id_country=co.id_country WHERE FIND_IN_SET(a.id_customer,?) AND a.active=1 AND a.deleted=0`, [customer.cuentas]);
    return { customer, addresses: addresses as Address[] };
  } finally { await connection.end(); }
}

function phone(value: string | null) { if (!value?.trim()) return null; let normalized = [...value.trim()].filter((char, index) => /\d/.test(char) || (char === "+" && index === 0)).join(""); if (normalized.startsWith("00")) normalized = `+${normalized.slice(2)}`; const digits = normalized.replace(/^\+/, ""); return digits.length < 6 ? null : digits.length > 15 ? `${normalized.startsWith("+") ? "+" : ""}${digits.slice(0, 9)}` : normalized; }
function addressKey(row: Address) { return [row.address1, row.address2, row.city, row.postcode, row.country_code].map((value) => value?.trim().toLowerCase() ?? "").join("|"); }
function addresses(rows: Address[]) {
  const chosen = rows.filter((row) => row.country_code === "PT").length ? rows.filter((row) => row.country_code === "PT") : rows;
  let customerPhone: string | undefined;
  const unique = chosen.filter((row, index) => chosen.findIndex((other) => addressKey(other) === addressKey(row)) === index);
  const mapped = unique.map((row) => { const countryCode = row.country_code || "ES"; const raw = phone(row.phone); const number = raw && !raw.startsWith("+") ? `${prefix[countryCode] ?? ""}${raw}` : raw; customerPhone ??= number ?? undefined; return { address1: row.address1 ?? "", address2: row.address2 || undefined, city: row.city ?? "", province: province[row.province_name ?? ""] ?? row.province_name ?? "", zip: row.postcode ?? "", countryCode, firstName: row.firstname ?? "", lastName: row.lastname ?? "", phone: number ?? customerPhone, company: [row.dni, row.company].filter((value) => value?.trim()).join(" ") || undefined }; });
  return { customerPhone, addresses: mapped };
}
async function findCustomer(email: string) {
  const body = await shopify<{ data: { customerByIdentifier: { id: string; addressesV2: { nodes: { id: string }[] }; metafield: { id: string } | null } | null } }>(`query($email:String!){customerByIdentifier(identifier:{emailAddress:$email}){id addressesV2(first:1){nodes{id}} metafield(namespace:"custom",key:"historico_de_prestashop"){id}}}`, { email });
  return body.data.customerByIdentifier;
}
function historical(customer: Row) { return `Pedidos: ${Number(customer.total_pedidos ?? 0)}, Importe: ${new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(Number(customer.importe_total ?? 0))}, Fecha de alta: ${new Date(customer.fecha_alta).toLocaleDateString("es-ES")}`; }
// Lo que Shopify rechaza se quita y se vuelve a intentar: mejor el cliente sin ese dato que perderlo.
function dropRejected(input: Record<string, unknown>, errors: ShopifyError[]) {
  const addressList = input.addresses as Record<string, unknown>[] | undefined; const text = errors.map((item) => `${item.field?.join(".") ?? ""} ${item.message}`).join(" ").toLowerCase();
  if (/phone/.test(text) && input.phone) { delete input.phone; return "teléfono"; }
  if (/phone/.test(text) && addressList?.some((item) => item.phone)) { addressList.forEach((item) => delete item.phone); return "teléfono de la dirección"; }
  if (/province/.test(text) && addressList?.some((item) => item.province)) { addressList.forEach((item) => delete item.province); return "provincia"; }
  if (/address|zip|postal|country|city/.test(text) && addressList) { delete input.addresses; return "direcciones"; }
  return null;
}
async function saveMetafields(ownerId: string, customer: Row, addressRows: Address[]) {
  const vat = addressRows.map((row) => row.vat_number?.trim().toUpperCase()).find((value) => value && !value.startsWith("ES"));
  const metafields = [{ ownerId, namespace: "custom", key: "historico_de_prestashop", type: "single_line_text_field", value: historical(customer) }]; if (vat) metafields.push({ ownerId, namespace: "custom", key: "vat_number", type: "single_line_text_field", value: vat });
  const saved = await shopify<{ data: { metafieldsSet: { userErrors: ShopifyError[] } } }>(`mutation($metafields:[MetafieldsSetInput!]!){metafieldsSet(metafields:$metafields){userErrors{field message}}}`, { metafields });
  if (saved.data.metafieldsSet.userErrors.length) throw new Error(`Metacampos: ${saved.data.metafieldsSet.userErrors.map((item) => item.message).join(" ")}`);
}
async function saveCustomer(input: Record<string, unknown>) {
  const dropped: string[] = []; const operation = input.id ? "customerUpdate" : "customerCreate";
  for (;;) {
    const saved = await shopify<{ data: { result: { customer: { id: string } | null; userErrors: ShopifyError[] } } }>(`mutation($input:CustomerInput!){result:${operation}(input:$input){customer{id} userErrors{field message}}}`, { input });
    const result = saved.data.result; if (result.customer && !result.userErrors.length) return { id: result.customer.id, dropped };
    const removed = dropRejected(input, result.userErrors); if (!removed) throw new Error(result.userErrors.map((item) => item.message).join(" ") || "Shopify no guardó el cliente.");
    dropped.push(removed);
  }
}
async function createCustomer(customer: Row, addressRows: Address[]) {
  const mapped = addresses(addressRows); const input: Record<string, unknown> = { firstName: customer.firstname, lastName: customer.lastname, email: customer.email, emailMarketingConsent: { marketingState: customer.newsletter ? "SUBSCRIBED" : "NOT_SUBSCRIBED", marketingOptInLevel: "SINGLE_OPT_IN" } };
  if (mapped.addresses.length) input.addresses = mapped.addresses; if (mapped.customerPhone) input.phone = mapped.customerPhone; if (customer.note?.trim()) input.note = customer.note.trim();
  const saved = await saveCustomer(input);
  await saveMetafields(saved.id, customer, addressRows);
  return saved;
}
// Quien ya estaba en Shopify (newsletter, chat o un corte a medias) conserva lo suyo: solo se rellena lo que falte.
async function completeCustomer(found: NonNullable<Awaited<ReturnType<typeof findCustomer>>>, customer: Row, addressRows: Address[]) {
  const dropped: string[] = []; const changes: string[] = [];
  const mapped = addresses(addressRows);
  if (!found.addressesV2.nodes.length && mapped.addresses.length) { const input: Record<string, unknown> = { id: found.id, addresses: mapped.addresses }; if (mapped.customerPhone) input.phone = mapped.customerPhone; dropped.push(...(await saveCustomer(input)).dropped); changes.push("direcciones"); }
  if (!found.metafield) { await saveMetafields(found.id, customer, addressRows); changes.push("histórico"); }
  return { changes, dropped };
}
function droppedText(dropped: string[]) { return dropped.length ? ` Sin ${dropped.join(", ")}: Shopify lo rechazó.` : ""; }

async function event(runId: string, values: Record<string, unknown>) { const { error } = await db.from("customer_import_events").insert({ run_id: runId, ...values }); if (error) throw error; }
async function archive(messageId: number) { const { error } = await db.rpc("archive_customer_import_message", { p_message_id: messageId }); if (error) throw error; }

async function release(messageId: number, delaySeconds = 0) { const { error } = await db.rpc("release_customer_import_job", { p_message_id: messageId, p_delay_seconds: delaySeconds }); if (error) throw error; }

async function processMessage(message: any) {
  const messageId = Number(message.msg_id); const runId = typeof message.message?.run_id === "string" ? message.message.run_id : null; const deadline = Date.now() + batchMilliseconds;
  if (!runId) return archive(messageId);
  const { data: run } = await db.from("customer_import_runs").select("*").eq("id", runId).maybeSingle();
  if (!run || ["completed", "stopped", "failed"].includes(run.status)) return archive(messageId);
  if (run.status === "paused") return;
  await db.from("customer_import_runs").update({ status: "running", started_at: run.started_at ?? new Date().toISOString() }).eq("id", runId);
  try {
    let current = run;
    while (current.processed_count < current.total_count) {
      const { data: fresh } = await db.from("customer_import_runs").select("*").eq("id", runId).single(); current = fresh;
      if (current.status === "stopped") return archive(messageId);
      if (current.status !== "running") return;
      const ids = await idsForRun(current.mode, current.parameters as Parameters, current.cursor_customer_id, current.total_count - current.processed_count);
      if (!ids.length) break;
      for (const id of ids) {
        if (Date.now() > deadline) return release(messageId);
        const { data: control } = await db.from("customer_import_runs").select("status").eq("id", runId).single();
        if (control?.status === "stopped") return archive(messageId);
        if (control?.status !== "running") return;
        const loaded = await loadCustomer(id); let outcome = "error"; let shopifyId: string | null = null; let messageText = ""; let email: string | null = null;
        try {
          if (!loaded) throw new Error("Cliente no activo o eliminado en PrestaShop.");
          email = loaded.customer.email; const found = await findCustomer(email);
          if (found) { shopifyId = found.id; const { changes, dropped } = await completeCustomer(found, loaded.customer, loaded.addresses); outcome = "existing"; messageText = `El cliente ya existe en Shopify.${changes.length ? ` Añadido: ${changes.join(", ")}.` : ""}${droppedText(dropped)}`; }
          else { const saved = await createCustomer(loaded.customer, loaded.addresses); shopifyId = saved.id; outcome = "created"; messageText = `Cliente creado en Shopify.${droppedText(saved.dropped)}`; }
        } catch (error) { if (error instanceof TransientError) throw error; messageText = error instanceof Error ? error.message : String(error); }
        const counts = { processed_count: current.processed_count + 1, cursor_customer_id: id, created_count: current.created_count + (outcome === "created" ? 1 : 0), existing_count: current.existing_count + (outcome === "existing" ? 1 : 0), error_count: current.error_count + (outcome === "error" ? 1 : 0), consecutive_failures: 0, updated_at: new Date().toISOString() };
        const { error: countsError } = await db.from("customer_import_runs").update(counts).eq("id", runId); if (countsError) throw countsError;
        await event(runId, { level: outcome === "created" ? "success" : outcome === "existing" ? "warning" : "error", outcome, prestashop_customer_id: id, customer_email: email, shopify_customer_id: shopifyId, message: messageText }); current = { ...current, ...counts };
      }
    }
    await db.from("customer_import_runs").update({ status: "completed", finished_at: new Date().toISOString() }).eq("id", runId); await event(runId, { level: "info", outcome: "status", message: "Importación completada." }); await archive(messageId);
  } catch (error) {
    // El cursor no ha avanzado: nadie se pierde. Tras varios fallos seguidos se pausa para poder reanudar a mano.
    const text = error instanceof Error ? error.message : String(error);
    const { data: latest } = await db.from("customer_import_runs").select("consecutive_failures").eq("id", runId).single(); const failures = Number(latest?.consecutive_failures ?? 0) + 1;
    if (failures >= maxConsecutiveFailures) { await db.from("customer_import_runs").update({ status: "paused", consecutive_failures: 0 }).eq("id", runId); await event(runId, { level: "error", outcome: "status", message: `Importación pausada tras ${failures} fallos seguidos: ${text}` }); }
    else { await db.from("customer_import_runs").update({ status: "queued", consecutive_failures: failures }).eq("id", runId); await event(runId, { level: "warning", outcome: "status", message: `Reintento ${failures}: ${text}` }); await release(messageId, 60 * failures); }
  }
}

Deno.serve(async (request) => { if (request.method !== "POST") return json({ error: "Método no permitido" }, 405); const { data, error } = await db.rpc("read_customer_import_message"); if (error) return json({ error: error.message }, 500); if (!data) return json({ accepted: false, empty: true }); EdgeRuntime.waitUntil(processMessage(data)); return json({ accepted: true, runId: data.message?.run_id ?? null }, 202); });
