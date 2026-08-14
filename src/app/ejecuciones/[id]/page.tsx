"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AppSidebar } from "@/components/app-sidebar";

type Run = { id: string; mode: "id" | "from_date" | "latest" | "all"; parameters: Record<string, unknown>; status: "queued" | "running" | "paused" | "stopped" | "completed" | "failed"; total_count: number; processed_count: number; created_count: number; existing_count: number; error_count: number; started_at: string | null; finished_at: string | null; created_at: string };
type ImportEvent = { id: number; outcome: "created" | "existing" | "error" | "status"; level: "info" | "success" | "warning" | "error"; prestashop_customer_id: number | null; customer_email: string | null; shopify_customer_id: string | null; message: string; created_at: string };
type EventFilter = "all" | "created" | "existing" | "error";

const EVENTS_PAGE_SIZE = 1000;
const EVENT_LIST_PAGE_SIZE = 50;

async function loadCustomerEvents(supabase: ReturnType<typeof createClient>, runId: string) {
  const events: ImportEvent[] = [];
  for (let from = 0; ; from += EVENTS_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("customer_import_events")
      .select("*")
      .eq("run_id", runId)
      .order("id", { ascending: true })
      .range(from, from + EVENTS_PAGE_SIZE - 1);
    if (error) throw error;
    events.push(...((data ?? []) as ImportEvent[]));
    if (!data || data.length < EVENTS_PAGE_SIZE) return events;
  }
}

export default function ExecutionPage() {
  const { id } = useParams<{ id: string }>();
  const [run, setRun] = useState<Run | null>(null);
  const [events, setEvents] = useState<ImportEvent[]>([]);
  const [eventFilter, setEventFilter] = useState<EventFilter>("all");
  const [eventPage, setEventPage] = useState(0);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { const supabase = createClient(); Promise.all([supabase.from("customer_import_runs").select("*").eq("id", id).maybeSingle(), loadCustomerEvents(supabase, id)]).then(([runResult, loadedEvents]) => { if (runResult.error || !runResult.data) setError("No se encontró esta ejecución."); else setRun(runResult.data as Run); setEvents(loadedEvents); }).catch(() => setError("No se pudo recuperar el historial completo de esta ejecución.")); supabase.auth.getUser().then(({ data }) => setUserEmail(data.user?.email ?? null)); }, [id]);
  const visibleEvents = useMemo(() => events.filter((event) => eventFilter === "all" || event.outcome === eventFilter), [eventFilter, events]);
  const pagedEvents = useMemo(() => visibleEvents.slice(eventPage * EVENT_LIST_PAGE_SIZE, (eventPage + 1) * EVENT_LIST_PAGE_SIZE), [eventPage, visibleEvents]);
  const eventPageCount = Math.max(1, Math.ceil(visibleEvents.length / EVENT_LIST_PAGE_SIZE));
  const page = <main className="mx-auto flex w-full max-w-5xl flex-col px-6 pb-24 pt-28 sm:px-10 lg:mx-0 lg:py-16">{error ? <><a href="/importacion-clientes#historial" className="text-emerald-700 underline">← Volver a ejecuciones</a><p className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">{error}</p></> : !run ? <p className="text-zinc-500">Cargando ejecución…</p> : <><a href="/importacion-clientes#historial" className="text-sm font-medium text-emerald-700 underline underline-offset-2">← Volver a ejecuciones</a><header className="mt-6"><p className="text-sm font-semibold tracking-[0.18em] text-emerald-700 uppercase">Historial</p><h1 className="mt-3 text-4xl font-semibold tracking-tight">{scopeLabel(run)}</h1><p className="mt-3 text-zinc-600">Iniciada: {formatMadridDateTime(run.created_at)} · <span className="font-medium">{statusLabel(run.status)}</span> · {durationLabel(run)}</p></header><section className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4"><Counter label="Procesados" value={`${run.processed_count}/${run.total_count}`} /><Counter label="Creados" value={run.created_count} /><Counter label="Ya existían" value={run.existing_count} /><Counter label="Errores" value={run.error_count} /></section><section className="mt-8 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-end justify-between gap-3"><h2 className="text-xl font-semibold">Registro completo</h2><label className="text-sm font-medium text-zinc-700">Mostrar<select value={eventFilter} onChange={(event) => { setEventFilter(event.target.value as EventFilter); setEventPage(0); }} className="mt-1 block h-10 rounded-lg border border-zinc-300 bg-white px-3 font-normal text-zinc-800"><option value="all">Todos</option><option value="created">Creados</option><option value="existing">Ya existían</option><option value="error">Errores</option></select></label></div><div className="mt-4 max-h-[42rem] overflow-auto rounded-xl border border-zinc-200"><ul className="divide-y divide-zinc-100">{pagedEvents.length ? pagedEvents.map((event) => <li key={event.id} className="p-3 text-sm"><div className="flex flex-wrap items-center gap-x-3 gap-y-1"><span className={`font-semibold ${event.outcome === "created" ? "text-emerald-700" : event.outcome === "error" ? "text-red-700" : event.outcome === "existing" ? "text-amber-700" : "text-zinc-700"}`}>{event.outcome === "created" ? "Creado" : event.outcome === "existing" ? "Ya existía" : event.outcome === "error" ? "Error" : "Estado"}</span>{event.prestashop_customer_id && <span>PS #{event.prestashop_customer_id}</span>}{event.customer_email && <span className="text-zinc-600">{event.customer_email}</span>}{event.shopify_customer_id && <a href={shopifyUrl(event.shopify_customer_id)} target="_blank" rel="noreferrer" className="text-emerald-700 underline">Abrir cliente en Shopify</a>}<time className="ml-auto text-zinc-400">{formatMadridDateTime(event.created_at)}</time></div><p className="mt-1 text-zinc-600">{event.message}</p></li>) : <li className="p-4 text-sm text-zinc-500">No hay resultados para este filtro.</li>}</ul></div><div className="mt-4 flex items-center justify-between gap-4 text-sm"><button type="button" disabled={eventPage === 0} onClick={() => setEventPage((page) => Math.max(0, page - 1))} className="rounded-lg border border-zinc-300 px-3 py-2 disabled:opacity-40">Anterior</button><span className="text-zinc-500">Página {eventPage + 1} de {eventPageCount}</span><button type="button" disabled={eventPage + 1 >= eventPageCount} onClick={() => setEventPage((page) => Math.min(eventPageCount - 1, page + 1))} className="rounded-lg border border-zinc-300 px-3 py-2 disabled:opacity-40">Siguiente</button></div></section></>}</main>;
  return <div className="min-h-screen bg-zinc-50 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]"><AppSidebar active="customers" userEmail={userEmail} />{page}</div>;
}

