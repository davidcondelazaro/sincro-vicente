import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";
import { errorResponse, importerSession, sourcesConfig } from "@/lib/mhd-importer/server";
import { refreshShopifyMirror } from "@/lib/shopify-mirror";

// Procesos del importador (docs/IMPORTADOR_PRODUCTOS_MHD.md): tandas de productos que procesa el trabajador en
// producción. GET sin parámetros: las tandas con su avance y el estado del trabajador. GET ?job=<id>: el avance, el
// tiempo medio de cada paso, los productos y el registro (filtros: level, step, codigo; `since` = id del último hecho
// recibido, para ir añadiendo). POST { action: "crear", title, families | codes | bench, workers, concurrency, skipDone, upload }
// encola una tanda (y pide a Supabase las fichas de MHD que falten); { action: "pausar" | "reanudar" | "cancelar" |
// "reintentar", job } la gobierna; { action: "espejo" } refresca el espejo de la tienda de Shopify.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const EVENTS_PAGE = 300;

export async function GET(request: Request) {
  const session = await importerSession();
  if (!session) return Response.json({ error: "Necesitas iniciar sesión." }, { status: 401 });
  const params = new URL(request.url).searchParams; const job = params.get("job");
  try {
    if (!job) {
      const [{ data: jobs, error }, { data: worker, error: workerError }] = await Promise.all([
        session.db.from("mhd_importer_job_progress").select("*").order("created_at", { ascending: false }).limit(30),
        session.db.from("mhd_importer_worker_slots").select("slot,lease_until,heartbeat_at").order("slot"),
      ]);
      if (error) throw error;
      if (workerError) throw workerError;
      const { data: mirror } = await session.db.from("shopify_mirror_runs").select("status,started_at,finished_at,products,variants,collections,error").order("started_at", { ascending: false }).limit(1).maybeSingle();
      return Response.json({ jobs, workers: worker, mirror });
    }
    let events = session.db.from("mhd_importer_events").select("id,item_id,codigo,level,step,message,duration_ms,data,created_at").eq("job_id", job).order("id", { ascending: false }).limit(EVENTS_PAGE);
    if (params.get("since")) events = events.gt("id", Number(params.get("since")));
    if (params.get("level")) events = events.eq("level", params.get("level")!);
    if (params.get("step")) events = events.eq("step", params.get("step")!);
    if (params.get("codigo")) events = events.eq("codigo", params.get("codigo")!);
    let items = session.db.from("mhd_importer_job_items").select("id,codigo,family_code,status,step,attempts,started_at,finished_at,duration_ms,cost_usd,run_id,error").eq("job_id", job).order("id").limit(3000);
    if (params.get("itemStatus")) items = items.eq("status", params.get("itemStatus")!);
    const [progress, stats, itemsResult, eventsResult] = await Promise.all([
      session.db.from("mhd_importer_job_progress").select("*").eq("id", job).maybeSingle(),
      session.db.from("mhd_importer_step_stats").select("step,veces,media_ms,max_ms,errores").eq("job_id", job),
      items, events,
    ]);
    for (const result of [progress, stats, itemsResult, eventsResult]) if (result.error) throw result.error;
    return Response.json({ job: progress.data, steps: stats.data, items: itemsResult.data, events: eventsResult.data });
  } catch (caught) { return errorResponse(caught, "No se pudieron leer los procesos."); }
}

