import mysql from "mysql2/promise";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Mode = "id" | "from_date" | "latest";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name}.`);
  return value;
}

async function countCustomers(mode: Mode, parameters: Record<string, unknown>) {
  const connection = await mysql.createConnection({
    host: required("MYSQL_HOST"), port: Number(process.env.MYSQL_PORT ?? 3306), database: required("MYSQL_DATABASE"),
    user: required("MYSQL_USER"), password: required("MYSQL_PASSWORD"), ssl: process.env.MYSQL_SSL === "true" ? {} : undefined,
    connectTimeout: 10_000,
  });
  try {
    if (mode === "id") {
      const [rows] = await connection.execute<mysql.RowDataPacket[]>(
        "SELECT COUNT(*) AS total, MAX(id_customer) AS max_id FROM ev_customer WHERE id_customer = ? AND active = 1 AND deleted = 0",
        [String(parameters.customerId)],
      );
      return { total: Number(rows[0].total), maxId: Number(rows[0].max_id ?? 0) };
    }
    if (mode === "from_date") {
      const [rows] = await connection.execute<mysql.RowDataPacket[]>(
        "SELECT COUNT(*) AS total, MAX(id_customer) AS max_id FROM ev_customer c WHERE active = 1 AND deleted = 0 AND date_add >= ? AND date_add < ? AND EXISTS (SELECT 1 FROM ev_orders o WHERE o.id_customer = c.id_customer AND o.valid = 1)",
        [String(parameters.fromDate), String(parameters.until)],
      );
      return { total: Number(rows[0].total), maxId: Number(rows[0].max_id ?? 0) };
    }
    const [rows] = await connection.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS total, MAX(id_customer) AS max_id FROM ev_customer c WHERE active = 1 AND deleted = 0 AND EXISTS (SELECT 1 FROM ev_orders o WHERE o.id_customer = c.id_customer AND o.valid = 1)",
    );
    return { total: Math.min(Number(rows[0].total), Number(parameters.latest)), maxId: Number(rows[0].max_id ?? 0) };
  } finally {
    await connection.end();
  }
}

function validInput(input: Record<string, unknown>) {
  const mode = input.mode;
  if (mode === "id") {
    const customerId = String(input.customerId ?? "");
    if (!/^\d+$/.test(customerId)) throw new Error("Indica un ID numérico de PrestaShop.");
    return { mode, parameters: { customerId } } as const;
  }
  if (mode === "from_date") {
    const fromDate = String(input.fromDate ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) throw new Error("Indica una fecha de inicio válida.");
    return { mode, parameters: { fromDate: `${fromDate} 00:00:00`, until: new Date().toISOString().slice(0, 19).replace("T", " ") } } as const;
  }
  if (mode === "latest") {
    const latest = Number(input.latest);
    if (!Number.isInteger(latest) || latest < 1 || latest > 100_000) throw new Error("Indica entre 1 y 100.000 clientes.");
    return { mode, parameters: { latest } } as const;
  }
  throw new Error("Elige el alcance de la importación.");
}

export async function GET() {
  const supabase = await createSupabaseClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims.sub) return Response.json({ error: "Necesitas iniciar sesión." }, { status: 401 });
  const { data, error } = await supabase.from("customer_import_runs").select("*").order("created_at", { ascending: false }).limit(30);
  if (error) return Response.json({ error: "No se pudo recuperar la ejecución." }, { status: 500 });
  return Response.json({ runs: data ?? [] });
}

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseClient();
    const { data: claims } = await supabase.auth.getClaims();
    const ownerId = claims?.claims.sub;
    if (!ownerId) return Response.json({ error: "Necesitas iniciar sesión." }, { status: 401 });
    const { mode, parameters } = validInput(await request.json() as Record<string, unknown>);
    const count = await countCustomers(mode, parameters);
    if (!count.total) return Response.json({ error: "No hay clientes activos para el criterio indicado." }, { status: 422 });
    const { data: run, error: insertError } = await supabase.from("customer_import_runs").insert({
      owner_id: ownerId, mode, parameters: { ...parameters, maxCustomerId: count.maxId }, total_count: count.total,
    }).select("*").single();
    if (insertError || !run) throw insertError ?? new Error("No se pudo crear la ejecución.");
    const { error: enqueueError } = await supabase.rpc("enqueue_customer_import", { p_run_id: run.id });
    if (enqueueError) throw enqueueError;
    await supabase.functions.invoke("sync-prestashop-customers", { body: {} });
    return Response.json({ run });
  } catch (error) {
    console.error("Bulk import start failed", error);
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo iniciar la importación." }, { status: 500 });
  }
}
