import { createChatbotClient } from "@/lib/chatbot-supabase";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
type View = "conversations" | "conversation" | "support" | "errors" | "syncs";

async function signedIn() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return Boolean(data?.claims.sub);
}

// Quita los caracteres con significado en los filtros de PostgREST (or=, comas, paréntesis).
function term(value: string | null) {
  return (value ?? "").replace(/[,()*%\\]/g, " ").trim();
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  if (!(await signedIn())) return json({ error: "Necesitas iniciar sesión." }, 401);
  const url = new URL(request.url);
  const view = (url.searchParams.get("view") ?? "conversations") as View;
  const page = Math.max(0, Number(url.searchParams.get("page") ?? 0) || 0);
  const search = term(url.searchParams.get("search"));
  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  try {
    const db = createChatbotClient();

    if (view === "conversation") {
      const id = url.searchParams.get("id");
      if (!id) return json({ error: "Falta la conversación." }, 400);
      const [messages, support, errors] = await Promise.all([
        db.from("messages").select("id, role, content, tool_calls, product_ids, model, input_tokens, output_tokens, latency_ms, channel, created_at").eq("conversation_id", id).order("id"),
        db.from("support_requests").select("id, kind, name, email, phone, order_number, description, status, created_at").eq("conversation_id", id).order("created_at"),
        db.from("widget_errors").select("id, kind, message, context, page_url, created_at").eq("conversation_id", id).order("created_at"),
      ]);
      const failed = messages.error ?? support.error ?? errors.error;
      if (failed) throw failed;
      return json({ messages: messages.data, support: support.data, errors: errors.data });
    }

    if (view === "support") {
      let query = db.from("support_requests").select("id, conversation_id, kind, name, email, phone, order_number, description, status, sent_at, created_at", { count: "exact" });
      if (search) query = query.or(`name.ilike.*${search}*,email.ilike.*${search}*,order_number.ilike.*${search}*,description.ilike.*${search}*`);
      const { data, count, error } = await query.order("created_at", { ascending: false }).range(from, to);
      if (error) throw error;
      return json({ rows: data, total: count ?? 0, pageSize: PAGE_SIZE });
    }

    if (view === "errors") {
      let query = db.from("widget_errors").select("id, conversation_id, kind, message, context, page_url, created_at", { count: "exact" });
      if (search) query = query.or(`kind.ilike.*${search}*,message.ilike.*${search}*,page_url.ilike.*${search}*`);
      const { data, count, error } = await query.order("created_at", { ascending: false }).range(from, to);
      if (error) throw error;
      return json({ rows: data, total: count ?? 0, pageSize: PAGE_SIZE });
    }

    if (view === "syncs") {
      let query = db.from("sync_runs").select("id, kind, started_at, finished_at, status, stats, error", { count: "exact" });
      if (search) query = query.ilike("kind", `%${search}%`);
      const { data, count, error } = await query.order("started_at", { ascending: false }).range(from, to);
      if (error) throw error;
      return json({ rows: data, total: count ?? 0, pageSize: PAGE_SIZE });
    }

    let query = db.from("conversations").select("id, started_at, last_at, page_url, metadata, messages(count)", { count: "exact" });
    if (search) query = query.ilike("page_url", `%${search}%`);
    const { data, count, error } = await query.order("last_at", { ascending: false }).range(from, to);
    if (error) throw error;
    const rows = (data ?? []).map(({ messages, ...row }) => ({ ...row, message_count: (messages as { count: number }[] | null)?.[0]?.count ?? 0 }));
    return json({ rows, total: count ?? 0, pageSize: PAGE_SIZE });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : (caught as { message?: string })?.message;
    return json({ error: message ?? "No se pudo consultar el Supabase del chatbot." }, 500);
  }
}

export async function DELETE(request: Request) {
  if (!(await signedIn())) return json({ error: "Necesitas iniciar sesión." }, 401);
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return json({ error: "Falta el error a borrar." }, 400);
  try {
    const { error } = await createChatbotClient().from("widget_errors").delete().eq("id", id);
    if (error) throw error;
    return json({ ok: true });
  } catch (caught) {
    return json({ error: (caught as { message?: string })?.message ?? "No se pudo borrar el error." }, 500);
  }
}