export async function POST(request: Request) {
  const session = await importerSession();
  if (!session) return Response.json({ error: "Necesitas iniciar sesión." }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { action?: string; job?: string; title?: string; families?: string[]; codes?: string[]; bench?: boolean; workers?: number; concurrency?: number; skipDone?: boolean; upload?: boolean };
  try {
    if (body.action === "espejo") {
      // Se refresca después de contestar: tarda de segundos a pocos minutos.
      const { workerClient } = await import("@/lib/mhd-importer/jobs");
      const db = workerClient(process.env);
      after(async () => { await refreshShopifyMirror(db, sourcesConfig().shopify).catch((caught: Error) => console.error(JSON.stringify({ shopifyMirror: "error", error: caught.message }))); });
      return Response.json({ ok: true });
    }
    if (body.action === "crear") {
      // Productos de la tanda: los del banco, una lista de códigos o los de unas familias (presentes en MHD).
      let codes: { codigo: string; family_code: string | null }[] = [];
      if (body.bench) {
        const { data, error } = await session.db.from("mhd_importer_bench_items").select("codigo,family_code");
        if (error) throw error;
        codes = data;
      } else if (body.codes?.length) {
        codes = [...new Set(body.codes.map((code) => code.trim()).filter(Boolean))].map((codigo) => ({ codigo, family_code: null }));
      } else if (body.families?.length) {
        for (let from = 0; ; from += 1000) {
          const { data, error } = await session.db.from("mhd_catalog_products").select("codigo,cod_familia").in("cod_familia", body.families).eq("presence_status", "present").order("codigo").range(from, from + 999);
          if (error) throw error;
          codes.push(...data.map((row) => ({ codigo: row.codigo, family_code: row.cod_familia })));
          if (data.length < 1000) break;
        }
      }
      // «Solo los que faltan»: fuera los que ya tienen una prueba correcta.
      if (body.skipDone && codes.length) {
        const done = new Set<string>();
        for (let i = 0; i < codes.length; i += 500) {
          const { data, error } = await session.db.from("mhd_importer_product_runs").select("codigo").eq("status", "ok").in("codigo", codes.slice(i, i + 500).map((item) => item.codigo));
          if (error) throw error;
          for (const row of data) done.add(row.codigo);
        }
        codes = codes.filter((item) => !done.has(item.codigo));
      }
      if (!codes.length) return Response.json({ error: "La tanda no tiene productos." }, { status: 400 });
      const title = body.title?.trim() || (body.bench ? "Banco de prueba" : body.families?.length ? `Familias ${body.families.join(", ")}` : `${codes.length} productos`);
      const { data: job, error } = await session.db.from("mhd_importer_jobs").insert({ title, created_by: session.email, options: { families: body.families ?? null, bench: Boolean(body.bench), codes: body.codes?.length ?? 0, workers: Math.min(6, Math.max(1, Number(body.workers ?? 2))), concurrency: Math.min(12, Math.max(1, Number(body.concurrency ?? 6))), skipDone: Boolean(body.skipDone), upload: Boolean(body.upload) } }).select("id").single();
      if (error) throw error;
      for (let i = 0; i < codes.length; i += 500) {
        const { error: itemsError } = await session.db.from("mhd_importer_job_items").insert(codes.slice(i, i + 500).map((item) => ({ job_id: job.id, codigo: item.codigo, family_code: item.family_code })));
        if (itemsError) throw itemsError;
      }
      // Fichas de MHD que faltan: las trae Supabase (MHD no contesta desde Vercel). Mientras, esos productos esperan.
      // Las fichas solo las lee el rol de servicio.
      const { workerClient } = await import("@/lib/mhd-importer/jobs");
      const missing = await missingDetails(workerClient(process.env), codes.map((item) => item.codigo));
      let detailsNote: string | null = null;
      if (missing.length) {
        const { error: detailsError } = await session.db.rpc("mhd_import_start_codes", { p_codes: missing });
        detailsNote = detailsError ? `Faltan ${missing.length} fichas de MHD y no se pudieron pedir: ${detailsError.message}` : `Se están trayendo ${missing.length} fichas de MHD que faltaban; esos productos esperan a tenerla.`;
      }
      await wakeWorker(request);
      return Response.json({ ok: true, job: job.id, items: codes.length, note: detailsNote });
    }
    if (!body.job) return Response.json({ error: "Falta la tanda." }, { status: 400 });
    if (body.action === "pausar" || body.action === "cancelar") {
      const { error } = await session.db.from("mhd_importer_jobs").update({ status: body.action === "pausar" ? "pausado" : "cancelado", ...(body.action === "cancelar" ? { finished_at: new Date().toISOString() } : {}) }).eq("id", body.job).in("status", ["en_cola", "en_curso", "pausado"]);
      if (error) throw error;
      return Response.json({ ok: true });
    }
    if (body.action === "reanudar" || body.action === "reintentar") {
      if (body.action === "reintentar") {
        const { error } = await session.db.from("mhd_importer_job_items").update({ status: "pendiente", attempts: 0, error: null, finished_at: null }).eq("job_id", body.job).eq("status", "error");
        if (error) throw error;
      }
      const { error } = await session.db.from("mhd_importer_jobs").update({ status: "en_curso", finished_at: null }).eq("id", body.job);
      if (error) throw error;
      await wakeWorker(request);
      return Response.json({ ok: true });
    }
    return Response.json({ error: "Acción no válida." }, { status: 400 });
  } catch (caught) { return errorResponse(caught, "No se pudo completar la acción."); }
}

async function missingDetails(db: SupabaseClient, codes: string[]) {
  const have = new Set<string>();
  for (let i = 0; i < codes.length; i += 500) {
    const { data, error } = await db.from("mhd_catalog_product_details").select("codigo").in("codigo", codes.slice(i, i + 500)).or("source_payload.not.is.null,last_error.not.is.null");
    if (error) throw error;
    for (const row of data) have.add(row.codigo);
  }
  return codes.filter((code) => !have.has(code));
}

// Despierta al trabajador sin esperarle (contesta al momento y trabaja después).
async function wakeWorker(request: Request) {
  await fetch(new URL("/api/importador-productos/trabajos/trabajador", request.url), { method: "POST", signal: AbortSignal.timeout(5_000) }).catch(() => undefined);
}
