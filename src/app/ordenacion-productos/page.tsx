"use client";

import { useCallback, useEffect, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { createClient } from "@/lib/supabase/client";

type Run = { id: string; entity_type: "priorities"; status: "queued" | "running" | "paused" | "stopped" | "completed" | "failed"; total_count: number; processed_count: number; created_count: number; updated_count: number; unchanged_count: number; unpublished_count: number; error_count: number; created_at: string; started_at: string | null; finished_at: string | null };
type Event = { id: number; outcome: "created" | "updated" | "unchanged" | "unpublished" | "error" | "status"; level: string; source_entity_id: string | null; source_entity_name: string | null; message: string; details: Record<string, unknown> | null; created_at: string };
type EventFilter = "all" | "updated" | "unchanged" | "error";

export default function ProductOrderingPage() {
  const [run, setRun] = useState<Run | null>(null);
  const [history, setHistory] = useState<Run[]>([]);
  const [starting, setStarting] = useState(false);
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collectionName, setCollectionName] = useState("");
  const [events, setEvents] = useState<Event[]>([]);
  const [eventFilter, setEventFilter] = useState<EventFilter>("all");
  const [logsExpanded, setLogsExpanded] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/catalog/runs?entityType=priorities", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "No se pudo recuperar el historial.");
    const runs = (data.runs ?? []) as Run[];
    setHistory(runs);
    setRun(runs.find((item) => ["queued", "running", "paused"].includes(item.status)) ?? runs[0] ?? null);
  }, []);

  useEffect(() => { load().catch((reason) => setError(reason instanceof Error ? reason.message : "No se pudo cargar la pantalla.")); }, [load]);
  useEffect(() => { if (!run || !["queued", "running", "paused"].includes(run.status)) return; const timer = window.setInterval(() => load().catch(() => undefined), 2000); return () => window.clearInterval(timer); }, [load, run?.id, run?.status, run?.processed_count]);
  useEffect(() => {
    if (!run) { setEvents([]); return; }
    const supabase = createClient();
    const loadEvents = async () => {
      const { data } = await supabase.from("catalog_import_events").select("*").eq("run_id", run.id).order("id", { ascending: false }).limit(100);
      setEvents((data ?? []) as Event[]);
    };
    void loadEvents();
    const channel = supabase.channel(`priority-import-${run.id}`).on("postgres_changes", { event: "INSERT", schema: "public", table: "catalog_import_events", filter: `run_id=eq.${run.id}` }, () => { void loadEvents(); }).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [run?.id]);

  async function start() {
    setStarting(true); setError(null);
    try { const response = await fetch("/api/catalog/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entityType: "priorities", collectionName }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "No se pudo iniciar la ordenación."); setRun(data.run as Run); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo iniciar la ordenación."); } finally { setStarting(false); }
  }
  async function changeStatus(status: "paused" | "queued" | "stopped") { if (!run) return; setChanging(true); try { const response = await fetch(`/api/catalog/runs/${run.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "No se pudo cambiar el estado."); setRun(data.run as Run); await load(); } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo cambiar el estado."); } finally { setChanging(false); } }

  const active = Boolean(run && ["queued", "running", "paused"].includes(run.status));
  const progress = run?.total_count ? Math.round((run.processed_count / run.total_count) * 100) : 0;
  const elapsed = run?.started_at ? Math.max(0, (run.finished_at ? new Date(run.finished_at).getTime() : Date.now()) - new Date(run.started_at).getTime()) : 0;
  const average = run?.processed_count && elapsed ? elapsed / run.processed_count : 0;
  const remaining = average * Math.max(0, (run?.total_count ?? 0) - (run?.processed_count ?? 0));
  const progressMessage = run?.status === "completed"
    ? `Proceso completado · duración: ${formatDuration(elapsed)}.`
    : `Tiempo transcurrido: ${formatDuration(elapsed)} · restante estimado: ${formatDuration(remaining)} · promedio: ${formatDuration(average)} por colección`;
  const visibleEvents = events.filter((event) => eventFilter === "all" || eventFilter === "updated" && event.outcome === "updated" || eventFilter === "unchanged" && event.outcome === "unchanged" || eventFilter === "error" && event.outcome === "error");
  return <div className="min-h-screen bg-zinc-50 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]"><AppSidebar active="priorities" userEmail={null} /><main className="mx-auto flex w-full max-w-5xl flex-col gap-7 px-6 pb-24 pt-28 sm:px-10 lg:mx-0 lg:py-16"><header><h1 className="text-4xl font-semibold tracking-tight text-zinc-950">Ordenación de productos</h1><p className="mt-3 max-w-3xl text-zinc-600">Ordena los productos de las colecciones de Shopify por el metacampo <code className="rounded bg-zinc-200 px-1">custom.prioridad</code>. Este proceso tiene su propia cola y su propio historial.</p></header>
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm"><h2 className="text-xl font-semibold">Qué quieres ordenar</h2><p className="mt-3 rounded-lg bg-zinc-50 p-4 text-sm text-zinc-600">Se revisan las colecciones no vacías, se asegura el orden manual y se colocan primero las prioridades más bajas. Los productos sin prioridad quedan al final. Si ya está todo correcto, no se modifica nada.</p><label className="mt-5 block text-sm font-medium text-zinc-700">Colección de Shopify <span className="font-normal text-zinc-500">(opcional; si se deja vacío se revisan todas)</span><input value={collectionName} onChange={(event) => setCollectionName(event.target.value)} className="mt-1 block h-11 w-full rounded-lg border border-zinc-300 px-3" placeholder="Ej. TV LED" disabled={active || starting} /></label><button disabled={active || starting} onClick={start} className="mt-5 h-11 rounded-lg bg-emerald-700 px-5 font-medium text-white hover:bg-emerald-800 disabled:opacity-60">{starting ? "Preparando cola…" : "Iniciar el proceso"}</button>{error && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">{error}</p>}</section>
    {run && <section className="space-y-5 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-xl font-semibold">Ejecución actual</h2><p className="mt-1 text-sm text-zinc-600">Prioridades · {statusLabel(run.status)}</p></div><div className="flex gap-2">{(run.status === "queued" || run.status === "running") && <button disabled={changing} onClick={() => changeStatus("paused")} className="rounded-lg border border-amber-300 px-4 py-2 font-medium text-amber-900">Pausar</button>}{run.status === "paused" && <button disabled={changing} onClick={() => changeStatus("queued")} className="rounded-lg bg-emerald-700 px-4 py-2 font-medium text-white">Reanudar</button>}{active && <button disabled={changing} onClick={() => changeStatus("stopped")} className="rounded-lg border border-red-300 px-4 py-2 font-medium text-red-800">Detener</button>}</div></div><div><div className="mb-2 flex justify-between text-sm font-medium"><span>{run.processed_count} de {run.total_count} colecciones procesadas</span><span>{progress}%</span></div><div className="h-3 overflow-hidden rounded-full bg-zinc-100"><div className="h-full bg-emerald-600 transition-all" style={{ width: `${progress}%` }} /></div><p className="mt-3 text-sm text-zinc-600">{progressMessage}</p></div><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"><Counter label="Reordenadas" value={run.updated_count} /><Counter label="Sin cambios" value={run.unchanged_count} /><Counter label="Errores" value={run.error_count} /><Counter label="Pendientes" value={Math.max(0, run.total_count - run.processed_count)} /><Counter label="Procesadas" value={`${run.processed_count}/${run.total_count}`} /></div><section className="rounded-xl border border-zinc-200 bg-white"><button type="button" onClick={() => setLogsExpanded((value) => !value)} className="flex w-full items-center justify-between p-4 text-left"><span className="text-lg font-semibold">Registro en directo</span><span className="text-sm font-medium text-emerald-700">{logsExpanded ? "Ocultar" : `Ver registro (${visibleEvents.length})`}</span></button>{logsExpanded && <div className="border-t border-zinc-100 p-4"><div className="flex flex-wrap items-end justify-between gap-3"><label className="text-sm font-medium text-zinc-700">Mostrar<select value={eventFilter} onChange={(event) => setEventFilter(event.target.value as EventFilter)} className="mt-1 block h-10 rounded-lg border border-zinc-300 bg-white px-3 font-normal"><option value="all">Todos</option><option value="updated">Reordenadas</option><option value="unchanged">Sin cambios</option><option value="error">Errores</option></select></label></div><ul className="mt-3 max-h-[28rem] divide-y divide-zinc-100 overflow-auto rounded-xl border border-zinc-200">{visibleEvents.length ? visibleEvents.map((event) => <li key={event.id} className="p-3 text-sm"><div className="flex flex-wrap items-center gap-x-3 gap-y-1"><span className={`font-semibold ${event.outcome === "updated" ? "text-amber-700" : event.outcome === "error" ? "text-red-700" : "text-zinc-700"}`}>{event.outcome === "updated" ? "Reordenada" : event.outcome === "error" ? "Error" : event.outcome === "unchanged" ? "Sin cambios" : "Estado"}</span>{event.source_entity_name && <span>{event.source_entity_name}</span>}<time className="ml-auto text-zinc-400">{formatDate(event.created_at)}</time></div><p className="mt-1 text-zinc-600">{event.message}</p>{event.details && <details className="mt-2 rounded-lg bg-zinc-50 p-2 text-xs"><summary className="cursor-pointer font-medium text-zinc-700">Detalle técnico</summary><pre className="mt-2 max-w-full overflow-auto whitespace-pre-wrap text-zinc-600">{JSON.stringify(event.details, null, 2)}</pre></details>}</li>) : <li className="p-4 text-sm text-zinc-500">Todavía no hay eventos para este filtro.</li>}</ul></div>}</section><a href={`/ejecuciones-catalogo/${run.id}`} className="inline-block text-sm font-medium text-emerald-700 underline">Ver registro completo</a></section>}
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm"><h2 className="text-xl font-semibold">Ejecuciones</h2><p className="mt-1 text-sm text-zinc-600">Historial independiente de la importación del catálogo.</p><div className="mt-4 overflow-auto rounded-xl border border-zinc-200"><ul className="divide-y divide-zinc-100">{history.length ? history.map((item) => <li key={item.id}><a href={`/ejecuciones-catalogo/${item.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 p-4 hover:bg-zinc-50"><span className="font-semibold">Prioridades</span><span className="text-sm text-zinc-600">{formatDate(item.created_at)}</span><span className="text-sm text-zinc-600">Duración: {duration(item)}</span><span className="text-sm">{item.updated_count} reordenadas · {item.unchanged_count} sin cambios · {item.error_count} errores</span><span className="ml-auto text-sm">{statusLabel(item.status)}</span></a></li>) : <li className="p-4 text-sm text-zinc-500">Todavía no hay ejecuciones.</li>}</ul></div></section>
  </main></div>;
}
function statusLabel(status: Run["status"]) { return ({ queued: "En cola", running: "En marcha", paused: "Pausada", stopped: "Detenida", completed: "Completada", failed: "Con error" } as const)[status]; }
function formatDate(value: string) { return new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "short" }).format(new Date(value)); }
function duration(run: Run) { if (!run.started_at) return "Sin iniciar"; return formatDuration((run.finished_at ? new Date(run.finished_at).getTime() : Date.now()) - new Date(run.started_at).getTime()); }
function formatDuration(ms: number) { const safe = Math.max(0, ms); if (safe < 1_000) return `${Math.round(safe)} ms`; const seconds = Math.round(safe / 1000); if (seconds < 60) return `${seconds} s`; const hours = Math.floor(seconds / 3600); const minutes = Math.floor((seconds % 3600) / 60); const rest = seconds % 60; if (hours) return `${hours} h${minutes ? ` ${minutes} min` : ""}${rest ? ` ${rest} s` : ""}`; return `${minutes} min${rest ? ` ${rest} s` : ""}`; }
function Counter({ label, value }: { label: string; value: string | number }) { return <div className="rounded-xl border border-zinc-200 bg-white p-4"><p className="text-sm text-zinc-500">{label}</p><p className="mt-1 text-2xl font-semibold">{value}</p></div>; }
