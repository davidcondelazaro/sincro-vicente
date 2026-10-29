import { errorResponse, importerSession, sourcesConfig } from "@/lib/mhd-importer/server";
import { decideWarranty, loadWarrantyTables, reapplyWarranty } from "@/lib/mhd-importer/warranty";

// Ampliación de garantía (src/lib/mhd-importer/warranty.ts): cuadro de familias y reglas por título con las que el
// importador escribe custom.admite_garantia. GET: familias (con su grupo y productos activos) y reglas. POST: cambiar la
// casilla de una familia, crear, editar o borrar reglas, probar un título y volver a marcar lo ya subido.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Las tablas solo las lee y escribe el rol de servicio; la sesión solo da permiso.
async function serviceDb() {
  const { workerClient } = await import("@/lib/mhd-importer/jobs");
  return workerClient(process.env);
}

export async function GET() {
  const session = await importerSession();
  if (!session) return Response.json({ error: "Necesitas iniciar sesión." }, { status: 401 });
  try {
    const db = await serviceDb();
    const [{ data: collections, error: collectionsError }, { data: rules, error: rulesError }] = await Promise.all([
      db.from("store_collections").select("handle,title,level,parent_handle,warranty_eligible,position"),
      db.from("store_warranty_title_rules").select("id,family_handle,pattern,eligible,position,note").order("position").order("id"),
    ]);
    if (collectionsError) throw collectionsError;
    if (rulesError) throw rulesError;
    // Productos activos por familia, de los identificadores de Shopify (el tipo de producto es el nombre de la familia).
    const active = new Map<string, number>();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from("store_shopify_ids").select("product_type").eq("status", "ACTIVE").order("codigo").range(from, from + 999);
      if (error) throw error;
      for (const row of data) if (row.product_type) active.set(row.product_type, (active.get(row.product_type) ?? 0) + 1);
      if (data.length < 1000) break;
    }
    const all = collections as { handle: string; title: string; level: string; parent_handle: string | null; warranty_eligible: boolean | null; position: number }[];
    const groups = new Map(all.filter((row) => row.level === "grupo").map((row) => [row.handle, row.title]));
    const families = all.filter((row) => row.level === "familia")
      .map((row) => ({ handle: row.handle, title: row.title, group: groups.get(row.parent_handle ?? "") ?? "", eligible: row.warranty_eligible, products: active.get(row.title) ?? 0 }))
      .sort((a, b) => a.group.localeCompare(b.group, "es") || a.title.localeCompare(b.title, "es"));
    return Response.json({ families, rules });
  } catch (caught) { return errorResponse(caught, "No se pudieron leer las garantías."); }
}

type Body = { action?: string; handle?: string; eligible?: boolean | null; id?: number; family_handle?: string; pattern?: string; note?: string | null; title?: string; dryRun?: boolean };

export async function POST(request: Request) {
  const session = await importerSession();
  if (!session) return Response.json({ error: "Necesitas iniciar sesión." }, { status: 401 });
  const body = await request.json().catch(() => ({})) as Body;
  try {
    const db = await serviceDb();
    if (body.action === "familia") {
      if (!body.handle || !(body.eligible === true || body.eligible === false || body.eligible === null)) return Response.json({ error: "Falta la familia o el valor." }, { status: 400 });
      const { error } = await db.from("store_collections").update({ warranty_eligible: body.eligible, updated_at: new Date().toISOString() }).eq("handle", body.handle).eq("level", "familia");
      if (error) throw error;
      return Response.json({ ok: true });
    }
    if (body.action === "regla_guardar") {
      const pattern = body.pattern?.trim() ?? "";
      if (!body.family_handle || !pattern || typeof body.eligible !== "boolean") return Response.json({ error: "Faltan la familia, el patrón o si lleva garantía." }, { status: 400 });
      try { new RegExp(pattern, "i"); } catch { return Response.json({ error: "El patrón no es una expresión regular válida." }, { status: 400 }); }
      const row = { family_handle: body.family_handle, pattern, eligible: body.eligible, note: body.note?.trim() || null };
      if (body.id) {
        const { error } = await db.from("store_warranty_title_rules").update(row).eq("id", body.id);
        if (error) throw error;
      } else {
        const { data: last } = await db.from("store_warranty_title_rules").select("position").order("position", { ascending: false }).limit(1).maybeSingle();
        const { error } = await db.from("store_warranty_title_rules").insert({ ...row, position: (last?.position ?? -1) + 1 });
        if (error) throw error;
      }
      return Response.json({ ok: true });
    }
    if (body.action === "regla_borrar") {
      if (!body.id) return Response.json({ error: "Falta la regla." }, { status: 400 });
      const { error } = await db.from("store_warranty_title_rules").delete().eq("id", body.id);
      if (error) throw error;
      return Response.json({ ok: true });
    }
    if (body.action === "probar") {
      if (!body.handle || !body.title?.trim()) return Response.json({ error: "Faltan la familia o el título." }, { status: 400 });
      return Response.json(decideWarranty(await loadWarrantyTables(db), body.handle, body.title.trim()));
    }
    if (body.action === "aplicar") return Response.json(await reapplyWarranty(db, sourcesConfig().shopify, { dryRun: Boolean(body.dryRun) }));
    return Response.json({ error: "Acción no válida." }, { status: 400 });
  } catch (caught) { return errorResponse(caught, "No se pudo guardar."); }
}
