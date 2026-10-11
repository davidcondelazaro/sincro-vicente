"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { createClient } from "@/lib/supabase/client";

type Tab = "conversations" | "support" | "errors" | "syncs";
type Row = Record<string, unknown> & { id: string | number };
type Message = { id: number; role: "user" | "assistant" | "tool"; content: string | null; tool_calls: unknown; product_ids: number[] | null; model: string | null; input_tokens: number | null; output_tokens: number | null; latency_ms: number | null; channel: string | null; created_at: string };
type VoiceSession = { customer_name: string | null; page: { productHandle?: string; collectionHandle?: string } | null; started_at: string };
type Thread = { conversation: Row | null; voice: VoiceSession[]; messages: Message[]; support: Row[]; errors: Row[] };

const tabs: { key: Tab; label: string; placeholder: string }[] = [
  { key: "conversations", label: "Conversaciones", placeholder: "Cliente, palabra, pedido, email o página" },
  { key: "support", label: "Soporte", placeholder: "Nombre, email, pedido o texto" },
  { key: "errors", label: "Errores del widget", placeholder: "Tipo, mensaje o página" },
  { key: "syncs", label: "Sincronizaciones", placeholder: "Tipo o texto del error" },
];
const dateFormat = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "short" });
const supportStatus: Record<string, string> = { new: "Nueva", sent: "Enviada", error: "Error al enviar" };
const syncStatus: Record<string, string> = { running: "En curso", ok: "Correcta", error: "Error" };

