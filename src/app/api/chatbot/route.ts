import { createChatbotClient } from "@/lib/chatbot-supabase";
import { errorMessage, json, sessionEmail } from "@/lib/chatbot-api";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
type Row = Record<string, unknown>;
type View = "conversations" | "conversation" | "support" | "errors" | "syncs" | "stats";
const ANALYSIS_FILTERS = { sentiment: ["positivo", "neutro", "negativo", "frustrado"], outcome: ["resuelta", "parcial", "no_resuelta", "abandonada"], topic: ["eleccion", "info_producto", "envio", "postventa", "garantia_instalacion", "otro"] } as const;
const pick = (value: string | null, allowed: readonly string[]) => (value && allowed.includes(value) ? value : null);

// Quita los caracteres con significado en los filtros de PostgREST (or=, comas, paréntesis).
function term(value: string | null) {
  return (value ?? "").replace(/[,()*%\\]/g, " ").trim();
}

// Fotos y PDF que el cliente adjuntó (tabla attachments del chatbot), con enlaces firmados: el bucket `adjuntos` es privado.
// Solo los enviados con un mensaje; los demás el chatbot los borra al día.
const ATTACHMENT_COLUMNS = "id, conversation_id, message_id, support_request_id, path, mime, bytes, width, height, filename, created_at";
async function signedAttachments(db: ReturnType<typeof createChatbotClient>, column: "conversation_id" | "support_request_id", values: (string | number)[]) {
  if (!values.length) return [];
  const { data, error } = await db.from("attachments").select(ATTACHMENT_COLUMNS).in(column, values).not("message_id", "is", null).order("created_at");
  if (error) throw error;
  if (!data?.length) return [];
  const { data: signed, error: signError } = await db.storage.from("adjuntos").createSignedUrls(data.map((row) => row.path), 3600);
  if (signError) throw signError;
  const urlOf = new Map((signed ?? []).map((item) => [item.path, item.signedUrl]));
  return data.map(({ path, ...row }) => ({ ...row, url: urlOf.get(path) ?? null }));
}

// Inicio del día (yyyy-mm-dd) en hora de Madrid, como instante ISO.
function madridDayStart(day: string | null, addDays = 0) {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + addDays);
  const iso = date.toISOString().slice(0, 10);
  const offset = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Madrid", timeZoneName: "longOffset" }).formatToParts(date).find((part) => part.type === "timeZoneName")?.value.match(/[+-]\d{2}:\d{2}/)?.[0] ?? "Z";
  return new Date(`${iso}T00:00:00${offset}`).toISOString();
}

