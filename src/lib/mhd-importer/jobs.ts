// Trabajador de los procesos del importador (2026-10-26): coge productos de la cola (mhd_importer_job_items), los
// procesa como la prueba de producto y deja en mhd_importer_events cada paso con su duración, las decisiones, los
// avisos y los errores. Lo llama la ruta /api/importador-productos/trabajos/trabajador, que se vuelve a llamar sola
// mientras quede trabajo; un vigilante de pg_cron la despierta si se para. Ver docs/IMPORTADOR_PRODUCTOS_MHD.md.
import Anthropic from "@anthropic-ai/sdk";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { anthropicKey, ELVI_MODELS, PROCESSOR_MODEL } from "./ai";
import type { SourcesConfig } from "./gather";
import { pruneOlderRunMedia, saveRunMedia } from "./media-store";
import { createShopifyDraft } from "./shopify-draft";
import { processProduct } from "./processor";
import { createTrace, type TraceEvent } from "./trace";
import { warningKind } from "./warning-kinds";
import { sendAlert } from "./alerts";

type Env = Record<string, string | undefined>;
export type JobItem = { id: number; job_id: string; codigo: string; family_code: string | null; attempts: number };

// Una llamada dura como mucho 300 s en Vercel: no se reservan productos nuevos pasados 150 s (un producto tarda hasta
// ~2 min), y el puesto caduca a los 120 s sin latido por si la llamada muere. Por defecto, 2 trabajadores con 6
// productos a la vez cada uno; cada tanda lo cambia (options.workers, hasta 12, y options.concurrency, hasta 12).
export const WORKER = { budgetMs: 150_000, leaseSeconds: 120, itemLeaseSeconds: 600, workers: 2, concurrency: 6, maxAttempts: 2, mirrorMaxAgeHours: 6 };