export default function ChatbotPage() {
  const [tab, setTab] = useState<Tab>("conversations");
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ view: tab, page: String(page), search: query, from: dateFrom, to: dateTo });
      const response = await fetch(`/api/chatbot?${params}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "No se pudo leer el chatbot.");
      setRows(body.rows ?? []); setTotal(body.total ?? 0); setPageSize(body.pageSize ?? 25); setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo leer el chatbot.");
    } finally {
      setLoading(false);
    }
  }, [tab, page, query, dateFrom, dateTo]);

  // Espera a que se deje de escribir antes de buscar.
  useEffect(() => { const timer = setTimeout(() => setQuery(search.trim()), 300); return () => clearTimeout(timer); }, [search]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { createClient().auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null)); }, []);

  function select(next: Tab) { setTab(next); setPage(0); setSearch(""); setOpenId(null); }
  async function deleteError(id: string | number) {
    if (!window.confirm("¿Borrar este error del registro?")) return;
    const response = await fetch(`/api/chatbot?id=${id}`, { method: "DELETE" });
    const body = await response.json();
    if (!response.ok) { setError(body.error ?? "No se pudo borrar el error."); return; }
    void load();
  }

  const current = tabs.find((item) => item.key === tab)!;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return <div className="min-h-screen bg-zinc-50 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]"><AppSidebar active="chatbot" userEmail={email} /><main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 pb-24 pt-28 sm:px-10 lg:mx-0 lg:py-16">
    <header><h1 className="text-4xl font-semibold tracking-tight text-zinc-950">Chatbot</h1><p className="mt-3 max-w-3xl text-zinc-600">Conversaciones, peticiones de soporte, errores del widget e historial de sincronizaciones del chatbot de la tienda.</p></header>
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    <div className="flex flex-wrap gap-2">{tabs.map((item) => <button key={item.key} type="button" onClick={() => select(item.key)} className={`cursor-pointer rounded-lg px-4 py-2 text-sm font-medium ${tab === item.key ? "bg-emerald-700 text-white" : "border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"}`}>{item.label}</button>)}</div>
    <div className="flex flex-wrap items-end gap-3"><label className="text-sm font-medium text-zinc-700">Buscar<input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); setOpenId(null); }} className="mt-1 block h-10 w-80 max-w-full rounded-lg border border-zinc-300 bg-white px-3 font-normal" placeholder={current.placeholder} /></label><label className="text-sm font-medium text-zinc-700">Desde<input type="date" value={dateFrom} max={dateTo || undefined} onChange={(event) => { setDateFrom(event.target.value); setPage(0); setOpenId(null); }} className="mt-1 block h-10 rounded-lg border border-zinc-300 bg-white px-3 font-normal" /></label><label className="text-sm font-medium text-zinc-700">Hasta<input type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => { setDateTo(event.target.value); setPage(0); setOpenId(null); }} className="mt-1 block h-10 rounded-lg border border-zinc-300 bg-white px-3 font-normal" /></label>{(search || dateFrom || dateTo) && <button type="button" onClick={() => { setSearch(""); setDateFrom(""); setDateTo(""); setPage(0); setOpenId(null); }} className="h-10 cursor-pointer rounded-lg px-3 text-sm text-zinc-600 hover:bg-zinc-100">Limpiar</button>}<p className="ml-auto pb-2 text-sm text-zinc-500">{total.toLocaleString("es-ES")} registros</p></div>
    <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
      {loading && !rows.length ? <p className="p-5 text-sm text-zinc-500">Cargando…</p> : !rows.length ? <p className="p-5 text-sm text-zinc-500">No hay registros.</p> : <ul className="divide-y divide-zinc-100">{rows.map((row) => <Fragment key={String(row.id)}>
        {tab === "conversations" && <ConversationItem row={row} open={openId === row.id} onToggle={() => setOpenId(openId === row.id ? null : row.id)} />}
        {tab === "support" && <SupportItem row={row} />}
        {tab === "errors" && <ErrorItem row={row} onDelete={() => void deleteError(row.id)} />}
        {tab === "syncs" && <SyncItem row={row} />}
      </Fragment>)}</ul>}
    </section>
    {total > pageSize && <div className="flex items-center justify-between"><button type="button" disabled={!page} onClick={() => { setPage((value) => value - 1); setOpenId(null); }} className="cursor-pointer rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50">Anterior</button><span className="text-sm text-zinc-500">Página {page + 1} de {pages}</span><button type="button" disabled={page + 1 >= pages} onClick={() => { setPage((value) => value + 1); setOpenId(null); }} className="cursor-pointer rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50">Siguiente</button></div>}
  </main></div>;
}

function ConversationItem({ row, open, onToggle }: { row: Row; open: boolean; onToggle: () => void }) {
  return <li>
    <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full cursor-pointer items-start gap-4 px-5 py-3.5 text-left hover:bg-zinc-50">
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-sm ${row.summary ? "font-medium text-zinc-900" : "text-zinc-400 italic"}`}>{row.summary ? String(row.summary) : "Sin resumen todavía"}</span>
        <span className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-zinc-500"><span>{date(row.last_at)}</span><span>{Number(row.message_count ?? 0)} mensajes</span>{Boolean(row.customer_name) && <span className="font-medium text-zinc-700">{String(row.customer_name)}</span>}</span>
      </span>
      <span className="shrink-0 pt-0.5 text-sm font-medium text-emerald-700">{open ? "▼ Ocultar" : "▶ Ver"}</span>
    </button>
    {open && <ConversationThread id={String(row.id)} startedAt={row.started_at} />}
  </li>;
}

