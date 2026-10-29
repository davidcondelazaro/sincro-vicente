import { createClient } from "@/lib/supabase/server";

// Vueltas de sincronización para la pantalla «Sincronización con MHD» (2026-10-29), con la sesión del usuario. GET: las
// últimas 40 y, si hay una leyendo, el progreso de su lectura. POST: abre una vuelta a mano («Leer ahora y actualizar»),
// la misma que la programada (mhd_sync_cycle_start); si ya hay una en marcha, no abre otra.
export const dynamic = "force-dynamic";

async function session() {
  const db = await createClient();
  const { data } = await db.auth.getUser();
  return data.user ? db : null;
}

export async function GET() {
  const db = await session();
  if (!db) return Response.json({ error: "Sin sesión" }, { status: 401 });
  const { data: cycles, error } = await db.from("mhd_sync_cycles").select("id,trigger,status,started_at,finished_at,read_run_id,steps,error").order("started_at", { ascending: false }).limit(40);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const current = cycles?.[0];
  let reading: { done: number; total: number } | null = null;
  if (current?.status === "leyendo" && current.read_run_id) {
    const { data: run } = await db.from("mhd_catalog_import_runs").select("entity_progress").eq("id", current.read_run_id).maybeSingle();
    const progress = (run?.entity_progress as Record<string, { done?: number; total?: number }> | undefined)?.products;
    reading = { done: progress?.done ?? 0, total: progress?.total ?? 0 };
  }
  return Response.json({ cycles: cycles ?? [], reading, now: new Date().toISOString() });
}

export async function POST() {
  const db = await session();
  if (!db) return Response.json({ error: "Sin sesión" }, { status: 401 });
  const { data, error } = await db.rpc("mhd_sync_cycle_start", { p_trigger: "manual" });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data) return Response.json({ error: "Ya hay una vuelta en marcha: espera a que termine." }, { status: 409 });
  return Response.json({ ok: true, cycle: data });
}
