import mysql from "mysql2/promise";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { IMPORTABLE_ORDERS_SQL } from "../../../../../supabase/functions/_shared/pedido-prestashop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Mode = "all" | "references" | "retry_errors";
const maxReferences = 200;

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name}.`);
  return value;
}
async function withMysql<T>(work: (connection: mysql.Connection) => Promise<T>) {
  const connection = await mysql.createConnection({
    host: required("MYSQL_HOST"), port: Number(process.env.MYSQL_PORT ?? 3306), database: required("MYSQL_DATABASE"),
    user: required("MYSQL_USER"), password: required("MYSQL_PASSWORD"), ssl: process.env.MYSQL_SSL === "true" ? {} : undefined,
    connectTimeout: 10_000,
  });
  try { return await work(connection); } finally { await connection.end(); }
}

class InputError extends Error {}

export async function GET(request: Request) {
  const supabase = await createSupabaseClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims.sub) return Response.json({ error: "Necesitas iniciar sesión." }, { status: 401 });
  const url = new URL(request.url);
  const page = Math.max(0, Number.parseInt(url.searchParams.get("page") ?? "0", 10) || 0);
  const pageSize = 15;
  const { data, error } = await supabase.from("order_import_runs").select("*").order("created_at", { ascending: false }).range(page * pageSize, page * pageSize + pageSize);
  if (error) return Response.json({ error: "No se pudieron recuperar las ejecuciones." }, { status: 500 });
  const rows = data ?? [];
  return Response.json({ runs: rows.slice(0, pageSize), hasMore: rows.length > pageSize, page });
}

// Lista de id_order de PrestaShop que recorrerá la ejecución, de mayor a menor como la de clientes.
async function orderIds(supabase: Awaited<ReturnType<typeof createSupabaseClient>>, mode: Mode, input: Record<string, unknown>) {
  if (mode === "all") return { ids: await withMysql(async (connection) => (await connection.query<mysql.RowDataPacket[]>(IMPORTABLE_ORDERS_SQL))[0].map((row) => Number(row.id_order))), parameters: {} };
  if (mode === "references") {
    const references = [...new Set(String(input.references ?? "").split(/[\s,;]+/).map((value) => value.trim().replace(/^PS-/i, "")).filter(Boolean))];
    if (!references.length) throw new InputError("Indica al menos una referencia de pedido (p. ej. 4-5101813).");
    if (references.length > maxReferences) throw new InputError(`Como mucho ${maxReferences} pedidos a la vez.`);
    const rows = await withMysql(async (connection) => (await connection.query<mysql.RowDataPacket[]>("SELECT id_order, reference FROM ev_orders WHERE reference IN (?)", [references]))[0]);
    const missing = references.filter((reference) => !rows.some((row) => row.reference === reference));
    if (missing.length) throw new InputError(`No existen en PrestaShop: ${missing.join(", ")}.`);
    return { ids: rows.map((row) => Number(row.id_order)), parameters: { references } };
  }
  const sourceRunId = String(input.sourceRunId ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(sourceRunId)) throw new InputError("Indica la ejecución que quieres reintentar.");
  // Supabase devuelve como mucho 1.000 filas por consulta: se pide por páginas.
  const ids: number[] = [];
  for (let from = 0; ; from += 1_000) {
    const { data, error } = await supabase.from("order_import_events").select("prestashop_order_id").eq("run_id", sourceRunId).eq("outcome", "error").not("prestashop_order_id", "is", null).order("id").range(from, from + 999);
    if (error) throw error;
    ids.push(...(data ?? []).map((row) => Number(row.prestashop_order_id)));
    if ((data ?? []).length < 1_000) break;
  }
  return { ids, parameters: { sourceRunId } };
}

export async function POST(request: Request) {
  const supabase = await createSupabaseClient();
  const { data: claims } = await supabase.auth.getClaims();
  const ownerId = claims?.claims.sub;
  if (!ownerId) return Response.json({ error: "Necesitas iniciar sesión." }, { status: 401 });
  let runId: string | null = null;
  try {
    const input = await request.json() as Record<string, unknown>;
    const mode = input.mode as Mode;
    if (!["all", "references", "retry_errors"].includes(mode)) throw new InputError("Elige el alcance de la importación.");
    const { ids, parameters } = await orderIds(supabase, mode, input);
    const unique = [...new Set(ids)];
    if (!unique.length) throw new InputError(mode === "retry_errors" ? "Esta ejecución no tiene pedidos con error." : "No hay pedidos para el criterio indicado.");
    const { data: run, error: insertError } = await supabase.from("order_import_runs").insert({ owner_id: ownerId, mode, parameters, total_count: unique.length }).select("*").single();
    if (insertError || !run) throw insertError?.code === "23505" ? new InputError("Ya hay una importación de pedidos en marcha o pausada.") : insertError ?? new Error("No se pudo crear la ejecución.");
    runId = run.id;
    for (let index = 0; index < unique.length; index += 5_000) {
      const { error } = await supabase.from("order_import_queue").insert(unique.slice(index, index + 5_000).map((id) => ({ run_id: run.id, prestashop_order_id: id })));
      if (error) throw error;
    }
    const { error: enqueueError } = await supabase.rpc("enqueue_order_import", { p_run_id: run.id });
    if (enqueueError) throw enqueueError;
    await supabase.functions.invoke("sync-prestashop-orders", { body: {} });
    return Response.json({ run });
  } catch (error) {
    // Una lista a medias no debe quedarse en cola bloqueando la siguiente.
    if (runId) await supabase.rpc("set_order_import_status", { p_run_id: runId, p_status: "stopped" });
    if (error instanceof InputError) return Response.json({ error: error.message }, { status: 422 });
    console.error("Order import start failed", error);
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo iniciar la importación." }, { status: 500 });
  }
}
