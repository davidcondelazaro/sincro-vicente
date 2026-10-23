import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";

// Importación de MHD por páginas: cada llamada procesa una página y la base de
// datos encadena la siguiente (mhd_import_ingest_page → pg_net → esta función).
// Contesta enseguida y trabaja en segundo plano (EdgeRuntime.waitUntil).

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const respond = (body: unknown, status = 200) => Response.json(body, { status });

// Parte = nivel de categoría (0, 1, 2 → ?nivel=1/2/3); el resto de entidades tiene una sola parte.
const entities: Record<string, { endpoint: string; id: string; pageSize: number; query?: (part: number) => string }> = {
  categories: { endpoint: "categories", id: "cd_familia", pageSize: 1000, query: (part) => `&nivel=${part + 1}` },
  brands: { endpoint: "brands", id: "cd_marca", pageSize: 1000 },
  products: { endpoint: "products", id: "codigo", pageSize: 1000 },
  prices: { endpoint: "prices", id: "codigo", pageSize: 5000 },
  stock: { endpoint: "stocks", id: "codigo", pageSize: 5000 },
};

type MhdResponse = { success?: boolean; data?: Record<string, unknown>[]; extra?: { totalRecords?: number }; errors?: unknown };
type Claim = { lease_token: string; entity: string; part: number; page: number; failures: number };

function env(name: string) { const value = Deno.env.get(name); if (!value) throw new Error(`Falta la variable ${name} en la función.`); return value; }
function mhdUrl(endpoint: string, page: number, pageSize: number, extra = "") {
  const trim = (value: string) => value.replace(/^\/+|\/+$/g, "");
  return `${env("MHD_API_URL").replace(/\/$/, "")}/api/${trim(env("MHD_API_VERSION"))}/${trim(env("MHD_API_SUB_PATH"))}/${endpoint}?page=${page}&pageSize=${pageSize}${extra}`;
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchPage(entity: string, part: number, page: number) {
  const config = entities[entity];
  if (!config) throw new Error(`Entidad desconocida: ${entity}`);
  const url = mhdUrl(config.endpoint, page, config.pageSize, config.query?.(part) ?? "");
  const authorization = `Basic ${btoa(`${env("MHD_API_USER")}:${env("MHD_API_PASS")}`)}`;
  let lastError = "";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { Accept: "application/json", Authorization: authorization }, signal: AbortSignal.timeout(60_000) });
      const body = await response.json().catch(() => null) as MhdResponse | null;
      if (!response.ok || !body?.success || !Array.isArray(body.data)) {
        lastError = `HTTP ${response.status}${body?.errors ? `: ${JSON.stringify(body.errors).slice(0, 300)}` : ""}`;
      } else {
        const total = Number(body.extra?.totalRecords);
        if (!Number.isInteger(total) || total < 0) throw new Error("MHD no informó un total válido");
        const ids = body.data.map((row) => String(row[config.id] ?? ""));
        if (ids.some((id) => !id)) throw new Error("MHD devolvió registros sin identificador");
        if (new Set(ids).size !== ids.length) throw new Error("MHD devolvió identificadores repetidos en la misma página");
        if (!body.data.length && (page - 1) * config.pageSize < total) throw new Error("MHD devolvió una página vacía antes de completar el total");
        return { rows: body.data, total, attempts: attempt };
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (attempt < 3) await sleep(2_000 * attempt);
  }
  throw Object.assign(new Error(lastError), { attempts: 3 });
}

// Fichas de detalle: una petición por producto (/products/:codigo), así que van de pocas en pocas (DETAIL_CONCURRENCY
// a la vez) y con un tope de tiempo por tanda para no pasar de la reserva de 90 s. Las que no se llegan a pedir siguen
// pendientes para la tanda siguiente; las que fallan se apuntan con el motivo y se reintentan en la próxima importación.
const DETAIL_BATCH = 60, DETAIL_CONCURRENCY = 2, DETAIL_BUDGET_MS = 55_000;

async function fetchDetail(codigo: string) {
  const url = mhdUrl(`products/${encodeURIComponent(codigo)}`, 1, 1).replace(/\?.*$/, "");
  const authorization = `Basic ${btoa(`${env("MHD_API_USER")}:${env("MHD_API_PASS")}`)}`;
  let lastError = "";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { Accept: "application/json", Authorization: authorization }, signal: AbortSignal.timeout(20_000) });
      if (response.status === 404) return { error: "MHD no tiene la ficha (404)" };
      const body = await response.json().catch(() => null) as { success?: boolean; data?: Record<string, unknown> } | null;
      if (response.ok && body?.success && body.data) return { row: { ...body.data, codigo: String(body.data.codigo ?? codigo) } };
      lastError = `HTTP ${response.status}`;
      // Con 4xx que no sean de saturación no tiene sentido insistir.
      if (response.status < 500 && response.status !== 429) break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (attempt < 3) await sleep(1_500 * attempt * attempt);
  }
  return { error: lastError };
}