export async function GET(request: Request) {
  if (!(await sessionEmail())) return json({ error: "Necesitas iniciar sesión." }, 401);
  const url = new URL(request.url);
  const view = (url.searchParams.get("view") ?? "conversations") as View;
  const page = Math.max(0, Number(url.searchParams.get("page") ?? 0) || 0);
  const search = term(url.searchParams.get("search"));
  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  // Filtro de fechas: desde el inicio del día "desde" hasta el final del día "hasta", en hora de Madrid.
  const since = madridDayStart(url.searchParams.get("from"));
  const until = madridDayStart(url.searchParams.get("to"), 1);

  try {
    const db = createChatbotClient();

    if (view === "conversation") {
      const id = url.searchParams.get("id");
      if (!id) return json({ error: "Falta la conversación." }, 400);
      const [conversation, voice, messages, support, errors] = await Promise.all([
        db.from("conversations").select("id, started_at, last_at, page_url, metadata, summary, sentiment, outcome, topic, needs_review, review_reason, quality_rating, quality_issues, reviewed_at").eq("id", id).maybeSingle(),
        db.from("voice_sessions").select("customer_name, page, started_at").eq("conversation_id", id).order("started_at"),
        db.from("messages").select("id, role, content, tool_calls, product_ids, model, input_tokens, output_tokens, latency_ms, channel, created_at").eq("conversation_id", id).order("id"),
        db.from("support_requests").select("id, kind, name, email, phone, order_number, description, status, created_at").eq("conversation_id", id).order("created_at"),
        db.from("widget_errors").select("id, kind, message, context, page_url, created_at").eq("conversation_id", id).order("created_at"),
      ]);
      const failed = conversation.error ?? voice.error ?? messages.error ?? support.error ?? errors.error;
      if (failed) throw failed;
      const attachments = await signedAttachments(db, "conversation_id", [id]);
      // Pedidos atribuidos a la conversación (vista attributed_orders del chatbot).
      const { data: attributed, error: attributedError } = await db.from("attributed_orders").select("order_id, attribution").eq("conversation_id", id);
      if (attributedError) throw attributedError;
      const { data: orders, error: ordersError } = attributed?.length
        ? await db.from("shop_orders").select("id, name, created_at, total, refunded, currency, line_items").in("id", attributed.map((row) => row.order_id)).order("created_at")
        : { data: [], error: null };
      if (ordersError) throw ordersError;
      const attributionOf = new Map((attributed ?? []).map((row) => [row.order_id, row.attribution]));
      // Uso del email del cliente en esta conversación: consentimientos, avisos de stock y envíos de productos.
      const [consents, subscriptions, sentEmails] = await Promise.all([
        db.from("consents").select("id, purpose, email, text_version, status, created_at, decided_at").eq("conversation_id", id).order("created_at"),
        db.from("stock_subscriptions").select("id, product_title, email, status, created_at, notified_at").eq("conversation_id", id).order("created_at"),
        db.from("customer_emails").select("id, email, kind, product_ids, created_at").eq("conversation_id", id).order("created_at"),
      ]);
      return json({
        consents: consents.data ?? [], subscriptions: subscriptions.data ?? [], sentEmails: sentEmails.data ?? [], attachments, conversation: conversation.data, voice: voice.data, messages: messages.data, support: support.data, errors: errors.data, orders: (orders ?? []).map((order) => ({ ...order, attribution: attributionOf.get(order.id) })) });
    }

    if (view === "stats") {
      const [{ data, error }, alerts] = await Promise.all([
        db.rpc("admin_conversation_stats", { p_from: since, p_to: until }),
        db.rpc("admin_alert_stats", { p_from: since, p_to: until }),
      ]);
      if (error) throw error;
      if (alerts.error) throw alerts.error;
      return json({ stats: { ...data, alerts: alerts.data } });
    }

    if (view === "support") {
      let query = db.from("support_requests").select("id, conversation_id, kind, name, email, phone, order_number, description, status, sent_at, created_at", { count: "exact" });
      // ?id=<n>: una petición concreta (enlace desde la conversación que la originó).
      const requestId = Number(url.searchParams.get("id"));
      if (Number.isInteger(requestId) && requestId > 0) query = query.eq("id", requestId);
      if (search) query = query.or(`name.ilike.*${search}*,email.ilike.*${search}*,order_number.ilike.*${search}*,description.ilike.*${search}*`);
      if (since) query = query.gte("created_at", since);
      if (until) query = query.lt("created_at", until);
      const { data, count, error } = await query.order("created_at", { ascending: false }).range(from, to);
      if (error) throw error;
      const attachments = await signedAttachments(db, "support_request_id", (data ?? []).map((row) => row.id));
      const rows = (data ?? []).map((row) => ({ ...row, attachments: attachments.filter((item) => item.support_request_id === row.id) }));
      return json({ rows, total: count ?? 0, pageSize: PAGE_SIZE });
    }

    if (view === "errors") {
      let query = db.from("widget_errors").select("id, conversation_id, kind, message, context, page_url, created_at", { count: "exact" });
      if (search) query = query.or(`kind.ilike.*${search}*,message.ilike.*${search}*,page_url.ilike.*${search}*`);
      if (since) query = query.gte("created_at", since);
      if (until) query = query.lt("created_at", until);
      const { data, count, error } = await query.order("created_at", { ascending: false }).range(from, to);
      if (error) throw error;
      return json({ rows: data, total: count ?? 0, pageSize: PAGE_SIZE });
    }

    if (view === "syncs") {
      let query = db.from("sync_runs").select("id, kind, started_at, finished_at, status, stats, error", { count: "exact" });
      if (search) query = query.or(`kind.ilike.*${search}*,error.ilike.*${search}*`);
      if (since) query = query.gte("started_at", since);
      if (until) query = query.lt("started_at", until);
      const { data, count, error } = await query.order("started_at", { ascending: false }).range(from, to);
      if (error) throw error;
      return json({ rows: data, total: count ?? 0, pageSize: PAGE_SIZE });
    }

    // Busca en cliente, mensajes, soporte y página (función admin_search_conversations del chatbot).
    const review = url.searchParams.get("review");
    const { data, error } = await db.rpc("admin_search_conversations", {
      p_search: search || null, p_from: since, p_to: until, p_limit: PAGE_SIZE, p_offset: from,
      p_sentiment: pick(url.searchParams.get("sentiment"), ANALYSIS_FILTERS.sentiment),
      p_outcome: pick(url.searchParams.get("outcome"), ANALYSIS_FILTERS.outcome),
      p_topic: pick(url.searchParams.get("topic"), ANALYSIS_FILTERS.topic),
      p_needs_review: review === "1" ? true : null,
      p_with_issues: url.searchParams.get("issues") === "1" ? true : null,
      p_with_guard: url.searchParams.get("guard") === "1" ? true : null,
      p_with_order: url.searchParams.get("order") === "1" ? true : null,
      p_with_attachments: url.searchParams.get("attachments") === "1" ? true : null,
    });
    if (error) throw error;
    const rows = (data ?? []) as (Row & { total: number })[];
    return json({ rows, total: Number(rows[0]?.total ?? 0), pageSize: PAGE_SIZE });
  } catch (caught) {
    return json({ error: errorMessage(caught, "No se pudo consultar el Supabase del chatbot.") }, 500);
  }
}

export async function DELETE(request: Request) {
  if (!(await sessionEmail())) return json({ error: "Necesitas iniciar sesión." }, 401);
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return json({ error: "Falta el error a borrar." }, 400);
  try {
    const { error } = await createChatbotClient().from("widget_errors").delete().eq("id", id);
    if (error) throw error;
    return json({ ok: true });
  } catch (caught) {
    return json({ error: errorMessage(caught, "No se pudo borrar el error.") }, 500);
  }
}
