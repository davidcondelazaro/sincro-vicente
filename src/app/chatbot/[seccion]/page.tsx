"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { notFound, useParams } from "next/navigation";
import { AppSidebar } from "@/components/app-sidebar";
import { ChatbotSettings } from "@/components/chatbot-settings";
import { ChatbotSyncPanel } from "@/components/chatbot-sync-panel";
import { createClient } from "@/lib/supabase/client";
import { outcomeLabels, sentimentLabels, sentimentTones, topicLabels } from "@/lib/chatbot-labels";
import { ChatbotStats } from "@/components/chatbot-stats";
import { ChatbotImprovements } from "@/components/chatbot-improvements";

type Tab = "stats" | "conversations" | "improvements" | "support" | "errors" | "syncs" | "settings";
type Row = Record<string, unknown> & { id: string | number };
type Message = { id: number; role: "user" | "assistant" | "tool"; content: string | null; tool_calls: unknown; product_ids: number[] | null; model: string | null; input_tokens: number | null; output_tokens: number | null; latency_ms: number | null; channel: string | null; created_at: string };
type VoiceSession = { customer_name: string | null; page: { productHandle?: string; collectionHandle?: string } | null; started_at: string };
type AttributedOrder = { id: number; name: string; created_at: string; total: number; refunded: number; currency: string; attribution: string; line_items: { title: string; quantity: number }[] };
type Thread = { conversation: Row | null; voice: VoiceSession[]; messages: Message[]; support: Row[]; errors: Row[]; orders?: AttributedOrder[] };

// Sub-apartados de Chatbot IA: /chatbot/<slug>, cada uno con su entrada en el menú lateral.
const tabs: { slug: string; key: Tab; label: string; description: string; placeholder: string; sidebar: "chatbotStats" | "chatbotConversations" | "chatbotImprovements" | "chatbotSupport" | "chatbotErrors" | "chatbotSyncs" | "chatbotSettings" }[] = [
  { slug: "estadisticas", key: "stats", label: "Estadísticas", description: "Indicadores de uso y resultado de las conversaciones del chatbot.", placeholder: "", sidebar: "chatbotStats" },
  { slug: "conversaciones", key: "conversations", label: "Conversaciones", description: "Conversaciones de los clientes con el chatbot de la tienda, por texto o por voz.", placeholder: "Cliente, palabra, pedido, email o página", sidebar: "chatbotConversations" },
  { slug: "mejoras", key: "improvements", label: "Mejoras", description: "Fallos del chatbot que encuentra la revisión automática de cada conversación, agrupados en propuestas para mejorar sus instrucciones.", placeholder: "", sidebar: "chatbotImprovements" },
  { slug: "soporte", key: "support", label: "Soporte", description: "Incidencias, reclamaciones y devoluciones que los clientes abren desde el chatbot.", placeholder: "Nombre, email, pedido o texto", sidebar: "chatbotSupport" },
  { slug: "errores", key: "errors", label: "Errores del widget", description: "Fallos técnicos del widget en la tienda (carrito, conexión…).", placeholder: "Tipo, mensaje o página", sidebar: "chatbotErrors" },
  { slug: "sincronizaciones", key: "syncs", label: "Sincronizaciones", description: "Copia del catálogo y del contenido de Shopify en el chatbot: lanzarlas a mano, programarlas e historial.", placeholder: "Tipo o texto del error", sidebar: "chatbotSyncs" },
  { slug: "configuracion", key: "settings", label: "Configuración", description: "Datos de contacto que usa el chatbot. Los cambios se aplican en el chatbot en menos de un minuto.", placeholder: "", sidebar: "chatbotSettings" },
];
const dateFormat = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "short" });
const supportStatus: Record<string, string> = { new: "Nueva", sent: "Enviada", error: "Error al enviar" };
const syncStatus: Record<string, string> = { running: "En curso", ok: "Correcta", error: "Error" };

