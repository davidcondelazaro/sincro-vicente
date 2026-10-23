"use client";

import { useCallback, useEffect, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { createClient } from "@/lib/supabase/client";

type EntityProgress = { done?: number; total?: number; estimated?: number; pages?: number; part_done?: Record<string, number>; part_total?: Record<string, number>; started_at?: string; completed_at?: string; rate_from?: string; rate_done?: number };
type PageError = { entity: string; part: number; page: number; attempts: number; error: string; at: string };
type Status = "running" | "stopped" | "completed" | "failed" | "discarded";
type Run = {
  id: string; kind: string; status: Status; entities: string[]; stop_requested: boolean;
  cursor: { entity_index?: number; part?: number; page?: number; failures?: number };
  entity_progress: Record<string, EntityProgress>; record_counts: Record<string, number>; progress: { phase?: string; entity_timings?: Record<string, { started_at: string; completed_at?: string }> };
  error_message: string | null; started_at: string; completed_at: string | null; last_activity_at: string | null;
  page_errors: PageError[];
};

const labels: Record<string, string> = { categories: "Categorías", brands: "Marcas", products: "Productos", prices: "Precios", stock: "Stock", details: "Fichas de detalle" };
const kindLabels: Record<string, string> = { full: "Completa", ...labels, details_all: "Todas las fichas" };
const pageSizes: Record<string, number> = { categories: 1000, brands: 1000, products: 1000, prices: 5000, stock: 5000, details: 60 };
const launchers = [
  { kind: "full", detail: "Categorías, marcas, productos, precios, stock y las fichas nuevas o cambiadas." },
  { kind: "categories", detail: "Los tres niveles: líneas, familias y subfamilias." },
  { kind: "brands", detail: "Listado de marcas." },
  { kind: "products", detail: "Catálogo de productos." },
  { kind: "prices", detail: "Todos los precios (/prices)." },
  { kind: "stock", detail: "Todo el stock (/stocks)." },
  { kind: "details", detail: "Fichas (características y fotos) que faltan o que MHD ha modificado. Una petición por producto, de 2 en 2." },
  { kind: "details_all", detail: "Todas las fichas otra vez, aunque no hayan cambiado. Tarda horas." },
];
const STALL_MS = 60_000;

export default function MhdImportPage() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [clockOffset, setClockOffset] = useState(0);

  const load = useCallback(async () => {
    const response = await fetch("/api/mhd-catalog-import", { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "No se pudo consultar MHD.");
    setRuns(body.runs ?? []);
    if (body.now) setClockOffset(new Date(body.now).getTime() - Date.now());
  }, []);
  useEffect(() => { void load().catch((caught) => setError(caught.message)); createClient().auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null)); }, [load]);

  const active = runs.find((run) => run.status === "running" || run.status === "stopped");
  const running = active?.status === "running";
  useEffect(() => {
    if (!running) return;
    const reload = window.setInterval(() => void load().catch((caught) => setError(caught.message)), 3_000);
    const clock = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => { window.clearInterval(reload); window.clearInterval(clock); };
  }, [running, load]);

  async function act(payload: Record<string, string>) {
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/mhd-catalog-import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "No se pudo completar la acción.");
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Error inesperado."); } finally { setBusy(false); }
  }

  const serverNow = now + clockOffset;
  return <div className="min-h-screen bg-zinc-50 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]"><AppSidebar active="mhdImport" userEmail={email} /><main className="mx-auto flex w-full max-w-5xl flex-col gap-7 px-6 pb-24 pt-28 sm:px-10 lg:mx-0 lg:py-16">
    <header><h1 className="text-4xl font-semibold tracking-tight text-zinc-950">Importar de MHD</h1><p className="mt-3 max-w-3xl text-zinc-600">Copia el catálogo desde la API de MHD a Supabase, página a página. Si se corta, se reanuda desde la última página buena. Todavía no marca bajas (pendiente).</p></header>
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">{error}</p>}

    <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <h2 className="text-xl font-semibold">Lanzar importación</h2>
      <p className="mt-1 text-sm text-zinc-600">{active ? "Hay una importación en curso o detenida: termina, reanúdala o descártala antes de lanzar otra." : "Todas son manuales. Solo puede haber una a la vez."}</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{launchers.map(({ kind, detail }) => <button key={kind} onClick={() => act({ action: "start", kind })} disabled={Boolean(active) || busy} className={`rounded-xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${kind === "full" ? "border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-800" : "border-zinc-200 bg-white hover:border-emerald-600"}`}><span className="block font-semibold">{kind === "full" ? "Importación completa" : kindLabels[kind]}</span><span className={`mt-1 block text-sm ${kind === "full" ? "text-emerald-50" : "text-zinc-600"}`}>{detail}</span></button>)}</div>
    </section>

    {active && <ActiveRun run={active} now={serverNow} busy={busy} act={act} />}

    <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-baseline justify-between gap-4"><div><h2 className="text-xl font-semibold">Histórico</h2><p className="mt-1 text-sm text-zinc-600">Cada ejecución conserva sus totales y la duración de cada parte.</p></div><span className="text-sm text-zinc-500">{runs.length} ejecuciones recientes</span></div>
      <div className="mt-4 overflow-hidden rounded-xl border border-zinc-200"><ul className="divide-y divide-zinc-100">{runs.length ? runs.map((run) => <li key={run.id} className="p-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1"><StatusBadge status={run.status} /><span className="text-sm font-semibold text-zinc-900">{kindLabels[run.kind] ?? run.kind}</span><time className="text-sm text-zinc-600">{formatDate(run.started_at)}</time><span className="text-sm text-zinc-600">Duración: {formatDuration(elapsedMs(run.started_at, run.completed_at ?? run.last_activity_at, serverNow))}</span></div>
        <div className="mt-3 grid gap-2 sm:grid-cols-5">{(run.entities ?? Object.keys(labels)).map((key) => <EntitySummary key={key} label={labels[key] ?? key} progress={run.entity_progress?.[key]} legacyCount={run.record_counts?.[key]} legacyTiming={run.progress?.entity_timings?.[key]} now={serverNow} runEnd={run.status === "running" ? null : run.completed_at ?? run.last_activity_at} />)}</div>
        {run.error_message && <p className="mt-3 text-sm text-red-700">{run.error_message}</p>}
      </li>) : <li className="p-4 text-sm text-zinc-500">Todavía no hay importaciones MHD.</li>}</ul></div></section>
  </main></div>;
}

