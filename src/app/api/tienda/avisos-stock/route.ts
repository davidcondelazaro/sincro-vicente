import { errorMessage, json, sessionEmail } from "@/lib/chatbot-api";
import { createChatbotClient } from "@/lib/chatbot-supabase";

export const dynamic = "force-dynamic";

// Avisos de stock (tabla stock_subscriptions del chatbot): clientes que esperan a que un producto vuelva a estar
// disponible. Vienen del chat o de la web; el envío lo hace el chatbot tras cada copia de productos.
const PAGE_SIZE = 50;
const STATUSES = ["pendiente", "avisado", "cancelado", "error"];

export async function GET(request: Request) {
  if (!(await sessionEmail())) return json({ error: "Necesitas iniciar sesión." }, 401);
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const source = url.searchParams.get("source");
  const search = (url.searchParams.get("search") ?? "").replace(/[,()*%\\]/g, " ").trim();
  const page = Math.max(0, Number(url.searchParams.get("page") ?? 0) || 0);
  try {
    const db = createChatbotClient();
    let query = db.from("stock_subscriptions")
      .select("id, product_id, variant_id, product_title, email, name, source, conversation_id, status, created_at, notified_at, cancelled_at, cancelled_by, last_error", { count: "exact" });
    if (status && STATUSES.includes(status)) query = query.eq("status", status);
    if (source === "chat" || source === "web" || source === "otro") query = query.eq("source", source);
    if (search) query = query.or(`email.ilike.*${search}*,product_title.ilike.*${search}*,name.ilike.*${search}*`);
    const [list, pending] = await Promise.all([
      query.order("created_at", { ascending: false }).range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1),
      db.from("stock_subscriptions").select("product_id, variant_id, product_title, status").in("status", ["pendiente", "avisado"]),
    ]);
    if (list.error) throw list.error;
    if (pending.error) throw pending.error;
    // Productos con más gente esperando (pendientes) y avisos enviados.
    const byProduct = new Map<string, { productId: number; title: string; waiting: number; notified: number }>();
    for (const row of pending.data ?? []) {
      const key = `${row.product_id}-${row.variant_id ?? 0}`;
      const item = byProduct.get(key) ?? { productId: row.product_id, title: row.product_title, waiting: 0, notified: 0 };
      if (row.status === "pendiente") item.waiting++; else item.notified++;
      byProduct.set(key, item);
    }
    const top = [...byProduct.values()].filter((item) => item.waiting > 0).sort((a, b) => b.waiting - a.waiting).slice(0, 10);
    const totals = {
      pending: (pending.data ?? []).filter((row) => row.status === "pendiente").length,
      notified: (pending.data ?? []).filter((row) => row.status === "avisado").length,
    };
    return json({ rows: list.data, total: list.count ?? 0, pageSize: PAGE_SIZE, top, totals });
  } catch (caught) {
    return json({ error: errorMessage(caught, "No se pudieron leer los avisos de stock.") }, 500);
  }
}

// Cancela un aviso pendiente: { id }.
export async function PUT(request: Request) {
  const email = await sessionEmail();
  if (!email) return json({ error: "Necesitas iniciar sesión." }, 401);
  const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) return json({ error: "Aviso no válido." }, 400);
  try {
    const { data, error } = await createChatbotClient().from("stock_subscriptions")
      .update({ status: "cancelado", cancelled_at: new Date().toISOString(), cancelled_by: email })
      .eq("id", id).eq("status", "pendiente").select("id, status, cancelled_at, cancelled_by").maybeSingle();
    if (error) throw error;
    if (!data) return json({ error: "Ese aviso ya no está pendiente." }, 409);
    return json({ subscription: data });
  } catch (caught) {
    return json({ error: errorMessage(caught, "No se pudo cancelar el aviso.") }, 500);
  }
}