function ConversationThread({ id, startedAt }: { id: string; startedAt: unknown }) {
  const [thread, setThread] = useState<Thread | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch(`/api/chatbot?view=conversation&id=${encodeURIComponent(id)}`, { cache: "no-store" })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "No se pudo leer la conversación."); setThread(body); })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "No se pudo leer la conversación."));
  }, [id]);
  if (error) return <p className="border-t border-zinc-100 bg-red-50 px-5 py-4 text-sm text-red-800">{error}</p>;
  if (!thread) return <p className="border-t border-zinc-100 bg-zinc-50 px-5 py-4 text-sm text-zinc-500">Cargando conversación…</p>;
  const tokens = thread.messages.reduce((sum, message) => sum + (message.input_tokens ?? 0) + (message.output_tokens ?? 0), 0);
  const startPage = startingPage(thread);
  const customer = customerOf(thread);
  return <div className="border-t border-zinc-100 bg-zinc-50 px-5 py-5">
    <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      <div><dt className="text-xs font-medium text-zinc-500">Cliente</dt><dd className="mt-0.5 text-zinc-900">{customer ?? <span className="text-zinc-500">Sin nombre guardado</span>}</dd></div>
      <div className="min-w-0"><dt className="text-xs font-medium text-zinc-500">Página donde empezó</dt><dd className="mt-0.5 truncate">{startPage ? <a href={startPage} target="_blank" rel="noreferrer" title={startPage} className="text-emerald-700 hover:underline">{pagePath(startPage)}</a> : <span className="text-zinc-500">Desconocida</span>}</dd></div>
    </dl>
    <p className="mt-3 text-xs text-zinc-500">Iniciada {date(startedAt)} · {tokens.toLocaleString("es-ES")} tokens · <span className="font-mono">{id}</span></p>
    <div className="mt-4 flex flex-col gap-3">{thread.messages.map((message) => <MessageBubble key={message.id} message={message} />)}</div>
    {thread.support.length > 0 && <div className="mt-5"><h3 className="text-sm font-semibold text-zinc-800">Peticiones de soporte</h3><ul className="mt-2 divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white">{thread.support.map((row) => <SupportItem key={String(row.id)} row={row} />)}</ul></div>}
    {thread.errors.length > 0 && <div className="mt-5"><h3 className="text-sm font-semibold text-zinc-800">Errores del widget</h3><ul className="mt-2 divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white">{thread.errors.map((row) => <ErrorItem key={String(row.id)} row={row} />)}</ul></div>}
  </div>;
}

function MessageBubble({ message }: { message: Message }) {
  if (message.role === "tool") return <details className="max-w-3xl rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-600"><summary className="cursor-pointer font-medium">Resultado de herramienta · {time(message.created_at)}</summary><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words">{message.content}</pre></details>;
  const user = message.role === "user";
  const tools = toolNames(message.tool_calls);
  return <div className={`flex ${user ? "justify-end" : "justify-start"}`}><div className={`max-w-3xl rounded-2xl px-4 py-3 text-sm ${user ? "bg-emerald-700 text-white" : "border border-zinc-200 bg-white text-zinc-800"}`}>
    {message.content && <p className="whitespace-pre-wrap break-words">{bold(message.content)}</p>}
    {tools.length > 0 && <p className={`mt-1 text-xs ${user ? "text-emerald-100" : "text-zinc-500"}`}>Herramientas: {tools.join(", ")}</p>}
    <p className={`mt-1 text-xs ${user ? "text-emerald-100" : "text-zinc-400"}`}>{[time(message.created_at), message.channel === "voice" ? "voz" : null, message.product_ids?.length ? `${message.product_ids.length} productos` : null, message.model, message.latency_ms ? `${(message.latency_ms / 1000).toFixed(1)} s` : null].filter(Boolean).join(" · ")}</p>
  </div></div>;
}

function SupportItem({ row }: { row: Row }) {
  const status = String(row.status ?? "");
  return <li className="px-5 py-4 text-sm">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><span className="font-semibold text-zinc-900">{String(row.kind ?? "")}</span><span className="text-zinc-700">{String(row.name ?? "")}</span><a href={`mailto:${String(row.email ?? "")}`} className="text-emerald-700 hover:underline">{String(row.email ?? "")}</a>{Boolean(row.phone) && <span className="text-zinc-600">{String(row.phone)}</span>}{Boolean(row.order_number) && <span className="text-zinc-600">Pedido {String(row.order_number)}</span>}<Badge tone={status === "error" ? "red" : status === "sent" ? "green" : "amber"}>{supportStatus[status] ?? status}</Badge><time className="ml-auto text-zinc-400">{date(row.created_at)}</time></div>
    <p className="mt-2 whitespace-pre-wrap text-zinc-700">{String(row.description ?? "")}</p>
  </li>;
}