function ActiveRun({ run, now, busy, act }: { run: Run; now: number; busy: boolean; act: (payload: Record<string, string>) => Promise<void> }) {
  const entityIndex = run.cursor.entity_index ?? 0;
  const current = run.entities[entityIndex];
  const totals = run.entities.map((entity, index) => {
    const progress = run.entity_progress?.[entity] ?? {};
    const total = progress.total || progress.estimated || 0;
    const done = index < entityIndex ? Math.max(total, progress.done ?? 0) : progress.done ?? 0;
    return { entity, done, total: Math.max(total, done) };
  });
  const globalDone = totals.reduce((sum, item) => sum + item.done, 0);
  const globalTotal = totals.reduce((sum, item) => sum + item.total, 0);
  const globalPercent = globalTotal ? Math.min(100, Math.floor((globalDone * 100) / globalTotal)) : 0;

  const progress = current ? run.entity_progress?.[current] ?? {} : {};
  const done = progress.done ?? 0;
  const total = progress.total || progress.estimated || 0;
  // Tras una reanudación el ritmo se mide desde ella, sin contar el rato detenida.
  const rateFrom = progress.rate_from ?? progress.started_at;
  const rateDone = done - (progress.rate_from ? progress.rate_done ?? 0 : 0);
  const rateElapsed = rateFrom ? now - new Date(rateFrom).getTime() : 0;
  const rate = run.status === "running" && rateDone > 0 && rateElapsed > 0 ? rateDone / (rateElapsed / 1000) : null;
  const remaining = rate && total > done ? ((total - done) / rate) * 1000 : null;
  const totalPages = current && total ? Math.ceil(total / (pageSizes[current] ?? 1000)) : null;
  const lastActivity = run.last_activity_at ? now - new Date(run.last_activity_at).getTime() : null;
  const stalled = run.status === "running" && lastActivity !== null && lastActivity > STALL_MS;

  return <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex items-center gap-3"><h2 className="text-xl font-semibold">Importación {(kindLabels[run.kind] ?? run.kind).toLowerCase()}</h2><StatusBadge status={run.status} /></div><p className="mt-1 text-sm text-zinc-600">Empezó {formatDate(run.started_at)} · lleva {formatDuration(now - new Date(run.started_at).getTime())}</p></div>
      <div className="flex gap-2">
        {run.status === "running" && <button onClick={() => act({ action: "stop", runId: run.id })} disabled={busy || run.stop_requested} className="h-10 rounded-lg border border-zinc-300 px-4 text-sm font-medium hover:bg-zinc-50 disabled:opacity-60">{run.stop_requested ? "Deteniendo al acabar la página…" : "Detener"}</button>}
        {run.status === "stopped" && <><button onClick={() => act({ action: "resume", runId: run.id })} disabled={busy} className="h-10 rounded-lg bg-emerald-700 px-4 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-60">Reanudar</button><button onClick={() => act({ action: "discard", runId: run.id })} disabled={busy} className="h-10 rounded-lg border border-zinc-300 px-4 text-sm font-medium hover:bg-zinc-50 disabled:opacity-60">Descartar</button></>}
      </div></div>

    <div className="mt-5"><div className="mb-2 flex justify-between text-sm font-medium text-zinc-700"><span>Total: {globalDone.toLocaleString("es-ES")} de {globalTotal ? `~${globalTotal.toLocaleString("es-ES")}` : "…"} registros</span><span className="font-semibold text-emerald-700">{globalPercent}%</span></div><Bar percent={globalPercent} /></div>

    <div className="mt-5 grid gap-3">{totals.map(({ entity, done: entityDone, total: entityTotal }, index) => {
      const percent = entityTotal ? Math.min(100, Math.floor((entityDone * 100) / entityTotal)) : 0;
      const isCurrent = index === entityIndex && run.status !== "completed";
      return <div key={entity} className={`rounded-lg border p-3 ${isCurrent ? "border-emerald-200 bg-emerald-50/40" : "border-zinc-100"}`}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 text-sm"><span className="font-semibold text-zinc-900">{labels[entity]}{index < entityIndex ? " ✓" : ""}</span><span className="text-zinc-600">{entityDone.toLocaleString("es-ES")} / {entityTotal ? entityTotal.toLocaleString("es-ES") : "…"} · {percent}%</span></div>
        <div className="mt-2"><Bar percent={percent} small /></div>
        {isCurrent && <p className="mt-2 text-sm text-zinc-600">{entity === "categories" ? `Nivel ${(run.cursor.part ?? 0) + 1} de 3` : `${entity === "details" ? "Tanda" : "Página"} ${run.cursor.page ?? 1}${totalPages ? ` de ${totalPages}` : ""}`}{rate ? ` · ${Math.round(rate).toLocaleString("es-ES")} registros/s` : ""}{remaining !== null ? ` · quedan ~${formatDuration(remaining)}` : ""}{run.cursor.failures ? ` · reintento ${run.cursor.failures} de 2` : ""}</p>}
      </div>;
    })}</div>

    <p className={`mt-4 rounded-lg p-3 text-sm ${stalled ? "border border-red-200 bg-red-50 font-medium text-red-800" : "bg-zinc-50 text-zinc-600"}`}>
      Último avance: {run.last_activity_at ? `${formatDate(run.last_activity_at)} (hace ${formatDuration(lastActivity ?? 0)})` : "—"}
      {stalled && " · Sin avances desde hace más de 1 minuto. El vigilante la relanza cada 2 minutos; si sigue parada, detenla y reanúdala."}
      {run.status === "stopped" && " · Detenida: al reanudar sigue desde esta página."}
    </p>
    {run.error_message && <p className="mt-3 text-sm text-red-700">{run.error_message}</p>}
    {run.page_errors?.length > 0 && <PageErrors errors={run.page_errors} />}
  </section>;
}

