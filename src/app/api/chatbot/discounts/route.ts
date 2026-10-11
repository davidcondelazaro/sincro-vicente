import { errorMessage, json, sessionEmail } from "@/lib/chatbot-api";
import { createChatbotClient } from "@/lib/chatbot-supabase";

export const dynamic = "force-dynamic";

// Cupones y descuentos de Shopify copiados en el chatbot (tabla discounts) y qué puede dar el bot.
export async function GET() {
  if (!(await sessionEmail())) return json({ error: "Necesitas iniciar sesión." }, 401);
  try {
    const db = createChatbotClient();
    const [discounts, lastSync] = await Promise.all([
      db.from("discounts").select("*").order("status").order("title"),
      db.from("sync_runs").select("started_at, status").eq("kind", "discounts").order("started_at", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (discounts.error) throw discounts.error;
    return json({ discounts: discounts.data, lastSync: lastSync.data ?? null });
  } catch (caught) {
    return json({ error: errorMessage(caught, "No se pudieron leer los cupones.") }, 500);
  }
}

// { id, botAllowed, botNote }: solo se pueden permitir los abiertos a cualquier cliente.
export async function PUT(request: Request) {
  const email = await sessionEmail();
  if (!email) return json({ error: "Necesitas iniciar sesión." }, 401);
  const body = (await request.json().catch(() => null)) as { id?: unknown; botAllowed?: unknown; botNote?: unknown } | null;
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) return json({ error: "Cupón no válido." }, 400);
  try {
    const db = createChatbotClient();
    const { data: current, error: readError } = await db.from("discounts").select("open_to_all").eq("id", id).maybeSingle();
    if (readError) throw readError;
    if (!current) return json({ error: "Ese cupón ya no existe en Shopify." }, 404);
    if (body?.botAllowed === true && !current.open_to_all) return json({ error: "Este cupón está restringido a algunos clientes: el chatbot no puede darlo." }, 400);
    const note = typeof body?.botNote === "string" ? body.botNote.trim().slice(0, 500) || null : null;
    const { data, error } = await db.from("discounts")
      .update({ bot_allowed: body?.botAllowed === true, bot_note: note, updated_by: email, updated_at: new Date().toISOString() })
      .eq("id", id).select("*").single();
    if (error) throw error;
    return json({ discount: data });
  } catch (caught) {
    return json({ error: errorMessage(caught, "No se pudo guardar.") }, 500);
  }
}