function scopeLabel(run: Run) { return run.mode === "id" ? `Cliente #${run.parameters.customerId}` : run.mode === "from_date" ? `Desde ${formatSpanishDate(String(run.parameters.fromDate))}` : run.mode === "all" ? "Todos los clientes" : `Últimos ${run.parameters.latest} clientes`; }
function formatSpanishDate(value: string) { const [year, month, day] = value.slice(0, 10).split("-"); return year && month && day ? `${day}/${month}/${year}` : value; }
function formatMadridDateTime(value: string) { return new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "short" }).format(new Date(value)); }
function statusLabel(status: Run["status"]) { return ({ queued: "En cola", running: "En marcha", paused: "Pausada", stopped: "Detenida", completed: "Completada", failed: "Con error" } as const)[status]; }
function durationLabel(run: Run) { if (!run.started_at) return "Sin iniciar"; const elapsed = Math.max(0, (run.finished_at ? new Date(run.finished_at).getTime() : Date.now()) - new Date(run.started_at).getTime()); if (elapsed < 1_000) return `Duración: ${Math.round(elapsed)} ms`; const seconds = Math.round(elapsed / 1_000); if (seconds < 60) return `Duración: ${seconds} s`; const hours = Math.floor(seconds / 3600); const minutes = Math.floor((seconds % 3600) / 60); const rest = seconds % 60; if (hours) return `Duración: ${hours} h${minutes ? ` ${minutes} min` : ""}${rest ? ` ${rest} s` : ""}`; return `Duración: ${minutes} min${rest ? ` ${rest} s` : ""}`; }
function shopifyUrl(id: string) { return `https://admin.shopify.com/store/electronica-vicente/customers/${id.split("/").pop()}`; }
function Counter({ label, value }: { label: string; value: string | number }) { return <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm"><p className="text-sm text-zinc-500">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p></div>; }