function ErrorItem({ row, onDelete }: { row: Row; onDelete?: () => void }) {
  const context = row.context && typeof row.context === "object" && Object.keys(row.context).length ? row.context : null;
  return <li className="px-5 py-4 text-sm">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><Badge tone="red">{String(row.kind ?? "")}</Badge><span className="min-w-0 truncate text-zinc-500" title={String(row.page_url ?? "")}>{pagePath(row.page_url)}</span><time className="ml-auto text-zinc-400">{date(row.created_at)}</time>{onDelete && <button type="button" onClick={onDelete} className="cursor-pointer rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-red-50 hover:text-red-700">Borrar</button>}</div>
    <p className="mt-2 break-words text-zinc-800">{String(row.message ?? "")}</p>
    {context && <details className="mt-2 rounded-lg bg-zinc-50 p-2 text-xs"><summary className="cursor-pointer font-medium text-zinc-700">Contexto</summary><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-zinc-600">{JSON.stringify(context, null, 2)}</pre></details>}
  </li>;
}

function SyncItem({ row }: { row: Row }) {
  const status = String(row.status ?? "");
  const stats = row.stats && typeof row.stats === "object" ? Object.entries(row.stats as Record<string, unknown>) : [];
  return <li className="px-5 py-4 text-sm">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><span className="font-semibold text-zinc-900">{String(row.kind ?? "")}</span><Badge tone={status === "error" ? "red" : status === "ok" ? "green" : "amber"}>{syncStatus[status] ?? status}</Badge><span className="text-zinc-500">{date(row.started_at)}{row.finished_at ? ` · ${duration(row.started_at, row.finished_at)}` : ""}</span></div>
    {stats.length > 0 && <p className="mt-2 text-zinc-600">{stats.map(([key, value]) => `${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`).join(" · ")}</p>}
    {Boolean(row.error) && <p className="mt-2 break-words text-red-700">{String(row.error)}</p>}
  </li>;
}

function Badge({ tone, children }: { tone: "green" | "amber" | "red"; children: React.ReactNode }) {
  const tones = { green: "bg-emerald-50 text-emerald-800", amber: "bg-amber-50 text-amber-800", red: "bg-red-50 text-red-800" };
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

function date(value: unknown) {
  const parsed = new Date(String(value ?? ""));
  return Number.isNaN(parsed.getTime()) ? "—" : dateFormat.format(parsed);
}

function time(value: string) {
  return new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", timeStyle: "short" }).format(new Date(value));
}

function duration(start: unknown, end: unknown) {
  const seconds = Math.round((new Date(String(end)).getTime() - new Date(String(start)).getTime()) / 1000);
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

// Las conversaciones de texto guardan la URL; las de voz, solo el producto o la colección abiertos.
function startingPage(thread: Thread) {
  if (thread.conversation?.page_url) return String(thread.conversation.page_url);
  const page = thread.voice.find((session) => session.page?.productHandle || session.page?.collectionHandle)?.page;
  if (page?.productHandle) return `https://electronica-vicente.myshopify.com/products/${page.productHandle}`;
  if (page?.collectionHandle) return `https://electronica-vicente.myshopify.com/collections/${page.collectionHandle}`;
  return null;
}

// Nombre del cliente con sesión iniciada (chat de texto o voz); si no, el que dio en una petición de soporte.
function customerOf(thread: Thread) {
  const textName = (thread.conversation?.metadata as { customer_name?: string | null } | null)?.customer_name;
  if (textName) return textName;
  const voiceName = thread.voice.find((session) => session.customer_name)?.customer_name;
  if (voiceName) return voiceName;
  const request = thread.support[0];
  if (request) return `${String(request.name ?? "")} · ${String(request.email ?? "")} (soporte)`;
  return null;
}

function pagePath(value: unknown) {
  if (!value) return "Página desconocida";
  try { const url = new URL(String(value)); return url.pathname === "/" ? url.host : url.pathname; } catch { return String(value); }
}

// El bot responde en Markdown; aquí solo se muestran las negritas.
function bold(text: string) {
  return text.split(/\*\*(.+?)\*\*/g).map((part, index) => index % 2 ? <strong key={index}>{part}</strong> : part);
}

function toolNames(calls: unknown) {
  if (!Array.isArray(calls)) return [];
  return calls.map((call) => (call as { name?: string; function?: { name?: string } })?.name ?? (call as { function?: { name?: string } })?.function?.name).filter((name): name is string => Boolean(name));
}
