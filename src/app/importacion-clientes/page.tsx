"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AppSidebar } from "@/components/app-sidebar";

type Run = {
  id: string; mode: "id" | "from_date" | "latest" | "all"; parameters: Record<string, unknown>; status: "queued" | "running" | "paused" | "stopped" | "completed" | "failed";
  total_count: number; processed_count: number; created_count: number; existing_count: number; error_count: number; created_at: string; started_at: string | null; finished_at: string | null;
};
type ImportEvent = { id: number; run_id: string; level: "info" | "success" | "warning" | "error"; outcome: "created" | "existing" | "error" | "status"; prestashop_customer_id: number | null; customer_email: string | null; shopify_customer_id: string | null; message: string; created_at: string };
type Mode = "from_date" | "latest" | "all";

const storeSlug = "electronica-vicente";

export default function BulkImportsPage() {
  const [mode, setMode] = useState<Mode>("from_date");
  const [fromDate, setFromDate] = useState("");
  const [latest, setLatest] = useState("100");
  const [run, setRun] = useState<Run | null>(null);
  const [history, setHistory] = useState<Run[]>([]);
  const [events, setEvents] = useState<ImportEvent[]>([]);
  const [logsExpanded, setLogsExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  const loadEvents = useCallback(async (runId: string) => {
    const { data } = await createClient().from("customer_import_events").select("*").eq("run_id", runId).order("id", { ascending: true }).limit(300);
    setEvents((data ?? []) as ImportEvent[]);
  }, []);

  const loadRun = useCallback(async () => {
    const response = await fetch("/api/bulk/runs", { cache: "no-store" });
    const body = await response.json();
    if (response.ok) {
      const runs = body.runs as Run[];
      setHistory(runs);
      setRun((selected) => {
        const current = selected ? runs.find((item) => item.id === selected.id) ?? runs[0] ?? null : runs[0] ?? null;
        if (current) void loadEvents(current.id);
        return current;
      });
    }
    setLoading(false);
  }, [loadEvents]);

  useEffect(() => { void loadRun(); }, [loadRun]);
  useEffect(() => { createClient().auth.getUser().then(({ data }) => setUserEmail(data.user?.email ?? null)); }, []);

  useEffect(() => {
    if (!run) return;
    const supabase = createClient();
    const channel = supabase.channel(`customer-import-${run.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "customer_import_runs", filter: `id=eq.${run.id}` }, () => { void loadRun(); })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "customer_import_events", filter: `run_id=eq.${run.id}` }, () => { void loadEvents(run.id); })
      .subscribe();
    const timer = run.status === "queued" || run.status === "running" ? window.setInterval(() => { void loadRun(); }, 3_000) : undefined;
    return () => { if (timer) window.clearInterval(timer); void supabase.removeChannel(channel); };
  }, [run?.id, run?.status, loadEvents, loadRun]);

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setStarting(true); setError(null);
    try {
      const response = await fetch("/api/bulk/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, fromDate, latest }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "No se pudo iniciar la importación.");
      setRun(body.run); setLogsExpanded(true); setHistory((items) => [body.run, ...items.filter((item) => item.id !== body.run.id)]); setEvents([]); await loadEvents(body.run.id);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Error inesperado."); } finally { setStarting(false); }
  }

  async function changeStatus(status: "paused" | "stopped" | "queued") {
    if (!run) return; setChanging(true); setError(null);
    try {
      const response = await fetch(`/api/bulk/runs/${run.id}/status`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "No se pudo actualizar la ejecución.");
      await loadRun();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Error inesperado."); } finally { setChanging(false); }
  }

  const active = run?.status === "queued" || run?.status === "running" || run?.status === "paused";
  const progress = run && run.total_count ? Math.round((run.processed_count / run.total_count) * 100) : 0;
  const estimate = run ? remainingEstimate(run, events) : null;
  const elapsed = run?.started_at ? Math.max(0, (run.finished_at ? new Date(run.finished_at).getTime() : Date.now()) - new Date(run.started_at).getTime()) : null;
  const etaText = estimate && run ? `Tiempo transcurrido: ${formatDuration(elapsed ?? 0)} · restante estimado: ${formatDuration(estimate)} · promedio: ${formatDuration(Math.round(estimate / Math.max(1, run.total_count - run.processed_count)))} por cliente` : elapsed !== null ? `Tiempo transcurrido: ${formatDuration(elapsed)} · calculando el tiempo restante…` : "Esperando a que comience el proceso…";

  return <div className="min-h-screen bg-zinc-50 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
    <AppSidebar active="customers" userEmail={userEmail} />
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-7 px-6 pb-24 pt-28 sm:px-10 lg:mx-0 lg:py-16">
      <header><h1 className="text-4xl font-semibold tracking-tight text-zinc-950">Importación de clientes desde PrestaShop</h1><p className="mt-3 max-w-3xl text-zinc-600">Lanza una importación persistente. Puedes cerrar esta pantalla: la cola seguirá procesando y podrás volver a ver su avance. Los alcances masivos incluyen únicamente clientes activos con al menos un pedido válido.</p></header>
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">{error}</p>}
      <form onSubmit={start} className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <fieldset disabled={Boolean(active) || starting} className="space-y-4 disabled:opacity-60"><legend className="text-lg font-semibold">Alcance de la importación</legend><div className="grid gap-3 md:grid-cols-3">
          <label className={`cursor-pointer rounded-xl border p-4 ${mode === "from_date" ? "border-emerald-600 bg-emerald-50" : "border-zinc-200"}`}><input className="mr-2" type="radio" checked={mode === "from_date"} onChange={() => setMode("from_date")} />Desde una fecha</label>
          <label className={`cursor-pointer rounded-xl border p-4 ${mode === "latest" ? "border-emerald-600 bg-emerald-50" : "border-zinc-200"}`}><input className="mr-2" type="radio" checked={mode === "latest"} onChange={() => setMode("latest")} />N clientes</label>
          <label className={`cursor-pointer rounded-xl border p-4 ${mode === "all" ? "border-emerald-600 bg-emerald-50" : "border-zinc-200"}`}><input className="mr-2" type="radio" checked={mode === "all"} onChange={() => setMode("all")} />Todos los clientes</label>
        </div>
        {mode === "from_date" && <label className="block text-sm font-medium">Desde la fecha<input required value={fromDate} onChange={(event) => setFromDate(event.target.value)} type="date" className="mt-1 block h-11 w-full rounded-lg border border-zinc-300 px-3" /><span className="mt-1 block font-normal text-zinc-500">Desde las 00:00, hora de Madrid.</span></label>}
        {mode === "latest" && <label className="block text-sm font-medium">Número de últimos clientes<input required value={latest} onChange={(event) => setLatest(event.target.value)} type="number" min="1" max="100000" className="mt-1 block h-11 w-full rounded-lg border border-zinc-300 px-3" /></label>}
        {mode === "all" && <p className="text-sm text-zinc-600">Se incluirán todos los clientes activos que tengan al menos un pedido válido.</p>}
        <button className="h-11 rounded-lg bg-emerald-700 px-5 font-medium text-white hover:bg-emerald-800 disabled:opacity-60">{starting ? "Preparando cola…" : "Iniciar el proceso"}</button></fieldset>
      </form>
      {loading ? <p className="text-zinc-500">Cargando ejecuciones…</p> : run ? (
        <section className="space-y-5 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div><h2 className="text-xl font-semibold">Ejecución actual</h2><p className="mt-1 text-sm text-zinc-600">{scopeLabel(run)} · <StatusBadge status={run.status} /></p></div>
            <div className="flex gap-2">
              {(run.status === "queued" || run.status === "running") && <button disabled={changing} onClick={() => changeStatus("paused")} className="rounded-lg border border-amber-300 px-4 py-2 font-medium text-amber-900 hover:bg-amber-50">Pausar</button>}
              {run.status === "paused" && <button disabled={changing} onClick={() => changeStatus("queued")} className="rounded-lg bg-emerald-700 px-4 py-2 font-medium text-white hover:bg-emerald-800">Reanudar</button>}
              {active && <button disabled={changing} onClick={() => changeStatus("stopped")} className="rounded-lg border border-red-300 px-4 py-2 font-medium text-red-800 hover:bg-red-50">Detener</button>}
            </div>
          </div>
          <div>
            <div className="mb-2 flex justify-between text-sm font-medium"><span>{run.processed_count} de {run.total_count} procesados</span><span>{progress}%</span></div>
            <div className="h-3 overflow-hidden rounded-full bg-zinc-100"><div className="h-full bg-emerald-600 transition-all" style={{ width: `${progress}%` }} /></div>
            <p className={`mt-3 text-sm ${run.status === "completed" ? "text-emerald-700" : "text-zinc-600"}`}>{run.status === "completed" ? "Proceso completado." : etaText}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-4"><Counter label="Creados" value={run.created_count} color="text-emerald-700" /><Counter label="Ya existían" value={run.existing_count} color="text-amber-700" /><Counter label="Errores" value={run.error_count} color="text-red-700" /><Counter label="Pendientes" value={Math.max(0, run.total_count - run.processed_count)} color="text-zinc-700" /></div>
          <div><button type="button" onClick={() => setLogsExpanded((value) => !value)} aria-expanded={logsExpanded} className="mb-3 flex w-full items-center justify-between text-left text-lg font-semibold text-zinc-950"><span>Registro en directo</span><span className="text-sm font-medium text-emerald-700">{logsExpanded ? "Ocultar" : `Ver registro (${events.length})`}</span></button>{logsExpanded && <div className="max-h-[28rem] overflow-auto rounded-xl border border-zinc-200"><ul className="divide-y divide-zinc-100">{events.length ? events.map((item) => <li key={item.id} className="p-3 text-sm"><div className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className={`font-semibold ${item.level === "error" ? "text-red-700" : item.outcome === "created" ? "text-emerald-700" : item.outcome === "existing" ? "text-amber-700" : "text-zinc-700"}`}>{item.outcome === "created" ? "Creado" : item.outcome === "existing" ? "Ya existía" : item.outcome === "error" ? "Error" : "Estado"}</span>{item.prestashop_customer_id && <span>PS #{item.prestashop_customer_id}</span>}{item.customer_email && <span className="text-zinc-600">{item.customer_email}</span>}{item.shopify_customer_id && <a href={shopifyUrl(item.shopify_customer_id)} target="_blank" rel="noreferrer" className="text-emerald-700 underline">Shopify #{item.shopify_customer_id.split("/").pop()}</a>}<time className="ml-auto text-zinc-400">{formatMadridTime(item.created_at)}</time></div><p className="mt-1 text-zinc-600">{item.message}</p></li>) : <li className="p-4 text-sm text-zinc-500">La cola está preparada. Aquí aparecerá cada resultado.</li>}</ul></div>}</div>
        </section>
      ) : null}
      {!loading && <section id="historial" className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm"><div className="flex items-baseline justify-between gap-4"><div><h2 className="text-xl font-semibold">Ejecuciones</h2><p className="mt-1 text-sm text-zinc-600">Cada proceso y todos sus eventos se conservan aquí.</p></div><span className="text-sm text-zinc-500">{history.length} guardadas</span></div><div className="mt-4 overflow-auto rounded-xl border border-zinc-200"><ul className="divide-y divide-zinc-100">{history.length ? history.map((item) => <li key={item.id}><a href={`/ejecuciones/${item.id}`} className={`flex flex-wrap items-center gap-x-4 gap-y-1 p-4 hover:bg-zinc-50 ${run?.id === item.id ? "bg-emerald-50" : ""}`}><span className="font-semibold text-zinc-900">{scopeLabel(item)}</span><span className="text-sm text-zinc-600">{formatMadridDateTime(item.created_at)}</span><span className="text-sm">{item.created_count} creados · {item.existing_count} existentes · {item.error_count} errores</span><span className="text-sm text-zinc-600">{durationLabel(item)}</span><span className="ml-auto text-sm font-medium text-zinc-700">{({ queued: "En cola", running: "En marcha", paused: "Pausada", stopped: "Detenida", completed: "Completada", failed: "Con error" } as const)[item.status]}</span></a></li>) : <li className="p-4 text-sm text-zinc-500">Todavía no hay ejecuciones guardadas.</li>}</ul></div></section>}
    </main>
  </div>;
}

function scopeLabel(run: Run) { if (run.mode === "id") return `Cliente #${run.parameters.customerId}`; if (run.mode === "from_date") return `Desde ${formatSpanishDate(String(run.parameters.fromDate))}`; if (run.mode === "all") return "Todos los clientes"; return `Últimos ${run.parameters.latest} clientes`; }
function formatSpanishDate(value: string) { const [year, month, day] = value.slice(0, 10).split("-"); return year && month && day ? `${day}/${month}/${year}` : value; }
function formatMadridDateTime(value: string) { return new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "short" }).format(new Date(value)); }
function formatMadridTime(value: string) { return new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", timeStyle: "medium" }).format(new Date(value)); }
function remainingEstimate(run: Run, events: ImportEvent[]) { if (!run.processed_count || run.processed_count >= run.total_count) return null; const processed = events.filter((event) => event.outcome !== "status"); if (processed.length >= 2) { const recent = processed.slice(-12); const intervals = recent.slice(1).map((item, index) => new Date(item.created_at).getTime() - new Date(recent[index].created_at).getTime()).filter((value) => value >= 0 && value < 60_000); if (intervals.length) return Math.round((intervals.reduce((sum, value) => sum + value, 0) / intervals.length) * (run.total_count - run.processed_count)); } if (!run.started_at) return null; const elapsed = Date.now() - new Date(run.started_at).getTime(); return Math.max(0, Math.round((elapsed / run.processed_count) * (run.total_count - run.processed_count))); }
function formatDuration(milliseconds: number) { const seconds = Math.max(0, Math.round(milliseconds / 1_000)); if (seconds < 60) return `${seconds} s`; const minutes = Math.floor(seconds / 60); const rest = seconds % 60; return rest ? `${minutes} min ${rest} s` : `${minutes} min`; }
function durationLabel(run: Run) { if (!run.started_at) return "Sin iniciar"; const end = run.finished_at ? new Date(run.finished_at).getTime() : Date.now(); return `Duración: ${formatDuration(end - new Date(run.started_at).getTime())}`; }
function shopifyUrl(id: string) { return `https://admin.shopify.com/store/${storeSlug}/customers/${id.split("/").pop()}`; }
function Counter({ label, value, color }: { label: string; value: number; color: string }) { return <div className="rounded-xl bg-zinc-50 p-3"><p className="text-sm text-zinc-500">{label}</p><p className={`mt-1 text-2xl font-semibold ${color}`}>{value}</p></div>; }
function StatusBadge({ status }: { status: Run["status"] }) { const label = ({ queued: "En cola", running: "En marcha", paused: "Pausada", stopped: "Detenida", completed: "Completada", failed: "Con error" } as const)[status]; return <span className="font-medium text-zinc-900">{label}</span>; }
