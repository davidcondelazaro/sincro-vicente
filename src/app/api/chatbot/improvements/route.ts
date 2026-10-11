import { errorMessage, json, sessionEmail } from "@/lib/chatbot-api";
import { createChatbotClient } from "@/lib/chatbot-supabase";

export const dynamic = "force-dynamic";

// Informes de mejora del chatbot (tablas improvement_reports e improvement_proposals): consultar, generar uno
// (ruta /api/admin/mejoras del chatbot) y decidir cada propuesta.
const STATUSES = ["pendiente", "aprobada", "descartada", "aplicada"] as const;

export async function GET(request: Request) {
  if (!(await sessionEmail())) return json({ error: "Necesitas iniciar sesión." }, 401);
  try {
    const db = createChatbotClient();
    const { data: reports, error } = await db.from("improvement_reports")
      .select("id, created_at, period_from, period_to, conversations, issues, status, error, requested_by")
      .order("id", { ascending: false }).limit(20);
    if (error) throw error;
    const requested = Number(new URL(request.url).searchParams.get("report"));
    const reportId = Number.isInteger(requested) && requested > 0 ? requested : reports?.find((report) => report.status === "ok")?.id ?? null;
    const [proposals, approved] = await Promise.all([
      reportId ? db.from("improvement_proposals").select("*").eq("report_id", reportId).order("id") : Promise.resolve({ data: [], error: null }),
      db.from("improvement_proposals").select("id, report_id, title, severity, kind, decided_by, decided_at").eq("status", "aprobada").order("decided_at", { ascending: false }),
    ]);
    if (proposals.error) throw proposals.error;
    if (approved.error) throw approved.error;
    return json({ reports, reportId, proposals: proposals.data, approved: approved.data });
  } catch (caught) {
    return json({ error: errorMessage(caught, "No se pudieron leer los informes de mejora.") }, 500);
  }
}

// Genera un informe ahora: { days }.
export async function POST(request: Request) {
  const email = await sessionEmail();
  if (!email) return json({ error: "Necesitas iniciar sesión." }, 401);
  const body = (await request.json().catch(() => null)) as { days?: unknown } | null;
  const secret = process.env.CHATBOT_ADMIN_SECRET;
  if (!secret) return json({ error: "Falta la variable CHATBOT_ADMIN_SECRET." }, 500);
  const baseUrl = process.env.CHATBOT_URL ?? "https://chatbot-vicente.vercel.app";
  try {
    const response = await fetch(`${baseUrl}/api/admin/mejoras`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ days: Number(body?.days ?? 7), requestedBy: email }),
      cache: "no-store",
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return json({ error: result.error ?? `El chatbot respondió ${response.status}.` }, response.status);
    return json(result, 202);
  } catch (caught) {
    return json({ error: errorMessage(caught, "No se pudo contactar con el chatbot.") }, 502);
  }
}

// Decide una propuesta: { id, status, notes }.
export async function PUT(request: Request) {
  const email = await sessionEmail();
  if (!email) return json({ error: "Necesitas iniciar sesión." }, 401);
  const body = (await request.json().catch(() => null)) as { id?: unknown; status?: unknown; notes?: unknown } | null;
  const id = Number(body?.id);
  const status = body?.status as (typeof STATUSES)[number];
  if (!Number.isInteger(id) || id <= 0 || !STATUSES.includes(status)) return json({ error: "Propuesta o estado no válido." }, 400);
  const notes = typeof body?.notes === "string" ? body.notes.trim().slice(0, 2000) || null : undefined;
  try {
    const changes: Record<string, unknown> = { status, decided_by: status === "pendiente" ? null : email, decided_at: status === "pendiente" ? null : new Date().toISOString() };
    if (notes !== undefined) changes.notes = notes;
    const { data, error } = await createChatbotClient().from("improvement_proposals").update(changes).eq("id", id).select("*").single();
    if (error) throw error;
    return json({ proposal: data });
  } catch (caught) {
    return json({ error: errorMessage(caught, "No se pudo guardar la decisión.") }, 500);
  }
}
