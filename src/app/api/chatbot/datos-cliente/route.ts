import { errorMessage, json, sessionEmail } from "@/lib/chatbot-api";
import { createChatbotClient } from "@/lib/chatbot-supabase";

export const dynamic = "force-dynamic";

// Peticiones de clientes sobre sus datos (RGPD): buscar todo lo que guarda el chatbot de un email, exportarlo y
// borrarlo. Cada acción queda en data_requests (quién, cuándo y cuántos registros). Las conversaciones se localizan
// por los registros con ese email y por los mensajes donde aparece. La newsletter y los pedidos están en Shopify.
type Db = ReturnType<typeof createChatbotClient>;

const BY_EMAIL = [
  { table: "consents", label: "Consentimientos", columns: "id, purpose, status, text, newsletter, newsletter_result, created_at, decided_at, conversation_id" },
  { table: "stock_subscriptions", label: "Avisos de stock", columns: "id, product_title, name, status, source, created_at, notified_at, cancelled_at, conversation_id" },
  { table: "price_alerts", label: "Avisos de precio", columns: "id, product_title, price_at_signup, name, status, created_at, notified_at, cancelled_at, conversation_id" },
  { table: "quotes", label: "Presupuestos", columns: "id, status, items, comments, name, phone, postal_code, total, submitted_at, conversation_id" },
  { table: "support_requests", label: "Tickets de soporte", columns: "*" },
  { table: "customer_emails", label: "Emails de productos enviados", columns: "id, kind, product_ids, created_at, conversation_id" },
  { table: "order_access", label: "Verificaciones de pedido", columns: "*" },
] as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const likeExact = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

async function collect(db: Db, email: string, withMessages: boolean) {
  const sections: Record<string, { label: string; rows: Record<string, unknown>[] }> = {};
  const conversationIds = new Set<string>();
  for (const source of BY_EMAIL) {
    const { data, error } = await db.from(source.table).select(source.columns).ilike("email", likeExact(email)).limit(500);
    if (error) throw error;
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    sections[source.table] = { label: source.label, rows };
    for (const row of rows) if (typeof row.conversation_id === "string") conversationIds.add(row.conversation_id);
  }
  // Conversaciones donde el cliente escribió su email aunque no llegara a usarse en un aviso o un ticket.
  const { data: mentions, error } = await db.from("messages").select("conversation_id").ilike("content", `%${likeExact(email)}%`).limit(500);
  if (error) throw error;
  for (const row of mentions ?? []) if (row.conversation_id) conversationIds.add(row.conversation_id);

  const ids = [...conversationIds];
  let conversations: Record<string, unknown>[] = [];
  if (ids.length) {
    const { data, error: convError } = await db.from("conversations").select("id, started_at, last_at, page_url, summary, metadata").in("id", ids).order("started_at", { ascending: false });
    if (convError) throw convError;
    conversations = data ?? [];
    if (withMessages) {
      const { data: messages, error: msgError } = await db.from("messages").select("conversation_id, role, content, created_at").in("conversation_id", ids).in("role", ["user", "assistant"]).order("id");
      if (msgError) throw msgError;
      const byConversation = new Map<string, unknown[]>();
      for (const m of messages ?? []) byConversation.set(m.conversation_id, [...(byConversation.get(m.conversation_id) ?? []), { role: m.role, content: m.content, created_at: m.created_at }]);
      conversations = conversations.map((c) => ({ ...c, messages: byConversation.get(String(c.id)) ?? [] }));
    }
  }
  sections.conversations = { label: "Conversaciones del chat", rows: conversations };
  const counts = Object.fromEntries(Object.entries(sections).map(([key, section]) => [key, section.rows.length]));
  return { sections, counts, conversationIds: ids };
}

async function log(db: Db, email: string, action: "busqueda" | "exportacion" | "borrado", by: string, counts: Record<string, number>, note?: string | null) {
  await db.from("data_requests").insert({ email, action, requested_by: by, counts, note: note?.slice(0, 500) || null });
}

// ?email=…  → resumen de lo que hay (registra la búsqueda). &export=1 → todo, con los mensajes, para descargar.
export async function GET(request: Request) {
  const by = await sessionEmail();
  if (!by) return json({ error: "Necesitas iniciar sesión." }, 401);
  const url = new URL(request.url);
  const email = (url.searchParams.get("email") ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return json({ error: "Escribe un email válido." }, 400);
  const exporting = url.searchParams.get("export") === "1";
  try {
    const db = createChatbotClient();
    const { sections, counts } = await collect(db, email, exporting);
    await log(db, email, exporting ? "exportacion" : "busqueda", by, counts);
    const { data: history } = await db.from("data_requests").select("action, requested_by, counts, note, created_at").ilike("email", likeExact(email)).order("created_at", { ascending: false }).limit(20);
    if (exporting) {
      const body = JSON.stringify({ email, exportado: new Date().toISOString(), responsable: "HOGARCONECTADO S.L. (Electrónica Vicente)", datos: sections }, null, 2);
      return new Response(body, { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="datos-${email.replace(/[^a-z0-9@._-]/g, "_")}.json"`, "Cache-Control": "no-store" } });
    }
    return json({ email, sections, counts, history: history ?? [] });
  } catch (caught) {
    return json({ error: errorMessage(caught, "No se pudieron buscar los datos.") }, 500);
  }
}

// Borra todo lo del email: registros con ese email y sus conversaciones (con sus mensajes). { email, confirm, note }.
export async function DELETE(request: Request) {
  const by = await sessionEmail();
  if (!by) return json({ error: "Necesitas iniciar sesión." }, 401);
  const body = (await request.json().catch(() => null)) as { email?: string; confirm?: string; note?: string } | null;
  const email = (body?.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return json({ error: "Email no válido." }, 400);
  if ((body?.confirm ?? "").trim().toLowerCase() !== email) return json({ error: "Para borrar, escribe el email otra vez como confirmación." }, 400);
  try {
    const db = createChatbotClient();
    const { counts, conversationIds } = await collect(db, email, false);
    // Primero las conversaciones (sus mensajes y verificaciones de pedido se borran en cascada), luego el resto.
    for (let i = 0; i < conversationIds.length; i += 100) {
      const { error } = await db.from("conversations").delete().in("id", conversationIds.slice(i, i + 100));
      if (error) throw error;
    }
    for (const source of BY_EMAIL) {
      const { error } = await db.from(source.table).delete().ilike("email", likeExact(email));
      if (error) throw error;
    }
    await log(db, email, "borrado", by, counts, body?.note);
    return json({ ok: true, deleted: counts });
  } catch (caught) {
    return json({ error: errorMessage(caught, "No se pudieron borrar los datos.") }, 500);
  }
}
