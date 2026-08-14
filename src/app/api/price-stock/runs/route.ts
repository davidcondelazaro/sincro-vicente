import { createClient as createSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
type ImportType = "prices" | "stock";
type Mode = "all" | "selective" | "partial";

function parse(input: Record<string, unknown>) {
  const importType = input.importType as ImportType;
  const mode = input.mode as Mode;
  if (importType !== "prices" && importType !== "stock") throw new Error("Tipo de importación no válido.");
  if (mode !== "all" && mode !== "selective" && mode !== "partial") throw new Error("Modo de actualización no válido.");
  const productIds = [...new Set(String(input.productIds ?? "").split(",").map((value) => value.trim()).filter(Boolean))];
  if (productIds.join(",").length > 2_000 || productIds.some((value) => value.length > 150)) throw new Error("Los IDs indicados no son válidos.");
  if (mode === "selective" && !productIds.length) throw new Error("Indica al menos un ID de producto.");
  return { importType, mode, filters: productIds.length ? { productIds } : {} };
}

export async function GET(request: Request) {
  const supabase = await createSupabaseClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims.sub) return Response.json({ error: "Necesitas iniciar sesión." }, { status: 401 });
  const url = new URL(request.url); const importType = url.searchParams.get("importType"); const from = url.searchParams.get("from"); const until = url.searchParams.get("until"); const page = Math.max(0, Number.parseInt(url.searchParams.get("page") ?? "0", 10) || 0);
  if (importType && importType !== "prices" && importType !== "stock") return Response.json({ error: "Tipo no válido." }, { status: 400 });
  if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from) || until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) return Response.json({ error: "La fecha no es válida." }, { status: 400 });
  const pageSize = 15; let query = supabase.from("price_stock_import_runs").select("*").order("created_at", { ascending: false });
  if (importType) query = query.eq("import_type", importType);
  if (from) query = query.gte("created_at", `${from}T00:00:00.000Z`);
  if (until) { const end = new Date(`${until}T00:00:00.000Z`); end.setUTCDate(end.getUTCDate() + 1); query = query.lt("created_at", end.toISOString()); }
  const { data, error } = await query.range(page * pageSize, page * pageSize + pageSize);
  if (error) return Response.json({ error: "No se pudo recuperar el historial." }, { status: 500 });
  const rows = data ?? []; return Response.json({ runs: rows.slice(0, pageSize), hasMore: rows.length > pageSize, page });
}

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseClient(); const { data: claims } = await supabase.auth.getClaims();
    if (!claims?.claims.sub) return Response.json({ error: "Necesitas iniciar sesión." }, { status: 401 });
    const input = parse(await request.json() as Record<string, unknown>);
    const { data: run, error } = await supabase.rpc("start_price_stock_import", { p_import_type: input.importType, p_mode: input.mode, p_filters: input.filters });
    if (error || !run) throw error ?? new Error("No se pudo iniciar la importación.");
    // La ejecución ya está en la cola. No esperamos el bloque del trabajador:
    // hacerlo retenía la pantalla de inicio hasta 45 segundos.
    void supabase.functions.invoke("sync-price-stock-imports", { body: { importType: input.importType } }).then(({ error: dispatchError }) => {
      if (dispatchError) console.error("Price/stock worker dispatch failed", dispatchError);
    }).catch((dispatchError) => console.error("Price/stock worker dispatch failed", dispatchError));
    return Response.json({ run });
  } catch (error) {
    console.error("Price/stock import start failed", error);
    const message = error instanceof Error ? error.message : error && typeof error === "object" && "message" in error ? String((error as { message?: unknown }).message) : "No se pudo iniciar la importación.";
    return Response.json({ error: message }, { status: 500 });
  }
}
