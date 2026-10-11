import { CronExpressionParser } from "cron-parser";
import { errorMessage, json, sessionEmail } from "@/lib/chatbot-api";
import { createChatbotClient } from "@/lib/chatbot-supabase";

export const dynamic = "force-dynamic";

// Sincronizaciones del chatbot: estado y programación (tabla sync_schedules) y lanzamiento a mano
// (ruta /api/admin/sync del chatbot, protegida con CHATBOT_ADMIN_SECRET).
const KINDS = ["collections", "products", "embeddings", "content"] as const;
type Kind = (typeof KINDS)[number];
const isKind = (value: unknown): value is Kind => KINDS.includes(value as Kind);
const TIMEZONE = "Europe/Madrid";
const STALE_MINUTES = 20;

function nextRun(cron: string) {
  try { return CronExpressionParser.parse(cron, { tz: TIMEZONE }).next().toDate().toISOString(); } catch { return null; }
}

export async function GET() {
  if (!(await sessionEmail())) return json({ error: "Necesitas iniciar sesión." }, 401);
  try {
    const db = createChatbotClient();
    const { data: schedules, error } = await db.from("sync_schedules").select("kind, cron, enabled, updated_at, updated_by");
    if (error) throw error;
    const staleSince = Date.now() - STALE_MINUTES * 60_000;
    const kinds = await Promise.all(KINDS.map(async (kind) => {
      const { data: last, error: lastError } = await db.from("sync_runs").select("id, started_at, finished_at, status, error").eq("kind", kind).order("started_at", { ascending: false }).limit(1).maybeSingle();
      if (lastError) throw lastError;
      const schedule = schedules?.find((row) => row.kind === kind) ?? null;
      const running = last?.status === "running" && new Date(last.started_at).getTime() >= staleSince;
      return { kind, schedule, last, running, next: schedule?.enabled ? nextRun(schedule.cron) : null };
    }));
    return json({ kinds });
  } catch (caught) {
    return json({ error: errorMessage(caught, "No se pudo leer el estado de las sincronizaciones.") }, 500);
  }
}

// Guarda la programación de un tipo: { kind, cron, enabled }.
export async function PUT(request: Request) {
  const email = await sessionEmail();
  if (!email) return json({ error: "Necesitas iniciar sesión." }, 401);
  const body = (await request.json().catch(() => null)) as { kind?: unknown; cron?: unknown; enabled?: unknown } | null;
  if (!isKind(body?.kind)) return json({ error: "Tipo de sincronización no válido." }, 400);
  const cron = typeof body.cron === "string" ? body.cron.trim().replace(/\s+/g, " ") : "";
  if (cron.split(" ").length !== 5 || !nextRun(cron)) return json({ error: "La expresión cron no es válida. Usa 5 campos: minuto hora día mes día-de-la-semana." }, 400);
  try {
    const { error } = await createChatbotClient().from("sync_schedules")
      .upsert({ kind: body.kind, cron, enabled: body.enabled === true, updated_at: new Date().toISOString(), updated_by: email });
    if (error) throw error;
    return json({ ok: true, next: body.enabled === true ? nextRun(cron) : null });
  } catch (caught) {
    return json({ error: errorMessage(caught, "No se pudo guardar la programación.") }, 500);
  }
}

// Lanza una sincronización ahora: { kind } con un tipo o "all" (todas en orden).
export async function POST(request: Request) {
  if (!(await sessionEmail())) return json({ error: "Necesitas iniciar sesión." }, 401);
  const body = (await request.json().catch(() => null)) as { kind?: unknown } | null;
  if (body?.kind !== "all" && !isKind(body?.kind)) return json({ error: "Tipo de sincronización no válido." }, 400);
  const secret = process.env.CHATBOT_ADMIN_SECRET;
  if (!secret) return json({ error: "Falta la variable CHATBOT_ADMIN_SECRET." }, 500);
  const baseUrl = process.env.CHATBOT_URL ?? "https://chatbot-vicente.vercel.app";
  try {
    const response = await fetch(`${baseUrl}/api/admin/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ kind: body.kind }),
      cache: "no-store",
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return json({ error: result.error ?? `El chatbot respondió ${response.status}.` }, response.status);
    return json(result, 202);
  } catch (caught) {
    return json({ error: errorMessage(caught, "No se pudo contactar con el chatbot.") }, 502);
  }
}