async function detailsStep(runId: string, leaseToken: string) {
  const started = Date.now();
  const { data: batch, error } = await db.rpc("mhd_import_detail_batch", { p_run_id: runId, p_lease_token: leaseToken, p_limit: DETAIL_BATCH });
  if (error) throw error;
  if (!batch) return;
  const codes = [...(batch as { codes: string[] }).codes];
  const rows: Record<string, unknown>[] = [], failed: { codigo: string; error: string }[] = [];
  await Promise.all(Array.from({ length: DETAIL_CONCURRENCY }, async () => {
    while (codes.length && Date.now() - started < DETAIL_BUDGET_MS) {
      const codigo = codes.shift()!;
      const result = await fetchDetail(codigo);
      if (result.row) rows.push(result.row); else failed.push({ codigo, error: result.error ?? "sin motivo" });
    }
  }));
  // Si no ha salido ninguna y no es porque MHD no las tenga, MHD está caído o saturado: cuenta como tanda fallida
  // (tres seguidas paran la importación) y no se apunta nada.
  if (!rows.length && failed.some((item) => !item.error.includes("404"))) throw new Error(`MHD no devolvió ninguna ficha de la tanda: ${failed[0].error}`);
  const { data, error: ingestError } = await db.rpc("mhd_import_ingest_details", {
    p_run_id: runId, p_lease_token: leaseToken, p_rows: rows, p_failed: failed, p_duration_ms: Date.now() - started,
  });
  if (ingestError) throw ingestError;
  console.log(JSON.stringify({ run: runId, entity: "details", ok: rows.length, failed: failed.length, ms: Date.now() - started, result: data }));
}

async function step(runId: string) {
  const { data: claim, error: claimError } = await db.rpc("mhd_import_claim", { p_run_id: runId });
  if (claimError) throw claimError;
  if (!claim) { console.log(JSON.stringify({ run: runId, step: "sin trabajo" })); return; }
  const { lease_token, entity, part, page, failures } = claim as Claim;
  if (entity === "details") {
    // Un fallo de la base en una tanda: se libera la reserva y el vigilante la retoma.
    try { await detailsStep(runId, lease_token); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db.rpc("mhd_import_page_failed", { p_run_id: runId, p_lease_token: lease_token, p_entity: entity, p_part: part, p_page: page, p_attempts: 1, p_duration_ms: 0, p_error: message });
      console.error(JSON.stringify({ run: runId, entity, error: message }));
    }
    return;
  }
  // Si la página anterior falló, espera antes de reintentarla (10 s, 20 s).
  if (failures > 0) await sleep(10_000 * failures);
  const started = Date.now();
  try {
    const { rows, total, attempts } = await fetchPage(entity, part, page);
    const fetchedMs = Date.now() - started;
    const { data, error } = await db.rpc("mhd_import_ingest_page", {
      p_run_id: runId, p_lease_token: lease_token, p_entity: entity, p_part: part, p_page: page,
      p_total: total, p_rows: rows, p_attempts: attempts, p_duration_ms: Date.now() - started,
    });
    if (error) throw Object.assign(new Error(`Supabase: ${error.message}`), { attempts });
    console.log(JSON.stringify({ run: runId, entity, part, page, records: rows.length, total, mhd_ms: fetchedMs, total_ms: Date.now() - started, result: data }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const attempts = (error as { attempts?: number }).attempts ?? 1;
    const { data } = await db.rpc("mhd_import_page_failed", {
      p_run_id: runId, p_lease_token: lease_token, p_entity: entity, p_part: part, p_page: page,
      p_attempts: attempts, p_duration_ms: Date.now() - started, p_error: message,
    });
    console.error(JSON.stringify({ run: runId, entity, part, page, error: message, result: data }));
  }
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return respond({ error: "Método no permitido" }, 405);
  const { data: valid } = await db.rpc("mhd_import_token_valid", { p_token: request.headers.get("x-mhd-import-token") ?? "" });
  if (!valid) return respond({ error: "No autorizado" }, 401);
  const body = await request.json().catch(() => ({})) as { run_id?: string };
  if (!body.run_id) return respond({ error: "Falta run_id" }, 400);
  EdgeRuntime.waitUntil(step(body.run_id).catch((error) => console.error(JSON.stringify({ run: body.run_id, error: String(error?.message ?? error) }))));
  return respond({ accepted: true }, 202);
});