export default function ChatbotPage() {
  const { seccion } = useParams<{ seccion: string }>();
  const current = tabs.find((item) => item.slug === seccion);
  if (!current) notFound();
  const tab = current.key;
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [analysis, setAnalysis] = useState({ sentiment: "", outcome: "", topic: "", review: "", issues: "", guard: "", order: "" });
  // Enlace directo a una conversación (?conversacion=<id>), por ejemplo desde Mejoras.
  const [focusId, setFocusId] = useState<string | null>(null);
  useEffect(() => { setFocusId(new URLSearchParams(window.location.search).get("conversacion")); }, []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | number | null>(null);

  const load = useCallback(async () => {
    if (tab === "settings" || tab === "stats" || tab === "improvements") return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ view: tab, page: String(page), search: query, from: dateFrom, to: dateTo, ...(tab === "conversations" ? analysis : {}) });
      const response = await fetch(`/api/chatbot?${params}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "No se pudo leer el chatbot.");
      setRows(body.rows ?? []); setTotal(body.total ?? 0); setPageSize(body.pageSize ?? 25); setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo leer el chatbot.");
    } finally {
      setLoading(false);
    }
  }, [tab, page, query, dateFrom, dateTo, analysis]);

  // Espera a que se deje de escribir antes de buscar.
  useEffect(() => { const timer = setTimeout(() => setQuery(search.trim()), 300); return () => clearTimeout(timer); }, [search]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { createClient().auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null)); }, []);

  async function deleteError(id: string | number) {
    if (!window.confirm("¿Borrar este error del registro?")) return;
    const response = await fetch(`/api/chatbot?id=${id}`, { method: "DELETE" });
    const body = await response.json();
    if (!response.ok) { setError(body.error ?? "No se pudo borrar el error."); return; }
    void load();
  }

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return <div className="min-h-screen bg-zinc-50 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]"><AppSidebar active={current.sidebar} userEmail={email} /><main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 pb-24 pt-28 sm:px-10 lg:mx-0 lg:py-16">
    <header><p className="text-sm font-semibold tracking-[0.18em] text-emerald-700 uppercase">Chatbot IA</p><h1 className="mt-2 text-4xl font-semibold tracking-tight text-zinc-950">{current.label}</h1><p className="mt-3 max-w-3xl text-zinc-600">{current.description}</p></header>
    {tab === "settings" ? <ChatbotSettings /> : tab === "stats" ? <ChatbotStats /> : tab === "improvements" ? <ChatbotImprovements /> : <>
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    {tab === "conversations" && focusId && <section className="overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-sm"><div className="flex items-center justify-between px-5 py-3"><h2 className="text-sm font-semibold text-zinc-900">Conversación enlazada</h2><button type="button" onClick={() => { setFocusId(null); window.history.replaceState(null, "", window.location.pathname); }} className="cursor-pointer rounded-md px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100">Cerrar</button></div><ConversationThread id={focusId} startedAt={null} /></section>}
    {tab === "syncs" && <><ChatbotSyncPanel onChange={load} /><h2 className="mt-2 text-xl font-semibold text-zinc-900">Historial</h2></>}
    <div className="flex flex-wrap items-end gap-3"><label className="text-sm font-medium text-zinc-700">Buscar<input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); setOpenId(null); }} className="mt-1 block h-10 w-80 max-w-full rounded-lg border border-zinc-300 bg-white px-3 font-normal" placeholder={current.placeholder} /></label><label className="text-sm font-medium text-zinc-700">Desde<input type="date" value={dateFrom} max={dateTo || undefined} onChange={(event) => { setDateFrom(event.target.value); setPage(0); setOpenId(null); }} className="mt-1 block h-10 rounded-lg border border-zinc-300 bg-white px-3 font-normal" /></label><label className="text-sm font-medium text-zinc-700">Hasta<input type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => { setDateTo(event.target.value); setPage(0); setOpenId(null); }} className="mt-1 block h-10 rounded-lg border border-zinc-300 bg-white px-3 font-normal" /></label>{tab === "conversations" && <AnalysisFilters value={analysis} onChange={(next) => { setAnalysis(next); setPage(0); setOpenId(null); }} />}{(search || dateFrom || dateTo || Object.values(analysis).some(Boolean)) && <button type="button" onClick={() => { setSearch(""); setDateFrom(""); setDateTo(""); setAnalysis({ sentiment: "", outcome: "", topic: "", review: "", issues: "", guard: "", order: "" }); setPage(0); setOpenId(null); }} className="h-10 cursor-pointer rounded-lg px-3 text-sm text-zinc-600 hover:bg-zinc-100">Limpiar</button>}<p className="ml-auto pb-2 text-sm text-zinc-500">{total.toLocaleString("es-ES")} registros</p></div>
    <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
      {loading && !rows.length ? <p className="p-5 text-sm text-zinc-500">Cargando…</p> : !rows.length ? <p className="p-5 text-sm text-zinc-500">No hay registros.</p> : <ul className="divide-y divide-zinc-100">{rows.map((row) => <Fragment key={String(row.id)}>
        {tab === "conversations" && <ConversationItem row={row} open={openId === row.id} onToggle={() => setOpenId(openId === row.id ? null : row.id)} />}
        {tab === "support" && <SupportItem row={row} />}
        {tab === "errors" && <ErrorItem row={row} onDelete={() => void deleteError(row.id)} />}
        {tab === "syncs" && <SyncItem row={row} />}
      </Fragment>)}</ul>}
    </section>
    {total > pageSize && <div className="flex items-center justify-between"><button type="button" disabled={!page} onClick={() => { setPage((value) => value - 1); setOpenId(null); }} className="cursor-pointer rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50">Anterior</button><span className="text-sm text-zinc-500">Página {page + 1} de {pages}</span><button type="button" disabled={page + 1 >= pages} onClick={() => { setPage((value) => value + 1); setOpenId(null); }} className="cursor-pointer rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50">Siguiente</button></div>}
    </>}
  </main></div>;
}

type AnalysisFilter = { sentiment: string; outcome: string; topic: string; review: string; issues: string; guard: string; order: string };
type QualityIssue = { type: string; severity: string; quote: string; explanation: string; suggestion: string };
const issueTypeLabels: Record<string, string> = { dato_erroneo: "Dato erróneo", dato_no_respaldado: "Dato no respaldado", no_entendio: "No entendió", herramienta: "Herramienta", regla_incumplida: "Regla incumplida", derivacion: "Derivación", tono: "Tono", otro: "Otro" };
const ratingLabels: Record<string, string> = { bien: "Bien", mejorable: "Mejorable", mal: "Mal" };

function QualityReview({ rating, issues }: { rating: string; issues: QualityIssue[] }) {
  return <div className="mb-4 rounded-xl border border-zinc-200 bg-white p-3 text-sm">
    <p><span className="text-zinc-500">Revisión de calidad:</span> <span className={`font-medium ${rating === "mal" ? "text-red-700" : rating === "mejorable" ? "text-amber-700" : "text-emerald-700"}`}>{ratingLabels[rating] ?? rating}</span>{issues.length === 0 && <span className="text-zinc-500"> · sin fallos</span>}</p>
    {issues.length > 0 && <ul className="mt-2 flex flex-col gap-2">{issues.map((issue, index) => <li key={index} className="rounded-lg bg-zinc-50 p-2.5">
      <p className="flex flex-wrap items-center gap-2"><Badge tone={issue.severity === "alta" ? "red" : issue.severity === "media" ? "amber" : "green"}>{issueTypeLabels[issue.type] ?? issue.type} · {issue.severity}</Badge></p>
      <p className="mt-1.5 text-zinc-800">«{issue.quote}»</p>
      <p className="mt-1 text-zinc-600">{issue.explanation}</p>
      <p className="mt-1 text-zinc-600"><span className="font-medium text-zinc-700">Debió:</span> {issue.suggestion}</p>
    </li>)}</ul>}
    <p className="mt-2 text-xs text-zinc-500">Revisión automática con un modelo más potente que el del chatbot; orientativa.</p>
  </div>;
}

function AnalysisFilters({ value, onChange }: { value: AnalysisFilter; onChange: (next: AnalysisFilter) => void }) {
  const select = "mt-1 block h-10 rounded-lg border border-zinc-300 bg-white px-2 font-normal";
  const options = (labels: Record<string, string>) => Object.entries(labels).map(([key, text]) => <option key={key} value={key}>{text}</option>);
  return <>
    <label className="text-sm font-medium text-zinc-700">Sentimiento<select value={value.sentiment} onChange={(event) => onChange({ ...value, sentiment: event.target.value })} className={select}><option value="">Todos</option>{options(sentimentLabels)}</select></label>
    <label className="text-sm font-medium text-zinc-700">Resultado<select value={value.outcome} onChange={(event) => onChange({ ...value, outcome: event.target.value })} className={select}><option value="">Todos</option>{options(outcomeLabels)}</select></label>
    <label className="text-sm font-medium text-zinc-700">Motivo<select value={value.topic} onChange={(event) => onChange({ ...value, topic: event.target.value })} className={select}><option value="">Todos</option>{options(topicLabels)}</select></label>
    <label className="flex h-10 items-center gap-2 text-sm font-medium text-zinc-700"><input type="checkbox" checked={value.review === "1"} onChange={(event) => onChange({ ...value, review: event.target.checked ? "1" : "" })} className="h-4 w-4 accent-emerald-700" />Solo a revisar</label>
    <label className="flex h-10 items-center gap-2 text-sm font-medium text-zinc-700"><input type="checkbox" checked={value.issues === "1"} onChange={(event) => onChange({ ...value, issues: event.target.checked ? "1" : "" })} className="h-4 w-4 accent-emerald-700" />Con fallos</label>
    <label className="flex h-10 items-center gap-2 text-sm font-medium text-zinc-700"><input type="checkbox" checked={value.guard === "1"} onChange={(event) => onChange({ ...value, guard: event.target.checked ? "1" : "" })} className="h-4 w-4 accent-emerald-700" />Con protección</label>
    <label className="flex h-10 items-center gap-2 text-sm font-medium text-zinc-700"><input type="checkbox" checked={value.order === "1"} onChange={(event) => onChange({ ...value, order: event.target.checked ? "1" : "" })} className="h-4 w-4 accent-emerald-700" />Con pedido</label>
  </>;
}

function ConversationItem({ row, open, onToggle }: { row: Row; open: boolean; onToggle: () => void }) {
  return <li>
    <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full cursor-pointer items-start gap-4 px-5 py-3.5 text-left hover:bg-zinc-50">
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-sm ${row.summary ? "font-medium text-zinc-900" : "text-zinc-400 italic"}`}>{row.summary ? String(row.summary) : "Sin resumen todavía"}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">{Boolean(row.sentiment) && <span className={`rounded-full px-2 font-medium ${sentimentTones[String(row.sentiment)] ?? ""}`}>{sentimentLabels[String(row.sentiment)]}</span>}{row.needs_review === true && <span className="rounded-full bg-amber-100 px-2 font-medium text-amber-900" title={String(row.review_reason ?? "")}>⚠ Revisar</span>}{Number(row.order_count ?? 0) > 0 && <span className="rounded-full bg-emerald-50 px-2 font-medium text-emerald-800" title="Pedidos atribuidos a esta conversación">🛒 {Number(row.order_count) === 1 ? "Pedido" : `${Number(row.order_count)} pedidos`} · {euro(Number(row.order_revenue ?? 0))}</span>}{row.closed === true ? <span className="rounded-full bg-red-50 px-2 font-medium text-red-800" title="Cerrada por la protección del chat">🚫 Cerrada</span> : Number(row.guard_count ?? 0) > 0 && <span className="rounded-full bg-amber-50 px-2 font-medium text-amber-800" title="Mensajes que la protección del chat frenó antes del modelo">{Number(row.guard_count)} {Number(row.guard_count) === 1 ? "mensaje frenado" : "mensajes frenados"}</span>}{Number(row.issue_count ?? 0) > 0 && <span className={`rounded-full px-2 font-medium ${row.quality_rating === "mal" ? "bg-red-50 text-red-800" : "bg-zinc-100 text-zinc-700"}`}>{Number(row.issue_count)} {Number(row.issue_count) === 1 ? "fallo" : "fallos"}</span>}<span>{date(row.last_at)}</span><span>{Number(row.message_count ?? 0)} mensajes</span>{Boolean(row.customer_name) && <span className="font-medium text-zinc-700">{String(row.customer_name)}</span>}{row.used_voice === true && <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 font-medium text-sky-800"><svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>Voz</span>}</span>
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
    {Boolean(thread.conversation?.sentiment) && <div className={`mb-4 rounded-xl border p-3 text-sm ${thread.conversation?.needs_review ? "border-amber-200 bg-amber-50" : "border-zinc-200 bg-white"}`}>
      <div className="flex flex-wrap gap-x-5 gap-y-1"><span><span className="text-zinc-500">Sentimiento:</span> <span className="font-medium text-zinc-900">{sentimentLabels[String(thread.conversation?.sentiment)]}</span></span><span><span className="text-zinc-500">Resultado:</span> <span className="font-medium text-zinc-900">{outcomeLabels[String(thread.conversation?.outcome)]}</span></span><span><span className="text-zinc-500">Motivo:</span> <span className="font-medium text-zinc-900">{topicLabels[String(thread.conversation?.topic)]}</span></span></div>
      {thread.conversation?.needs_review === true && <p className="mt-1.5 text-amber-900">⚠ Revisar: {String(thread.conversation?.review_reason ?? "")}</p>}
      <p className="mt-1.5 text-xs text-zinc-500">Análisis automático; orientativo.</p>
    </div>}
    {Boolean(thread.conversation?.quality_rating) && <QualityReview rating={String(thread.conversation?.quality_rating)} issues={(thread.conversation?.quality_issues as QualityIssue[] | null) ?? []} />}
    <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      <div><dt className="text-xs font-medium text-zinc-500">Cliente</dt><dd className="mt-0.5 text-zinc-900">{customer ?? <span className="text-zinc-500">Sin nombre guardado</span>}</dd></div>
      <div className="min-w-0"><dt className="text-xs font-medium text-zinc-500">Página donde empezó</dt><dd className="mt-0.5 truncate">{startPage ? <a href={startPage} target="_blank" rel="noreferrer" title={startPage} className="text-emerald-700 hover:underline">{pagePath(startPage)}</a> : <span className="text-zinc-500">Desconocida</span>}</dd></div>
    </dl>
    <p className="mt-3 text-xs text-zinc-500">Iniciada {date(startedAt)} · {tokens.toLocaleString("es-ES")} tokens · <span className="font-mono">{id}</span></p>
    <div className="mt-4 flex flex-col gap-3">{thread.messages.map((message) => <MessageBubble key={message.id} message={message} />)}</div>
    {(thread.orders?.length ?? 0) > 0 && <div className="mt-5"><h3 className="text-sm font-semibold text-zinc-800">Pedidos atribuidos</h3><ul className="mt-2 divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white">{thread.orders!.map((order) => <li key={order.id} className="px-4 py-3 text-sm"><div className="flex flex-wrap items-center gap-x-3 gap-y-1"><span className="font-semibold text-zinc-900">{order.name}</span><Badge tone="green">{order.attribution === "asistido" ? "Asistido (marca del chat)" : "Influido (compró un producto recomendado)"}</Badge><span className="font-medium text-zinc-800">{euro(Number(order.total) - Number(order.refunded))}</span><time className="ml-auto text-zinc-400">{date(order.created_at)}</time></div><p className="mt-1 text-zinc-600">{order.line_items.map((line) => `${line.quantity} × ${line.title}`).join(" · ")}</p></li>)}</ul></div>}
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
    <p className={`mt-1 text-xs ${user ? "text-emerald-100" : "text-zinc-400"}`}>{[time(message.created_at), message.channel === "voice" ? "voz" : null, message.product_ids?.length ? `${message.product_ids.length} productos` : null, message.model === "proteccion" ? "protección del chat (sin modelo)" : message.model, message.latency_ms ? `${(message.latency_ms / 1000).toFixed(1)} s` : null].filter(Boolean).join(" · ")}</p>
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

const euroFormat = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });
function euro(value: number) {
  return euroFormat.format(value);
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
