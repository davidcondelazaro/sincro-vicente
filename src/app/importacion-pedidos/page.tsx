"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AppSidebar } from "@/components/app-sidebar";

type Run = {
  id: string; mode: "all" | "references" | "retry_errors"; parameters: Record<string, unknown>; status: "queued" | "running" | "paused" | "stopped" | "completed" | "failed";
  total_count: number; processed_count: number; created_count: number; existing_count: number; error_count: number; warning_count: number; created_at: string; started_at: string | null; finished_at: string | null;
};
type ImportEvent = { id: number; run_id: string; level: "info" | "success" | "warning" | "error"; outcome: "created" | "existing" | "error" | "status"; prestashop_order_id: number | null; order_reference: string | null; shopify_order_id: string | null; message: string; created_at: string };
type Mode = "references" | "all";

const storeSlug = "electronica-vicente";

export default function OrderImportsPage() {
  const [mode, setMode] = useState<Mode>("references");
  const [references, setReferences] = useState("");
  const [run, setRun] = useState<Run | null>(null);
  const [history, setHistory] = useState<Run[]>([]);
  const [historyPage, setHistoryPage] = useState(0);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [events, setEvents] = useState<ImportEvent[]>([]);
  const [logsExpanded, setLogsExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const loadEvents = useCallback(async (runId: string) => {
    const { data } = await createClient().from("order_import_events").select("*").eq("run_id", runId).order("id", { ascending: false }).limit(300);
    setEvents(((data ?? []) as ImportEvent[]).reverse());
  }, []);

  const loadRun = useCallback(async () => {
    const response = await fetch(`/api/pedidos-prestashop/runs?page=${historyPage}`, { cache: "no-store" });
    const body = await response.json();
    if (response.ok) {
      const runs = body.runs as Run[];
      setHistory(runs);
      setHistoryHasMore(Boolean(body.hasMore));
      setRun((selected) => {
        const current = selected && runs.some((item) => item.id === selected.id) ? runs.find((item) => item.id === selected.id) ?? selected : selected ?? runs[0] ?? null;
        if (current) void loadEvents(current.id);
        return current;
      });
    }
    setLoading(false);
  }, [historyPage, loadEvents]);

  useEffect(() => { void loadRun(); }, [loadRun]);
  useEffect(() => { createClient().auth.getUser().then(({ data }) => setUserEmail(data.user?.email ?? null)); }, []);

  useEffect(() => {
    if (!run) return;
    const supabase = createClient();
    const channel = supabase.channel(`order-import-${run.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "order_import_runs", filter: `id=eq.${run.id}` }, (payload) => { setRun((selected) => selected?.id === run.id ? { ...selected, ...(payload.new as Partial<Run>) } : selected); if ((payload.new as Run).status !== run.status) void loadRun(); })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "order_import_events", filter: `run_id=eq.${run.id}` }, (payload) => { setEvents((items) => [...items, payload.new as ImportEvent].slice(-300)); })
      .subscribe();
    const timer = run.status === "queued" || run.status === "running" ? window.setInterval(() => { void loadRun(); }, 3_000) : undefined;
    return () => { if (timer) window.clearInterval(timer); void supabase.removeChannel(channel); };
  }, [run?.id, run?.status, loadRun]);

  async function launch(body: Record<string, unknown>) {
    setStarting(true); setError(null);
    try {
      const response = await fetch("/api/pedidos-prestashop/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "No se pudo iniciar la importación.");
      setHistoryPage(0); setRun(result.run); setLogsExpanded(true); setEvents([]); await loadRun();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Error inesperado."); } finally { setStarting(false); }
  }

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // La importación completa crea unos 98.000 pedidos: se confirma aparte y con los avisos al personal ya apagados.
    if (mode === "all" && !window.confirm("Vas a importar todos los pedidos de PrestaShop (unos 98.000). ¿Has desactivado los avisos de pedido nuevo al personal en Shopify?")) return;
    await launch(mode === "all" ? { mode } : { mode, references });
  }

  async function changeStatus(status: "paused" | "stopped" | "queued") {
    if (!run) return; setChanging(true); setError(null);
    try {
      const response = await fetch(`/api/pedidos-prestashop/runs/${run.id}/status`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "No se pudo actualizar la ejecución.");
      await loadRun();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Error inesperado."); } finally { setChanging(false); }
  }

  const active = run?.status === "queued" || run?.status === "running" || run?.status === "paused";
  const progress = run && run.total_count ? Math.round((run.processed_count / run.total_count) * 100) : 0;
  const estimate = run ? remainingEstimate(run, events) : null;
  const elapsed = run?.started_at ? Math.max(0, (run.finished_at ? new Date(run.finished_at).getTime() : Date.now()) - new Date(run.started_at).getTime()) : null;
  const etaText = estimate && run ? `Tiempo transcurrido: ${formatDuration(elapsed ?? 0)} · restante estimado: ${formatDuration(estimate)} · promedio: ${formatDuration(Math.round(estimate / Math.max(1, run.total_count - run.processed_count)))} por pedido` : elapsed !== null ? `Tiempo transcurrido: ${formatDuration(elapsed)} · calculando el tiempo restante…` : "Esperando a que comience el proceso…";

  return <div className="min-h-screen bg-zinc-50 lg:grid lg:grid-cols-[17.5rem_minmax(0,1fr)]">
    <AppSidebar active="prestashopOrders" userEmail={userEmail} />
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-7 px-6 pb-24 pt-28 sm:px-10 lg:mx-0 lg:py-16">
      <header><h1 className="text-4xl font-semibold tracking-tight text-zinc-950">Importación de pedidos desde PrestaShop</h1><p className="mt-3 max-w-3xl text-zinc-600">Crea en Shopify los pedidos históricos de PrestaShop, cerrados y archivados, sin avisar al cliente. Se importan los cobrados y no cancelados; los pedidos que ya estén en Shopify se saltan. Cada pedido necesita que su cliente exista antes en Shopify.</p></header>
      <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Shopify avisa al personal de cada pedido creado (email y app). Antes de una importación grande, desactiva esos avisos en Configuración → Notificaciones → Notificaciones al personal.</p>
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">{error}</p>}
      <form onSubmit={start} className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <fieldset disabled={Boolean(active) || starting} className="space-y-4 disabled:opacity-60"><legend className="text-lg font-semibold">Alcance de la importación</legend><div className="grid gap-3 md:grid-cols-2">
          <label className={`cursor-pointer rounded-xl border p-4 ${mode === "references" ? "border-emerald-600 bg-emerald-50" : "border-zinc-200"}`}><input className="mr-2" type="radio" checked={mode === "references"} onChange={() => setMode("references")} />Pedidos concretos</label>
          <label className={`cursor-pointer rounded-xl border p-4 ${mode === "all" ? "border-emerald-600 bg-emerald-50" : "border-zinc-200"}`}><input className="mr-2" type="radio" checked={mode === "all"} onChange={() => setMode("all")} />Todos los pedidos</label>
        </div>
        {mode === "references" && <label className="block text-sm font-medium">Referencias de PrestaShop<textarea required value={references} onChange={(event) => setReferences(event.target.value)} rows={4} placeholder="4-5101813, 4-5104424…" className="mt-1 block w-full rounded-lg border border-zinc-300 p-3 font-mono" /><span className="mt-1 block font-normal text-zinc-500">Separadas por comas, espacios o líneas; hasta 200.</span></label>}
        {mode === "all" && <p className="text-sm text-zinc-600">Todos los pedidos cobrados y no cancelados: enviados, reembolsados y con reembolso parcial. Los cobrados que nunca se marcaron como enviados entran como enviados, con la etiqueta PrestaShop-estado-sin-cerrar.</p>}
        <button className="h-11 rounded-lg bg-emerald-700 px-5 font-medium text-white hover:bg-emerald-800 disabled:opacity-60">{starting ? "Preparando la lista…" : "Iniciar el proceso"}</button></fieldset>
      </form>
      {loading ? <p className="text-zinc-500">Cargando ejecuciones…</p> : run ? (
        <section className="space-y-5 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div><h2 className="text-xl font-semibold">Ejecución actual</h2><p className="mt-1 text-sm text-zinc-600">{scopeLabel(run)} · <StatusBadge status={run.status} /></p></div>
            <div className="flex gap-2">
              {(run.status === "queued" || run.status === "running") && <button disabled={changing} onClick={() => changeStatus("paused")} className="rounded-lg border border-amber-300 px-4 py-2 font-medium text-amber-900 hover:bg-amber-50">Pausar</button>}
              {run.status === "paused" && <button disabled={changing} onClick={() => changeStatus("queued")} className="rounded-lg bg-emerald-700 px-4 py-2 font-medium text-white hover:bg-emerald-800">Reanudar</button>}
              {!active && run.error_count > 0 && <button disabled={starting} onClick={() => launch({ mode: "retry_errors", sourceRunId: run.id })} className="rounded-lg border border-emerald-300 px-4 py-2 font-medium text-emerald-800 hover:bg-emerald-50">Reintentar errores ({run.error_count})</button>}
              {active && <button disabled={changing} onClick={() => changeStatus("stopped")} className="rounded-lg border border-red-300 px-4 py-2 font-medium text-red-800 hover:bg-red-50">Detener</button>}
            </div>
          </div>
          <div>
            <div className="mb-2 flex justify-between text-sm font-medium"><span>{run.processed_count} de {run.total_count} procesados</span><span>{progress}%</span></div>
            <div className="h-3 overflow-hidden rounded-full bg-zinc-100"><div className="h-full bg-emerald-600 transition-all" style={{ width: `${progress}%` }} /></div>
            <p className={`mt-3 text-sm ${run.status === "completed" ? "text-emerald-700" : "text-zinc-600"}`}>{run.status === "completed" ? "Proceso completado." : etaText}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-5"><Counter label="Creados" value={run.created_count} color="text-emerald-700" /><Counter label="Con avisos" value={run.warning_count} color="text-amber-700" /><Counter label="Ya existían" value={run.existing_count} color="text-amber-700" /><Counter label="Errores" value={run.error_count} color="text-red-700" /><Counter label="Pendientes" value={Math.max(0, run.total_count - run.processed_count)} color="text-zinc-700" /></div>
          <div><button type="button" onClick={() => setLogsExpanded((value) => !value)} aria-expanded={logsExpanded} className="mb-3 flex w-full items-center justify-between text-left text-lg font-semibold text-zinc-950"><span>Registro en directo</span><span className="text-sm font-medium text-emerald-700">{logsExpanded ? "Ocultar" : `Ver registro (${events.length})`}</span></button>{logsExpanded && <div className="max-h-[28rem] overflow-auto rounded-xl border border-zinc-200"><ul className="divide-y divide-zinc-100">{events.length ? events.map((item) => <li key={item.id} className="p-3 text-sm"><div className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className={`font-semibold ${item.level === "error" ? "text-red-700" : item.level === "warning" ? "text-amber-700" : item.outcome === "created" ? "text-emerald-700" : "text-zinc-700"}`}>{item.outcome === "created" ? item.level === "warning" ? "Creado con avisos" : "Creado" : item.outcome === "existing" ? "Ya existía" : item.outcome === "error" ? "Error" : "Estado"}</span>{item.order_reference ? <span>{item.order_reference}</span> : item.prestashop_order_id && <span>PS #{item.prestashop_order_id}</span>}{item.shopify_order_id && <a href={shopifyUrl(item.shopify_order_id)} target="_blank" rel="noreferrer" className="text-emerald-700 underline">Shopify #{item.shopify_order_id.split("/").pop()}</a>}<time className="ml-auto text-zinc-400">{formatMadridTime(item.created_at)}</time></div><p className="mt-1 text-zinc-600">{item.message}</p></li>) : <li className="p-4 text-sm text-zinc-500">La cola está preparada. Aquí aparecerá cada resultado.</li>}</ul></div>}</div>
        </section>
      ) : null}
      {!loading && <section id="historial" className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm"><div className="flex items-baseline justify-between gap-4"><div><h2 className="text-xl font-semibold">Ejecuciones</h2><p className="mt-1 text-sm text-zinc-600">Cada proceso y todos sus eventos se conservan aquí.</p></div><span className="text-sm text-zinc-500">{history.length} en esta página</span></div><div className="mt-4 overflow-auto rounded-xl border border-zinc-200"><ul className="divide-y divide-zinc-100">{history.length ? history.map((item) => <li key={item.id}><button type="button" onClick={() => { setRun(item); setEvents([]); void loadEvents(item.id); }} className={`flex w-full flex-wrap items-center gap-x-4 gap-y-1 p-4 text-left hover:bg-zinc-50 ${run?.id === item.id ? "bg-emerald-50" : ""}`}><span className="font-semibold text-zinc-900">{scopeLabel(item)}</span><span className="text-sm text-zinc-600">{formatMadridDateTime(item.created_at)}</span><span className="text-sm">{item.created_count} creados · {item.existing_count} existentes · {item.error_count} errores</span><span className="text-sm text-zinc-600">{durationLabel(item)}</span><span className="ml-auto text-sm font-medium text-zinc-700">{statusLabels[item.status]}</span></button></li>) : <li className="p-4 text-sm text-zinc-500">Todavía no hay ejecuciones guardadas.</li>}</ul></div><div className="mt-4 flex items-center justify-between gap-4 text-sm"><button type="button" disabled={historyPage === 0} onClick={() => setHistoryPage((page) => Math.max(0, page - 1))} className="rounded-lg border border-zinc-300 px-3 py-2 disabled:opacity-40">Anterior</button><span className="text-zinc-500">Página {historyPage + 1}</span><button type="button" disabled={!historyHasMore} onClick={() => setHistoryPage((page) => page + 1)} className="rounded-lg border border-zinc-300 px-3 py-2 disabled:opacity-40">Siguiente</button></div></section>}
    </main>
  </div>;
}

const statusLabels = { queued: "En cola", running: "En marcha", paused: "Pausada", stopped: "Detenida", completed: "Completada", failed: "Con error" } as const;
function scopeLabel(run: Run) { if (run.mode === "all") return "Todos los pedidos"; if (run.mode === "retry_errors") return "Reintento de errores"; const references = (run.parameters.references as string[] | undefined) ?? []; return references.length === 1 ? `Pedido ${references[0]}` : `${references.length} pedidos concretos`; }
function formatMadridDateTime(value: string) { return new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "short" }).format(new Date(value)); }
function formatMadridTime(value: string) { return new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", timeStyle: "medium" }).format(new Date(value)); }
function remainingEstimate(run: Run, events: ImportEvent[]) { if (!run.processed_count || run.processed_count >= run.total_count) return null; const processed = events.filter((event) => event.outcome !== "status"); if (processed.length >= 2) { const recent = processed.slice(-12); const intervals = recent.slice(1).map((item, index) => new Date(item.created_at).getTime() - new Date(recent[index].created_at).getTime()).filter((value) => value >= 0 && value < 60_000); if (intervals.length) return Math.round((intervals.reduce((sum, value) => sum + value, 0) / intervals.length) * (run.total_count - run.processed_count)); } if (!run.started_at) return null; const elapsed = Date.now() - new Date(run.started_at).getTime(); return Math.max(0, Math.round((elapsed / run.processed_count) * (run.total_count - run.processed_count))); }
function formatDuration(milliseconds: number) { const safe = Math.max(0, milliseconds); if (safe < 1_000) return `${Math.round(safe)} ms`; const seconds = Math.round(safe / 1_000); if (seconds < 60) return `${seconds} s`; const hours = Math.floor(seconds / 3600); const minutes = Math.floor((seconds % 3600) / 60); const rest = seconds % 60; if (hours) return `${hours} h${minutes ? ` ${minutes} min` : ""}${rest ? ` ${rest} s` : ""}`; return `${minutes} min${rest ? ` ${rest} s` : ""}`; }
function durationLabel(run: Run) { if (!run.started_at) return "Sin iniciar"; const end = run.finished_at ? new Date(run.finished_at).getTime() : Date.now(); return `Duración: ${formatDuration(end - new Date(run.started_at).getTime())}`; }
function shopifyUrl(id: string) { return `https://admin.shopify.com/store/${storeSlug}/orders/${id.split("/").pop()}`; }
function Counter({ label, value, color }: { label: string; value: number; color: string }) { return <div className="rounded-xl bg-zinc-50 p-3"><p className="text-sm text-zinc-500">{label}</p><p className={`mt-1 text-2xl font-semibold ${color}`}>{value}</p></div>; }
function StatusBadge({ status }: { status: Run["status"] }) { return <span className="font-medium text-zinc-900">{statusLabels[status]}</span>; }
