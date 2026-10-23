import { errorResponse, importerSession } from "@/lib/mhd-importer/server";

// Banco de prueba del importador (docs/IMPORTADOR_PRODUCTOS_MHD.md): GET devuelve los productos del banco con su última
// prueba y las revisiones de esa prueba; POST { action: "review", runId, verdict, note } guarda una revisión.
// Las pruebas se generan con la ruta del producto (POST /api/importador-productos/producto), desde la página.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await importerSession();
  if (!session) return Response.json({ error: "Necesitas iniciar sesión." }, { status: 401 });
  try {
    const { data: items, error } = await session.db.from("mhd_importer_bench_items").select("codigo,family_code,reason").order("family_code").order("codigo");
    if (error) throw error;
    const codes = (items ?? []).map((item) => item.codigo);
    const { data: runs, error: runsError } = await session.db.from("mhd_importer_product_runs").select("id,codigo,status,discard_reason,warnings,cost_usd,usage,result,created_at").in("codigo", codes).order("created_at", { ascending: false });
    if (runsError) throw runsError;
    const latest = new Map<string, NonNullable<typeof runs>[number]>();
    for (const run of runs ?? []) if (!latest.has(run.codigo)) latest.set(run.codigo, run);
    const runIds = [...latest.values()].map((run) => run.id);
    const { data: reviews, error: reviewsError } = runIds.length ? await session.db.from("mhd_importer_reviews").select("id,run_id,reviewer,verdict,note,created_at").in("run_id", runIds).order("created_at") : { data: [], error: null };
    if (reviewsError) throw reviewsError;
    const { data: families, error: familiesError } = await session.db.from("mhd_importer_family_profiles").select("family_code,family_name,status");
    if (familiesError) throw familiesError;
    return Response.json({
      families: families ?? [],
      items: (items ?? []).map((item) => {
        const run = latest.get(item.codigo);
        const result = run?.result as { content?: Record<string, unknown>; contentBlocked?: boolean; elviReview?: { ok: boolean; reason: string } | null; shopify?: { title?: string } } | null | undefined;
        return { ...item, run: run ? {
          id: run.id, status: run.status, discardReason: run.discard_reason, createdAt: run.created_at, costUsd: run.cost_usd, warnings: run.warnings ?? [],
          attempts: (run.usage as { contentAttempts?: number } | null)?.contentAttempts ?? null, blocked: result?.contentBlocked ?? false,
          content: result?.content ?? null, elviReview: result?.elviReview ?? null,
          reviews: (reviews ?? []).filter((review) => review.run_id === run.id),
        } : null };
      }),
    });
  } catch (caught) { return errorResponse(caught, "No se pudo leer el banco de prueba."); }
}

export async function POST(request: Request) {
  const session = await importerSession();
  if (!session) return Response.json({ error: "Necesitas iniciar sesión." }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { action?: string; runId?: string; verdict?: string; note?: string };
  if (body.action !== "review" || !body.runId || (body.verdict !== "bien" && body.verdict !== "mal")) return Response.json({ error: "Petición no válida." }, { status: 400 });
  if (body.verdict === "mal" && !body.note?.trim()) return Response.json({ error: "Di qué está mal para poder corregirlo." }, { status: 400 });
  try {
    const { error } = await session.db.from("mhd_importer_reviews").insert({ run_id: body.runId, reviewer: session.email, verdict: body.verdict, note: body.note?.trim() || null });
    if (error) throw error;
    return Response.json({ ok: true });
  } catch (caught) { return errorResponse(caught, "No se pudo guardar la revisión."); }
}