// Cliente con la clave secreta: el trabajador no tiene sesión de usuario. Vale la clave nueva (SUPABASE_SECRET_KEY) o
// la antigua (SUPABASE_SERVICE_ROLE_KEY).
export function workerClient(env: Env): SupabaseClient {
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL; const key = env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Falta SUPABASE_SECRET_KEY (o SUPABASE_SERVICE_ROLE_KEY) en el entorno del trabajador.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// Registro de un producto: se guarda por tandas para no hacer una escritura por hecho.
function itemLog(db: SupabaseClient, item: JobItem) {
  const pending: TraceEvent[] = [];
  const flush = async () => {
    if (!pending.length) return;
    // Tipo fijo (warning-kinds.ts) en todo lo que no es un paso normal: para el resumen de la tanda.
    const rows = pending.splice(0).map((event) => ({ job_id: item.job_id, item_id: item.id, codigo: item.codigo, level: event.level, step: event.step, message: event.message.slice(0, 4000), duration_ms: event.durationMs ?? null,
      data: event.level === "info" && event.durationMs !== undefined && event.step !== "Producto" ? event.data ?? null : { ...(event.data ?? {}), tipo: event.level === "info" ? null : warningKind(event.message) } }));
    const { error } = await db.from("mhd_importer_events").insert(rows);
    if (error) console.error(JSON.stringify({ productImporterWorker: "registro", error: error.message }));
  };
  // En directo: el paso que está en marcha se apunta en el producto al empezar, y lo registrado se guarda al acabar
  // cada paso (no al acabar el producto).
  const trace = createTrace((event) => {
    pending.push(event);
    if (event.durationMs !== undefined || pending.length >= 20) void flush();
  }, (step) => void db.from("mhd_importer_job_items").update({ step }).eq("id", item.id).eq("status", "en_curso").then(() => undefined));
  return { trace, flush, add: (event: TraceEvent) => pending.push(event) };
}

const familyCache = new Map<string, Promise<{ profileRow: { profile: unknown; status: string } | null; family: { cod_subfamilia: string | null; codigo_ean: string | null }[] }>>();
function familyData(db: SupabaseClient, family: string) {
  if (!familyCache.has(family)) familyCache.set(family, (async () => {
    const [{ data: profileRow, error: profileError }, { data: family_, error: familyError }] = await Promise.all([
      db.from("mhd_importer_family_profiles").select("profile,status").eq("family_code", family).maybeSingle(),
      db.rpc("mhd_importer_family_listing", { p_family_code: family }),
    ]);
    if (profileError) throw profileError;
    if (familyError) throw familyError;
    return { profileRow, family: (family_ ?? []) as { cod_subfamilia: string | null; codigo_ean: string | null }[] };
  })().catch((caught) => { familyCache.delete(family); throw caught; }));
  return familyCache.get(family)!;
}

export async function processJobItem(deps: { db: SupabaseClient; config: SourcesConfig; ai: Anthropic; upload?: boolean | "nuevos" | "solo"; elviModel?: string; noThinking?: boolean }, item: JobItem) {
  const started = Date.now(); const log = itemLog(deps.db, item);
  try {
    // Tanda «solo subir» (2026-10-27): la última prueba correcta del producto se sube a Shopify sin volver a procesarla
    // (sin IA). Es la subida masiva, y sirve para medir cuánto tarda cada producto y cuánto paralelismo aguanta Shopify.
    if (deps.upload === "solo") {
      const { data: run, error: runError } = await deps.db.from("mhd_importer_product_runs").select("id,blocked:result->contentBlocked").eq("codigo", item.codigo).eq("status", "ok").order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (runError) throw runError;
      if (!run) throw new Error(`El producto ${item.codigo} no tiene ninguna prueba correcta: hay que procesarlo antes.`);
      // Lo que el procesado dejó sin publicar no es un fallo de la subida (David, 2026-10-27): va a descartados, no a
      // errores, para que los errores sean solo los de Shopify.
      if (run.blocked === true) {
        await deps.db.from("mhd_importer_job_items").update({ status: "descartado", finished_at: new Date().toISOString(), duration_ms: Date.now() - started, cost_usd: 0, run_id: run.id, error: "Bloqueada en el procesado (afirmaciones sin respaldo): no se sube hasta rehacer el texto.", lease_until: null, step: null }).eq("id", item.id);
        return;
      }
      const draft = await log.trace.step("Subir a Shopify", () => createShopifyDraft({ db: deps.db, shopify: deps.config.shopify, icecat: deps.config.icecat, trace: log.trace }, run.id), (result) => `${result.updated ? "Actualizado" : "Creado"} · ${result.status === "ACTIVE" ? "activo" : "borrador"} · ${result.files.photos} fotos`);
      const duration = Date.now() - started;
      await deps.db.from("mhd_importer_job_items").update({ status: "ok", finished_at: new Date().toISOString(), duration_ms: duration, cost_usd: 0, run_id: run.id, error: null, lease_until: null, step: null }).eq("id", item.id);
      log.add({ level: "info", step: "Producto", message: `Subido: ${draft.handle} · ${Math.round(duration / 1000)} s`, durationMs: duration });
      return;
    }
    const { data: fromMhd, error } = await deps.db.rpc("mhd_importer_product", { p_codigo: item.codigo });
    if (error) throw error;
    if (!fromMhd) throw new Error(`MHD ya no tiene el producto ${item.codigo}.`);
    // Recolocación (David, 2026-10-27): si MHD lo tiene en una subfamilia equivocada, manda la nuestra (perfil, filtros,
    // título y colocación en el árbol nuevo).
    const { data: moved, error: movedError } = await deps.db.from("mhd_importer_subfamily_overrides").select("cod_familia,nombre_familia,cod_subfamilia,nombre_subfamilia,mhd_cod_subfamilia").eq("codigo", item.codigo).maybeSingle();
    if (movedError) throw movedError;
    const listing = moved ? { ...fromMhd, cod_familia: moved.cod_familia, nombre_familia: moved.nombre_familia ?? fromMhd.nombre_familia, cod_subfamilia: moved.cod_subfamilia, nombre_subfamilia: moved.nombre_subfamilia ?? fromMhd.nombre_subfamilia } : fromMhd;
    if (moved) log.add({ level: "decision", step: "Recolocación", message: `MHD lo tiene en «${fromMhd.nombre_subfamilia ?? fromMhd.cod_subfamilia}»; se procesa como «${listing.nombre_subfamilia ?? listing.cod_subfamilia}».` });
    const { profileRow, family } = await familyData(deps.db, listing.cod_familia);
    const subfamilyEans = family.filter((entry) => entry.cod_subfamilia === listing.cod_subfamilia && entry.codigo_ean).map((entry) => entry.codigo_ean!);
    const result = await processProduct({ ...deps, trace: log.trace, elviModel: deps.elviModel, noThinking: deps.noThinking }, listing, profileRow as Parameters<typeof processProduct>[2], subfamilyEans);
    const row: Record<string, unknown> = result.status === "ok"
      ? { codigo: listing.codigo, family_code: listing.cod_familia, status: "ok", result: result.product, warnings: result.warnings, model: PROCESSOR_MODEL, usage: result.usage, cost_usd: result.costUsd, created_by: "trabajador" }
      : { codigo: listing.codigo, family_code: listing.cod_familia, status: "discarded", discard_reason: result.reason, warnings: result.warnings, created_by: "trabajador" };
    const saved = await log.trace.step("Guardar la prueba", async () => {
      const { data, error: saveError } = await deps.db.from("mhd_importer_product_runs").insert(row).select("id").single();
      if (saveError) throw saveError;
      if (result.status === "ok") {
        await saveRunMedia(deps.db, data.id, result.media);
        // Fuera los archivos de las pruebas anteriores de este producto; si falla, se avisa y se sigue.
        await pruneOlderRunMedia(deps.db, listing.codigo, data.id).catch((caught: Error) => log.add({ level: "aviso", step: "Guardar la prueba", message: `No se borraron los archivos antiguos: ${caught.message}` }));
      }
      return data;
    }, () => (result.status === "ok" ? `${result.media.length} archivos guardados` : "Descartado"));
    // Avisos del procesador que no han salido ya como decisión o revisión.
    for (const warning of result.warnings.filter((text) => !text.startsWith("Revisión:") && !/^(Modelo|Marca|Fotos de Icecat)/.test(text))) log.add({ level: "aviso", step: "Avisos", message: warning });
    // Tandas con «Subir a Shopify» (2026-10-26): el producto se sube en borrador al momento, con el tiempo de cada parte.
    // Si la subida falla, el producto queda procesado y el error en el registro y en su detalle.
    let uploadError: string | null = null;
    // «nuevos»: no se tocan los productos que la tienda ya tenía antes del importador (por EAN, en el espejo); los que
    // creó el importador (alguna prueba con ese identificador de Shopify) sí se actualizan (David, 2026-10-26).
    let inStore: { product_id: string } | null = null;
    if (deps.upload === "nuevos" && result.status === "ok" && result.product.ean) {
      const { data: found } = await deps.db.from("shopify_variants").select("product_id").eq("barcode", result.product.ean).limit(1).maybeSingle();
      if (found) {
        const { count } = await deps.db.from("mhd_importer_product_runs").select("id", { count: "exact", head: true }).eq("shopify_product_id", found.product_id);
        if (!count) inStore = found;
      }
    }
    if (inStore) log.add({ level: "decision", step: "Subir a Shopify", message: `Ya estaba en la tienda antes del importador (${inStore.product_id}): no se toca, la tanda solo sube los nuevos.` });
    if (deps.upload && result.status === "ok" && !inStore) {
      await log.trace.step("Subir a Shopify", () => createShopifyDraft({ db: deps.db, shopify: deps.config.shopify, icecat: deps.config.icecat, trace: log.trace }, saved.id), (draft) => `${draft.updated ? "Actualizado" : "Creado"} en ${draft.status === "DRAFT" ? "borrador" : draft.status} · ${draft.files.photos} fotos`)
        .catch((caught: Error) => { uploadError = `Procesado, pero no se subió a Shopify: ${caught.message}`; });
    }
    const duration = Date.now() - started;
    await deps.db.from("mhd_importer_job_items").update({ status: result.status === "ok" ? "ok" : "descartado", finished_at: new Date().toISOString(), duration_ms: duration, cost_usd: result.status === "ok" ? result.costUsd : null, run_id: saved.id, error: result.status === "ok" ? uploadError : result.reason, lease_until: null, step: null }).eq("id", item.id);
    log.add({ level: "info", step: "Producto", message: `${result.status === "ok" ? `Hecho: ${result.product.content.title}` : `Descartado: ${result.reason}`} · ${Math.round(duration / 1000)} s`, durationMs: duration });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : typeof caught === "object" && caught && "message" in caught ? String((caught as { message: unknown }).message) : String(caught);
    // Sin saldo en Anthropic o tope de gasto del espacio de trabajo alcanzado («workspace API usage limits», 2026-10-26:
    // no se detectaba y más de mil productos acabaron en error): se pausan todas las tandas y el producto vuelve a la cola
    // sin gastar intento.
    if (/credit balance|billing|saldo|usage limits?/i.test(message)) {
      const reason = /usage limits?/i.test(message) ? "Anthropic: se ha alcanzado el tope de gasto del espacio de trabajo" : "Anthropic no tiene saldo";
      await deps.db.rpc("mhd_importer_pause_all", { p_reason: `${reason}: ${message.slice(0, 200)}` });
      log.add({ level: "error", step: "Producto", message: `Sin saldo en Anthropic: tandas pausadas. ${message}`, durationMs: Date.now() - started });
      await deps.db.from("mhd_importer_job_items").update({ status: "pendiente", attempts: Math.max(0, item.attempts - 1), lease_until: null, step: null }).eq("id", item.id);
      return;
    }
    const retry = item.attempts < WORKER.maxAttempts;
    log.add({ level: "error", step: "Producto", message: `${message}${retry ? " · se reintenta" : ""}`, durationMs: Date.now() - started });
    await deps.db.from("mhd_importer_job_items").update(retry ? { status: "pendiente", error: message, lease_until: null, step: null } : { status: "error", error: message, finished_at: new Date().toISOString(), duration_ms: Date.now() - started, lease_until: null, step: null }).eq("id", item.id);
    // Freno automático (David, 2026-10-26: «para todo»): si fallan muchos seguidos, por el motivo que sea, se pausan las
    // tandas. Así un fallo nuevo que nadie ha previsto no quema miles de productos.
    await log.flush();
    const { data: brake } = await deps.db.rpc("mhd_importer_brake_check", { p_job: item.job_id });
    if (brake) {
      console.error(JSON.stringify({ productImporterWorker: "freno", reason: brake }));
      await sendAlert(deps.db, { key: `importador:freno:${item.job_id}`, subject: "Importador parado por el freno", lines: ["Un trabajo del importador se ha pausado solo:", String(brake)] });
    }
  } finally {
    await log.flush();
  }
}

// Un turno del trabajador (2026-10-26): coge un puesto libre (hasta `workers` a la vez) y procesa en cola continua:
// en cuanto termina un producto coge otro, sin esperar al más lento, hasta `concurrency` a la vez. Si quedan puestos
// libres y trabajo, llama a `spawn` para que arranque otro trabajador. El primero refresca antes el espejo de la tienda
// si tiene más de 6 horas. Devuelve si queda trabajo, para que la ruta se vuelva a llamar.
export async function runWorkerTurn(env: Env, config: SourcesConfig, spawn: () => void = () => undefined) {
  const db = workerClient(env);
  const { data: jobs } = await db.from("mhd_importer_jobs").select("options").in("status", ["en_cola", "en_curso"]).order("created_at").limit(1);
  const options = (jobs?.[0]?.options ?? {}) as { workers?: number; concurrency?: number };
  const workers = Math.min(12, Math.max(1, Number(options.workers ?? WORKER.workers)));
  const concurrency = Math.min(12, Math.max(1, Number(options.concurrency ?? WORKER.concurrency)));
  const { data: slots, error } = await db.rpc("mhd_importer_slot_acquire", { p_seconds: WORKER.leaseSeconds, p_max: workers });
  if (error) throw error;
  const slot = (slots as { slot: number; token: string }[] | null)?.[0];
  if (!slot) return { ran: false, processed: 0, more: false, reason: "No hay puesto libre." };
  const heartbeat = setInterval(() => { void db.rpc("mhd_importer_slot_heartbeat", { p_slot: slot.slot, p_token: slot.token, p_seconds: WORKER.leaseSeconds }).then(() => undefined); }, 30_000);
  const ai = new Anthropic({ apiKey: anthropicKey(env) });
  const started = Date.now(); let processed = 0; let more = false;
  try {
    const { mirrorAgeHours, refreshShopifyMirror } = await import("../shopify-mirror");
    const age = jobs?.length ? await mirrorAgeHours(db) : 0;
    // Sin espejo todavía no se puede colocar nada: solo el primer puesto trabaja (lo llena) y los demás esperan al
    // vigilante.
    if (age === null && slot.slot !== 1) return { ran: false, processed: 0, more: false, reason: "Esperando al espejo de la tienda." };
    if (jobs?.length && slot.slot === 1) {
      if (age === null || age > WORKER.mirrorMaxAgeHours) {
        const result = await refreshShopifyMirror(db, config.shopify).catch((caught: Error) => ({ error: caught.message }));
        console.log(JSON.stringify({ productImporterWorker: "espejo", ...result }));
      }
    }
    // Con el espejo listo, arranca otro trabajador si la tanda usa más de uno (ese, a su vez, arranca el siguiente).
    if (jobs?.length && workers > 1) spawn();
    // Opciones de cada tanda (p. ej. «Subir a Shopify»), leídas una vez por turno.
    const optionsByJob = new Map<string, Promise<{ upload?: boolean | "nuevos" | "solo"; elviModel?: string; noThinking?: boolean }>>();
    const jobOptions = (jobId: string) => {
      if (!optionsByJob.has(jobId)) optionsByJob.set(jobId, Promise.resolve(db.from("mhd_importer_jobs").select("options").eq("id", jobId).single().then(({ data }) => (data?.options ?? {}) as { upload?: boolean | "nuevos" | "solo"; elviModel?: string; noThinking?: boolean })));
      return optionsByJob.get(jobId)!;
    };
    const running = new Set<Promise<void>>(); let empty = false;
    while (true) {
      const canClaim = !empty && Date.now() - started < WORKER.budgetMs;
      if (canClaim && running.size < concurrency) {
        const { data: items, error: claimError } = await db.rpc("mhd_importer_claim_items", { p_limit: concurrency - running.size, p_lease_seconds: WORKER.itemLeaseSeconds });
        if (claimError) throw claimError;
        if (!items?.length) empty = true;
        for (const item of (items ?? []) as JobItem[]) {
          const task: Promise<void> = jobOptions(item.job_id).then((options) => processJobItem({ db, config, ai, upload: options.upload === "nuevos" || options.upload === "solo" ? options.upload : Boolean(options.upload), elviModel: options.elviModel === "sonnet" ? ELVI_MODELS.sonnet : undefined, noThinking: Boolean(options.noThinking) }, item)).finally(() => { running.delete(task); processed += 1; });
          running.add(task);
        }
      }
      if (!running.size && (empty || !canClaim)) break;
      // Espera a que acabe alguno (o 3 s, para volver a mirar la cola si estaba vacía).
      await Promise.race([...running, new Promise((resolve) => setTimeout(resolve, empty ? 3_000 : 60_000))]);
      // Cola vacía: se vuelve a mirar mientras haya productos en marcha (pueden llegar reintentos).
      if (empty && running.size) empty = false;
    }
    await db.rpc("mhd_importer_finish_jobs");
    // Queda trabajo si hay pendientes en tandas activas (las pausadas esperan).
    const { data: active } = await db.from("mhd_importer_jobs").select("id").in("status", ["en_cola", "en_curso"]);
    const ids = (active ?? []).map((job) => job.id);
    const { count } = ids.length ? await db.from("mhd_importer_job_items").select("id", { count: "exact", head: true }).eq("status", "pendiente").in("job_id", ids) : { count: 0 };
    more = Boolean(count);
  } finally {
    clearInterval(heartbeat);
    await db.rpc("mhd_importer_slot_release", { p_slot: slot.slot, p_token: slot.token });
  }
  return { ran: true, slot: slot.slot, processed, more };
}
