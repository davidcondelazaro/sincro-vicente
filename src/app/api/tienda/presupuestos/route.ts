import { errorMessage, json, sessionEmail } from "@/lib/chatbot-api";
import { createChatbotClient } from "@/lib/chatbot-supabase";

export const dynamic = "force-dynamic";

// Presupuestos a medida pedidos desde el chat (tabla quotes del chatbot). Los borradores (aún sin enviar por el
// cliente) no se listan.
const STATUSES = ["nuevo", "en_curso", "enviado", "aceptado", "descartado"];

export async function GET(request: Request) {
  if (!(await sessionEmail())) return json({ error: "Necesitas iniciar sesión." }, 401);
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const search = (url.searchParams.get("search") ?? "").replace(/[,()*%\\]/g, " ").trim();
  try {
    let query = createChatbotClient().from("quotes").select("*").neq("status", "borrador");
    if (status && STATUSES.includes(status)) query = query.eq("status", status);
    if (search) query = query.or(`name.ilike.*${search}*,email.ilike.*${search}*,comments.ilike.*${search}*`);
    const { data, error } = await query.order("submitted_at", { ascending: false }).limit(200);
    if (error) throw error;
    return json({ quotes: data });
  } catch (caught) {
    return json({ error: errorMessage(caught, "No se pudieron leer los presupuestos.") }, 500);
  }
}

// Cambia el estado o las notas internas: { id, status?, teamNotes? }.
export async function PUT(request: Request) {
  const email = await sessionEmail();
  if (!email) return json({ error: "Necesitas iniciar sesión." }, 401);
  const body = (await request.json().catch(() => null)) as { id?: unknown; status?: unknown; teamNotes?: unknown } | null;
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) return json({ error: "Presupuesto no válido." }, 400);
  const changes: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body?.status !== undefined) {
    if (!STATUSES.includes(String(body.status))) return json({ error: "Estado no válido." }, 400);
    Object.assign(changes, { status: body.status, status_changed_at: new Date().toISOString(), status_changed_by: email });
  }
  if (typeof body?.teamNotes === "string") changes.team_notes = body.teamNotes.trim().slice(0, 4000) || null;
  try {
    const { data, error } = await createChatbotClient().from("quotes").update(changes).eq("id", id).neq("status", "borrador").select("*").maybeSingle();
    if (error) throw error;
    if (!data) return json({ error: "No se ha encontrado el presupuesto." }, 404);
    return json({ quote: data });
  } catch (caught) {
    return json({ error: errorMessage(caught, "No se pudo guardar.") }, 500);
  }
}