function PageErrors({ errors }: { errors: PageError[] }) {
  return <div className="mt-4"><h3 className="text-sm font-semibold text-zinc-900">Errores por página</h3><div className="mt-2 overflow-x-auto rounded-lg border border-zinc-200"><table className="w-full text-left text-sm"><thead className="bg-zinc-50 text-zinc-600"><tr><th className="px-3 py-2">Hora</th><th className="px-3 py-2">Entidad</th><th className="px-3 py-2">Página</th><th className="px-3 py-2">Intentos</th><th className="px-3 py-2">Error</th></tr></thead><tbody className="divide-y divide-zinc-100">{errors.map((item, index) => <tr key={index}><td className="whitespace-nowrap px-3 py-2">{formatDate(item.at)}</td><td className="px-3 py-2">{labels[item.entity] ?? item.entity}{item.entity === "categories" ? ` (nivel ${item.part + 1})` : ""}</td><td className="px-3 py-2">{item.page}</td><td className="px-3 py-2">{item.attempts}</td><td className="px-3 py-2 text-red-700">{item.error}</td></tr>)}</tbody></table></div></div>;
}


function EntitySummary({ label, progress, legacyCount, legacyTiming, now, runEnd }: { label: string; progress?: EntityProgress; legacyCount?: number; legacyTiming?: { started_at: string; completed_at?: string }; now: number; runEnd: string | null }) {
  const count = progress?.done ?? legacyCount;
  const startedAt = progress?.started_at ?? legacyTiming?.started_at;
  const completedAt = progress?.completed_at ?? legacyTiming?.completed_at;
  // Una parte sin cerrar de una ejecución ya terminada cuenta hasta el final de la ejecución.
  const duration = startedAt ? formatDuration(elapsedMs(startedAt, completedAt ?? runEnd, now)) : "Pendiente";
  return <div className="rounded-lg bg-zinc-50 p-3"><p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p><p className="mt-1 font-semibold text-zinc-900">{count !== undefined ? count.toLocaleString("es-ES") : "—"}</p><p className="text-xs text-zinc-500">{startedAt && !completedAt ? `${duration} (sin terminar)` : duration}</p></div>;
}
function Bar({ percent, small = false }: { percent: number; small?: boolean }) { return <div className={`${small ? "h-2" : "h-3"} overflow-hidden rounded-full bg-zinc-100`}><div className="h-full bg-emerald-600 transition-all" style={{ width: `${percent}%` }} /></div>; }
function StatusBadge({ status }: { status: Status }) {
  const detail: Record<Status, [string, string]> = { completed: ["Completada", "bg-emerald-50 text-emerald-800"], failed: ["Con error", "bg-red-50 text-red-800"], running: ["En curso", "bg-amber-50 text-amber-800"], stopped: ["Detenida", "bg-zinc-100 text-zinc-700"], discarded: ["Descartada", "bg-zinc-100 text-zinc-500"] };
  const [text, style] = detail[status] ?? [status, "bg-zinc-100 text-zinc-700"];
  return <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${style}`}>{text}</span>;
}
function elapsedMs(startedAt: string, completedAt: string | null, now: number) { return Math.max(0, (completedAt ? new Date(completedAt).getTime() : now) - new Date(startedAt).getTime()); }
function formatDuration(milliseconds: number) { const seconds = Math.round(Math.max(0, milliseconds) / 1_000); if (seconds < 60) return `${seconds} s`; const hours = Math.floor(seconds / 3600); const minutes = Math.floor((seconds % 3600) / 60); const rest = seconds % 60; return hours ? `${hours} h ${minutes} min` : `${minutes} min ${rest} s`; }
function formatDate(value: string) { return new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "medium" }).format(new Date(value)); }
