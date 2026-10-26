import { errorResponse, importerSession, sourcesConfig } from "@/lib/mhd-importer/server";
import { loadRedirects } from "@/lib/redirects/load";

// Base de redirecciones (docs/REDIRECCIONES.md). GET: listado con filtros y resumen por tipo de clave. POST «cargar»:
// vuelve a leer las fuentes (Shopify, inventario, Search Console) y actualiza la tabla sin tocar destinos ni estados.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
const PAGE = 50;
const KEY_TYPES = ["producto", "producto_viejo", "coleccion", "categoria_vieja", "marca", "pagina", "blog", "otro"];

export async function GET(request: Request) {
  const session = await importerSession();
  if (!session) return Response.json({ error: "Necesitas iniciar sesión." }, { status: 401 });
  try {
    const url = new URL(request.url);
    const search = url.searchParams.get("q")?.trim() ?? ""; const type = url.searchParams.get("tipo") ?? ""; const source = url.searchParams.get("fuente") ?? "";
    const page = Math.max(0, Number(url.searchParams.get("pagina") ?? 0));
    let query = session.db.from("store_redirects").select("origin,sources,current_target,key_type,key_value,clicks_16m,impressions_16m,target,status,note,updated_at", { count: "exact" });
    if (search) query = query.or(`origin.ilike.%${search.replace(/[,%()]/g, " ")}%,current_target.ilike.%${search.replace(/[,%()]/g, " ")}%`);
    if (KEY_TYPES.includes(type)) query = query.eq("key_type", type);
    if (source === "sin_redireccion") query = query.not("sources", "cs", "{shopify}").not("sources", "cs", "{inventario}");
    else if (source) query = query.contains("sources", [source]);
    const { data, count, error } = await query.order("clicks_16m", { ascending: false }).order("origin").range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw error;
    const counts = await Promise.all(KEY_TYPES.map(async (key) => {
      const { count: n, error: countError } = await session.db.from("store_redirects").select("id", { count: "exact", head: true }).eq("key_type", key);
      if (countError) throw countError;
      return [key, n ?? 0] as const;
    }));
    const { count: noRedirect } = await session.db.from("store_redirects").select("id", { count: "exact", head: true }).not("sources", "cs", "{shopify}").not("sources", "cs", "{inventario}");
    return Response.json({ rows: data, total: count ?? 0, pageSize: PAGE, byType: Object.fromEntries(counts), noRedirect: noRedirect ?? 0 });
  } catch (caught) { return errorResponse(caught, "No se pudieron leer las redirecciones."); }
}

export async function POST(request: Request) {
  const session = await importerSession();
  if (!session) return Response.json({ error: "Necesitas iniciar sesión." }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { action?: string };
  if (body.action !== "cargar") return Response.json({ error: "Acción no válida." }, { status: 400 });
  try {
    // Escribe el rol de servicio: la tabla solo la leen las sesiones.
    const { workerClient } = await import("@/lib/mhd-importer/jobs");
    const result = await loadRedirects(workerClient(process.env), sourcesConfig().shopify);
    return Response.json({ ok: true, ...result });
  } catch (caught) { return errorResponse(caught, "No se pudieron cargar las redirecciones."); }
}
