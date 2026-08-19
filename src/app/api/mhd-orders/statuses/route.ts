import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type MhdStatusEntry = { estado?: string; fecha?: number | string | null };
type MhdOrderResponse = { success?: boolean; data?: { estado_cliente?: string | null; arr_estados?: MhdStatusEntry[] } };

function required(name: string) { const value = process.env[name]; if (!value) throw new Error(`Falta la variable ${name}.`); return value; }
function mhdUrl(path: string) {
  const base = required("MHD_API_URL").replace(/\/$/, "");
  const version = required("MHD_API_VERSION").replace(/^\/+|\/+$/g, "");
  const subPath = required("MHD_API_SUB_PATH").replace(/^\/+|\/+$/g, "");
  return `${base}/api/${version}/${subPath}${path}`;
}
function mhdHeaders() {
  const credentials = Buffer.from(`${required("MHD_API_USER")}:${required("MHD_API_PASS")}`).toString("base64");
  return { Accept: "application/json", Authorization: `Basic ${credentials}` };
}
function dateFromMhd(value: MhdStatusEntry["fecha"]) {
  if (typeof value === "number") return new Date(value).toISOString();
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function POST() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims.sub) return Response.json({ error: "Necesitas iniciar sesión." }, { status: 401 });

  const { data: exports, error: exportsError } = await supabase
    .from("mhd_order_exports")
    .select("id,mhd_order_id,mhd_status,mhd_status_payload")
    .eq("status", "exported")
    .not("mhd_order_id", "is", null);
  if (exportsError) return Response.json({ error: "No se pudieron cargar los pedidos exportados." }, { status: 500 });

  let checkedCount = 0;
  let changedCount = 0;
  const errors: string[] = [];
  for (const item of exports ?? []) {
    try {
      const response = await fetch(mhdUrl(`/orders/${item.mhd_order_id}`), { headers: mhdHeaders(), cache: "no-store", signal: AbortSignal.timeout(20_000) });
      const body = await response.json().catch(() => ({})) as MhdOrderResponse;
      if (!response.ok || !body.success || !body.data) throw new Error(`MHD respondió HTTP ${response.status}.`);
      checkedCount += 1;
      const received = (body.data.arr_estados ?? []).filter((entry) => entry.estado).map((entry) => ({ status: entry.estado!, occurred_at: dateFromMhd(entry.fecha), source_payload: entry }));
      const latest = received.sort((a, b) => (b.occurred_at ?? "").localeCompare(a.occurred_at ?? ""))[0];
      const currentStatus = body.data.estado_cliente ?? latest?.status ?? item.mhd_status;
      const statusPayload = { estado_cliente: body.data.estado_cliente ?? null, arr_estados: body.data.arr_estados ?? [] };
      const previousPayload = item.mhd_status_payload as { estado_cliente?: string | null; arr_estados?: MhdStatusEntry[] } | null;
      const statusChanged = currentStatus !== item.mhd_status;
      const payloadStatusChanged = previousPayload?.estado_cliente !== statusPayload.estado_cliente;
      const historyChanged = canonicalJson(previousPayload?.arr_estados ?? []) !== canonicalJson(statusPayload.arr_estados);
      const changed = statusChanged || payloadStatusChanged || historyChanged;
      if (changed) changedCount += 1;
      await supabase.from("mhd_order_exports").update({ mhd_status: currentStatus, mhd_status_payload: statusPayload, mhd_status_updated_at: latest?.occurred_at ?? new Date().toISOString(), last_checked_at: new Date().toISOString() }).eq("id", item.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error desconocido.";
      errors.push(`Pedido MHD #${item.mhd_order_id}: ${message}`);
      await supabase.from("mhd_order_exports").update({ last_checked_at: new Date().toISOString() }).eq("id", item.id);
    }
  }
  return Response.json({ checkedCount, changedCount, errors });
}
