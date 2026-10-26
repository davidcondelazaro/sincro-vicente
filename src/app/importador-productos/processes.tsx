"use client";

import { useEffect, useRef, useState } from "react";
import { WARNING_KINDS } from "@/lib/mhd-importer/warning-kinds";

// Procesos del importador (docs/IMPORTADOR_PRODUCTOS_MHD.md): tandas de productos que procesa en producción el
// trabajador de Vercel, sin depender del ordenador de nadie. Se ve en directo qué hace con cada producto, cuánto tarda
// cada paso y el registro de decisiones, avisos, errores y motivos de revisión.

type JobStatus = "en_cola" | "en_curso" | "pausado" | "terminado" | "cancelado";
type Job = { id: string; title: string; status: JobStatus; paused_reason?: string | null; options: { concurrency?: number; workers?: number; upload?: boolean | "nuevos" }; created_by: string | null; created_at: string; started_at: string | null; finished_at: string | null; total: number; pendientes: number; en_curso: number; ok: number; descartados: number; errores: number; duracion_media_ms: number | null; coste_usd: number; ultima_actividad: string | null };
type Item = { id: number; codigo: string; family_code: string | null; status: "pendiente" | "en_curso" | "ok" | "descartado" | "error"; step: string | null; attempts: number; started_at: string | null; finished_at: string | null; duration_ms: number | null; cost_usd: number | null; run_id: string | null; error: string | null };
type Step = { step: string; veces: number; media_ms: number; max_ms: number; errores: number };
type LogEvent = { id: number; item_id: number | null; codigo: string | null; level: "info" | "decision" | "aviso" | "error" | "revision"; step: string; message: string; duration_ms: number | null; created_at: string };
type TreeFamily = { code: string; name: string; products: number; profile_status: "draft" | "reviewed" | null };
type TreeLine = { code: string; name: string; families: TreeFamily[] };

const POLL_MS = 5000;
const integer = new Intl.NumberFormat("es-ES", { useGrouping: "always", maximumFractionDigits: 0 });
const seconds = (ms: number | null | undefined) => (ms == null ? "—" : ms < 1000 ? `${ms} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1).replace(".", ",")} s` : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`);
const clock = (value: string | null) => (value ? new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "medium" }).format(new Date(value)) : "—");
const ago = (value: string | null, now: number) => { if (!value) return "—"; const s = Math.max(0, Math.round((now - new Date(value).getTime()) / 1000)); return s < 60 ? `hace ${s} s` : s < 3600 ? `hace ${Math.floor(s / 60)} min` : `hace ${Math.floor(s / 3600)} h`; };
const STATUS: Record<JobStatus, { label: string; badge: string }> = {
  en_cola: { label: "En cola", badge: "bg-zinc-100 text-zinc-700" }, en_curso: { label: "En curso", badge: "bg-sky-100 text-sky-800" },
  pausado: { label: "Pausado", badge: "bg-amber-100 text-amber-800" }, terminado: { label: "Terminado", badge: "bg-emerald-100 text-emerald-800" }, cancelado: { label: "Cancelado", badge: "bg-red-100 text-red-800" },
};
const ITEM_STATUS: Record<Item["status"], string> = { pendiente: "text-zinc-500", en_curso: "text-sky-700", ok: "text-emerald-700", descartado: "text-amber-700", error: "text-red-700" };
const LEVELS: Record<LogEvent["level"], { label: string; color: string }> = {
  info: { label: "Paso", color: "bg-zinc-100 text-zinc-600" }, decision: { label: "Decisión", color: "bg-violet-100 text-violet-800" },
  aviso: { label: "Aviso", color: "bg-amber-100 text-amber-800" }, error: { label: "Error", color: "bg-red-100 text-red-800" }, revision: { label: "Revisión", color: "bg-sky-100 text-sky-800" },
};
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Error de la API.");
  return body as T;
}
type Warning = { tipo: string; productos: number; avisos: number; ejemplos: string[] };
const KIND_BY_TIPO = new Map(WARNING_KINDS.map((kind) => [kind.tipo, kind]));
const DESTINOS = { mhd: "Informe a MHD", revisar: "Dudas para revisar", interno: "Nuestro" } as const;
function downloadWarnings(jobId: string, warnings: Warning[]) {
  const cell = (value: string | number) => `"${String(value).replaceAll("\"", "\"\"")}"`;
  const rows = [["tipo", "nombre", "para", "productos", "avisos", "ejemplos"], ...warnings.map((warning) => { const kind = KIND_BY_TIPO.get(warning.tipo); return [warning.tipo, kind?.nombre ?? warning.tipo, DESTINOS[kind?.destino ?? "interno"], warning.productos, warning.avisos, warning.ejemplos.join(" ")]; })];
  const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([rows.map((row) => row.map(cell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" })); link.download = `resumen-avisos-${jobId.slice(0, 8)}.csv`; link.click();
}
const post = (body: Record<string, unknown>) => api<{ ok: boolean; job?: string; items?: number; note?: string | null }>("/api/importador-productos/trabajos", { method: "POST", body: JSON.stringify(body) });

// Ritmo y tiempo restante a partir de lo terminado desde el arranque.
function pace(job: Job, now: number) {
  const done = job.ok + job.descartados + job.errores; const started = job.started_at ? new Date(job.started_at).getTime() : null;
  if (!started || !done) return { perMinute: null, eta: null };
  const elapsedMin = ((job.finished_at ? new Date(job.finished_at).getTime() : now) - started) / 60_000;
  const perMinute = done / Math.max(elapsedMin, 0.1); const left = job.pendientes + job.en_curso;
  return { perMinute, eta: left && job.status === "en_curso" ? left / perMinute : null };
}

export function ProcessesView() {
  const [jobs, setJobs] = useState<Job[]>([]); const [workers, setWorkers] = useState<{ slot: number; lease_until: string | null; heartbeat_at: string | null }[]>([]);
  const [mirror, setMirror] = useState<{ status: string; started_at: string; finished_at: string | null; products: number | null; variants: number | null; collections: number | null; error: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null); const [selected, setSelected] = useState<string | null>(null); const [creating, setCreating] = useState(false);
  const [version, setVersion] = useState(0); const [now, setNow] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () => api<{ jobs: Job[]; workers: typeof workers; mirror: typeof mirror }>("/api/importador-productos/trabajos").then((body) => { if (!alive) return; setNow(Date.now()); setJobs(body.jobs); setWorkers(body.workers); setMirror(body.mirror); setError(null); setSelected((current) => current ?? body.jobs[0]?.id ?? null); }).catch((caught: Error) => alive && setError(caught.message));
    load(); const timer = setInterval(load, POLL_MS);
    return () => { alive = false; clearInterval(timer); };
  }, [version]);
  const active = workers.filter((item) => item.lease_until && new Date(item.lease_until).getTime() > now);
  const working = active.length > 0;
  const lastBeat = workers.map((item) => item.heartbeat_at).filter(Boolean).sort().pop() ?? null;
  async function act(action: string, job: string) {
    if (action === "cancelar" && !window.confirm("¿Cancelar la tanda? Lo ya procesado se queda.")) return;
    try { await post({ action, job }); setVersion((current) => current + 1); } catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo."); }
  }

  return <section className="flex flex-col gap-5">
    <p className="text-sm text-zinc-600">Tandas de productos que se procesan en producción (Vercel y Supabase), sin depender de ningún ordenador: cada producto se monta como en la prueba (datos de MHD e Icecat, filtros, textos, fotos, etiqueta, documentos) y se guarda en Sincro; si la tanda lo pide, se sube además a Shopify en borrador. Aquí se ve en directo qué hace con cada uno, cuánto tarda cada paso y el registro de decisiones, avisos, errores y motivos de revisión.</p>
    {error && <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    <div className="flex flex-wrap items-center gap-3">
      <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm ${working ? "bg-sky-100 text-sky-800" : "bg-zinc-100 text-zinc-600"}`}><span className={`h-2 w-2 rounded-full ${working ? "animate-pulse bg-sky-600" : "bg-zinc-400"}`} />{working ? `${active.length} trabajador${active.length > 1 ? "es" : ""} procesando` : "Trabajadores en espera"}{lastBeat ? ` · última señal ${ago(lastBeat, now)}` : ""}</span>
      <span className="text-sm text-zinc-600">Espejo de la tienda: {!mirror ? "sin hacer" : mirror.status === "running" ? `actualizándose (desde ${ago(mirror.started_at, now)})` : mirror.status === "error" ? <span className="text-red-700">falló ({mirror.error})</span> : `${integer.format(mirror.products ?? 0)} productos · ${ago(mirror.finished_at, now)}`}</span>
      <button type="button" onClick={() => act("espejo", "")} className="h-10 rounded-lg border border-zinc-300 px-4 text-sm font-medium text-zinc-700">Actualizar espejo</button>
      <button type="button" onClick={() => setCreating(!creating)} className="h-10 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white">{creating ? "Cerrar" : "Nueva tanda"}</button>
    </div>
    {creating && <NewJob onCreated={(id) => { setCreating(false); setSelected(id); setVersion((current) => current + 1); }} />}
    {!jobs.length ? <p className="rounded-xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500">Todavía no hay tandas.</p>
      : <div className="flex flex-col gap-3">{jobs.map((job) => <JobCard key={job.id} job={job} now={now} selected={selected === job.id} onSelect={() => setSelected(selected === job.id ? null : job.id)} onAction={(action) => act(action, job.id)} />)}</div>}
    {selected && <JobDetail key={selected} jobId={selected} now={now} />}
  </section>;
}

function JobCard({ job, now, selected, onSelect, onAction }: { job: Job; now: number; selected: boolean; onSelect: () => void; onAction: (action: string) => void }) {
  const done = job.ok + job.descartados + job.errores; const { perMinute, eta } = pace(job, now);
  const stalled = job.status === "en_curso" && job.ultima_actividad && now - new Date(job.ultima_actividad).getTime() > 5 * 60_000;
  const bar = (count: number, color: string) => (job.total ? <span className={color} style={{ width: `${(count / job.total) * 100}%` }} /> : null);
  return <article className={`rounded-2xl border bg-white p-4 shadow-sm ${selected ? "border-zinc-900" : "border-zinc-200"}`}>
    <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <button type="button" onClick={onSelect} className="text-left text-base font-semibold text-zinc-900 underline-offset-2 hover:underline">{job.title}</button>
      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS[job.status].badge}`}>{STATUS[job.status].label}</span>
      {stalled && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">Sin avances {ago(job.ultima_actividad, now)}</span>}
      <span className="ml-auto text-xs text-zinc-400">{job.created_by ?? "—"} · {clock(job.created_at)}</span>
    </header>
    <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-zinc-100">{bar(job.ok, "bg-emerald-500")}{bar(job.descartados, "bg-amber-400")}{bar(job.errores, "bg-red-500")}{bar(job.en_curso, "bg-sky-400 animate-pulse")}</div>
    <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4 lg:grid-cols-8">
      {([["Hechos", `${integer.format(done)} de ${integer.format(job.total)}`], ["Bien", integer.format(job.ok)], ["Descartados", integer.format(job.descartados)], ["Errores", integer.format(job.errores)], ["En curso", integer.format(job.en_curso)], ["Media por producto", seconds(job.duracion_media_ms)], ["Ritmo", perMinute ? `${perMinute.toFixed(1).replace(".", ",")}/min` : "—"], [job.status === "en_curso" ? "Quedan" : "Coste", job.status === "en_curso" ? (eta ? `~${eta < 60 ? `${Math.ceil(eta)} min` : `${(eta / 60).toFixed(1).replace(".", ",")} h`}` : "—") : `${Number(job.coste_usd).toFixed(2).replace(".", ",")} $`]] as const).map(([label, value]) => <div key={label}><dt className="text-xs text-zinc-500">{label}</dt><dd className="font-medium tabular-nums text-zinc-900">{value}</dd></div>)}
    </dl>
    <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
      <span className="text-xs text-zinc-500">Última actividad: {ago(job.ultima_actividad, now)} · coste {Number(job.coste_usd).toFixed(2).replace(".", ",")} $ · {job.options.workers ?? 1} × {job.options.concurrency ?? 4} a la vez{job.options.upload === "nuevos" ? " · sube a Shopify solo los nuevos" : job.options.upload ? " · sube a Shopify" : ""}</span>
      {job.status === "pausado" && job.paused_reason && <span className="basis-full text-xs font-medium text-red-700">Pausada: {job.paused_reason}</span>}
      <span className="ml-auto flex flex-wrap gap-2">
        {(job.status === "en_cola" || job.status === "en_curso") && <button type="button" onClick={() => onAction("pausar")} className="h-8 rounded-lg border border-zinc-300 px-3 text-xs font-medium">Pausar</button>}
        {job.status === "pausado" && <button type="button" onClick={() => onAction("reanudar")} className="h-8 rounded-lg bg-zinc-900 px-3 text-xs font-medium text-white">Reanudar</button>}
        {job.errores > 0 && <button type="button" onClick={() => onAction("reintentar")} className="h-8 rounded-lg border border-zinc-300 px-3 text-xs font-medium">Reintentar errores</button>}
        {job.status !== "terminado" && job.status !== "cancelado" && <button type="button" onClick={() => onAction("cancelar")} className="h-8 rounded-lg border border-red-200 px-3 text-xs font-medium text-red-700">Cancelar</button>}
        <button type="button" onClick={onSelect} className="h-8 rounded-lg border border-zinc-300 px-3 text-xs font-medium">{selected ? "Ocultar detalle" : "Ver detalle"}</button>
      </span>
    </div>
  </article>;
}

function JobDetail({ jobId, now }: { jobId: string; now: number }) {
  const [steps, setSteps] = useState<Step[]>([]); const [items, setItems] = useState<Item[]>([]); const [log, setLog] = useState<{ key: string; list: LogEvent[] }>({ key: "", list: [] });
  const [itemStatus, setItemStatus] = useState<Item["status"] | "">(""); const [level, setLevel] = useState<LogEvent["level"] | "">(""); const [codigo, setCodigo] = useState("");
  const [warnings, setWarnings] = useState<Warning[]>([]); const [tipo, setTipo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const lastId = useRef(0);
  // Al cambiar los filtros del registro se carga de nuevo; después solo llega lo nuevo (since).
  useEffect(() => {
    let alive = true; lastId.current = 0; const key = `${level}|${codigo}|${tipo}`;
    const load = async () => {
      const query = new URLSearchParams({ job: jobId, ...(lastId.current ? { since: String(lastId.current) } : {}), ...(level ? { level } : {}), ...(codigo.trim() ? { codigo: codigo.trim() } : {}), ...(tipo ? { tipo } : {}) });
      try {
        const body = await api<{ steps: Step[]; items: Item[]; events: LogEvent[]; warnings: Warning[] }>(`/api/importador-productos/trabajos?${query}`);
        if (!alive) return;
        setSteps(body.steps); setItems(body.items); setWarnings(body.warnings ?? []); setError(null);
        if (body.events.length) lastId.current = Math.max(lastId.current, ...body.events.map((event) => event.id));
        // Con otros filtros, el registro empieza de nuevo; con los mismos, lo nuevo va delante.
        setLog((current) => ({ key, list: current.key === key ? [...body.events, ...current.list].slice(0, 1000) : body.events }));
      } catch (caught) { if (alive) setError(caught instanceof Error ? caught.message : "Error."); }
    };
    void load(); const timer = setInterval(load, POLL_MS);
    return () => { alive = false; clearInterval(timer); };
  }, [jobId, level, codigo, tipo]);
  const events = log.key === `${level}|${codigo}|${tipo}` ? log.list : [];
  const shownItems = items.filter((item) => !itemStatus || item.status === itemStatus);
  const running = items.filter((item) => item.status === "en_curso");
  const sortedSteps = [...steps].sort((a, b) => b.media_ms - a.media_ms); const slowest = sortedSteps[0]?.media_ms ?? 1;

  return <section className="flex flex-col gap-4 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
    {error && <p className="text-sm text-red-700">{error}</p>}
    {running.length > 0 && <div><h3 className="text-sm font-semibold text-zinc-900">Ahora mismo</h3><ul className="mt-2 flex flex-col gap-1 text-sm">{running.map((item) => <li key={item.id} className="flex flex-wrap gap-x-3"><button type="button" onClick={() => setCodigo(item.codigo)} className="font-medium text-sky-700 underline-offset-2 hover:underline">{item.codigo}</button><span className="text-zinc-500">{item.family_code}</span><span className="text-zinc-700">{item.step ? `«${item.step}»` : "empezando"}</span><span className="text-zinc-400">{ago(item.started_at, now)}</span></li>)}</ul></div>}
    {warnings.length > 0 && <div><div className="flex flex-wrap items-end justify-between gap-2"><h3 className="text-sm font-semibold text-zinc-900">Resumen de avisos, dudas y fallos</h3>
      <button type="button" onClick={() => downloadWarnings(jobId, warnings)} className="h-8 rounded-lg border border-zinc-300 px-2 text-xs">Descargar CSV</button></div>
      <p className="mt-1 text-xs text-zinc-500">Productos con cada tipo (un producto puede tener varios). Pulsa un tipo para ver su registro.</p>
      <div className="mt-2 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs text-zinc-500"><th className="py-1 font-medium">Tipo</th><th className="font-medium">Para</th><th className="font-medium">Productos</th><th className="hidden font-medium sm:table-cell">Ejemplos</th></tr></thead>
        <tbody>{warnings.map((warning) => { const kind = KIND_BY_TIPO.get(warning.tipo); return <tr key={warning.tipo} className="border-t border-zinc-100"><td className="py-1.5 pr-2"><button type="button" onClick={() => setTipo(warning.tipo)} className={`text-left underline-offset-2 hover:underline ${tipo === warning.tipo ? "font-semibold text-sky-800" : "text-sky-700"}`}>{kind?.nombre ?? warning.tipo}</button></td><td className="text-xs text-zinc-600">{DESTINOS[kind?.destino ?? "interno"]}</td><td className="tabular-nums">{integer.format(warning.productos)}</td><td className="hidden text-xs text-zinc-500 sm:table-cell">{warning.ejemplos.join(", ")}</td></tr>; })}</tbody></table></div>
    </div>}
    <div><h3 className="text-sm font-semibold text-zinc-900">Tiempo de cada paso</h3>
      {!sortedSteps.length ? <p className="mt-1 text-sm text-zinc-500">Aún no hay pasos terminados.</p> : <table className="mt-2 w-full text-sm"><thead><tr className="text-left text-xs text-zinc-500"><th className="py-1 font-medium">Paso</th><th className="font-medium">Veces</th><th className="font-medium">Media</th><th className="hidden font-medium sm:table-cell">Máximo</th><th className="font-medium">Errores</th></tr></thead>
        <tbody>{sortedSteps.map((step) => <tr key={step.step} className="border-t border-zinc-100"><td className="py-1.5 pr-2"><span className="block">{step.step}</span><span className="mt-1 block h-1.5 rounded-full bg-sky-200" style={{ width: `${Math.max(4, (step.media_ms / slowest) * 100)}%` }} /></td><td className="tabular-nums">{integer.format(step.veces)}</td><td className="tabular-nums">{seconds(step.media_ms)}</td><td className="hidden tabular-nums sm:table-cell">{seconds(step.max_ms)}</td><td className={`tabular-nums ${step.errores ? "text-red-700" : ""}`}>{integer.format(step.errores)}</td></tr>)}</tbody></table>}
    </div>
    <div><div className="flex flex-wrap items-end justify-between gap-2"><h3 className="text-sm font-semibold text-zinc-900">Productos</h3>
      <label className="text-xs text-zinc-600">Ver <select value={itemStatus} onChange={(event) => setItemStatus(event.target.value as typeof itemStatus)} className="ml-1 h-8 rounded-lg border border-zinc-300 bg-white px-2 text-xs"><option value="">todos</option><option value="en_curso">en curso</option><option value="pendiente">pendientes</option><option value="ok">bien</option><option value="descartado">descartados</option><option value="error">con error</option></select></label></div>
      <div className="mt-2 max-h-80 overflow-auto rounded-lg border border-zinc-100"><table className="w-full text-sm"><thead className="sticky top-0 bg-zinc-50"><tr className="text-left text-xs text-zinc-500"><th className="px-2 py-1 font-medium">Código</th><th className="font-medium">Familia</th><th className="font-medium">Estado</th><th className="font-medium">Tiempo</th><th className="hidden font-medium sm:table-cell">Coste</th><th className="font-medium">Detalle</th></tr></thead>
        <tbody>{shownItems.slice(0, 500).map((item) => <tr key={item.id} className="border-t border-zinc-100"><td className="px-2 py-1"><button type="button" onClick={() => setCodigo(item.codigo)} className="font-medium text-sky-700 underline-offset-2 hover:underline">{item.codigo}</button></td><td className="text-zinc-500">{item.family_code}</td><td className={ITEM_STATUS[item.status]}>{item.status.replace("_", " ")}{item.attempts > 1 ? ` (${item.attempts}.º intento)` : ""}</td><td className="tabular-nums">{seconds(item.duration_ms)}</td><td className="hidden tabular-nums sm:table-cell">{item.cost_usd != null ? `${Number(item.cost_usd).toFixed(4).replace(".", ",")} $` : "—"}</td><td className="max-w-xs truncate text-xs text-zinc-600" title={item.error ?? item.step ?? ""}>{item.error ?? (item.status === "en_curso" ? item.step ?? "empezando" : "")}</td></tr>)}</tbody></table></div>
      {shownItems.length > 500 && <p className="mt-1 text-xs text-zinc-500">Se muestran 500 de {integer.format(shownItems.length)}.</p>}
    </div>
    <div><div className="flex flex-wrap items-end gap-2"><h3 className="mr-auto text-sm font-semibold text-zinc-900">Registro</h3>
      <label className="text-xs text-zinc-600">Tipo <select value={level} onChange={(event) => setLevel(event.target.value as typeof level)} className="ml-1 h-8 rounded-lg border border-zinc-300 bg-white px-2 text-xs"><option value="">todo</option>{(Object.keys(LEVELS) as LogEvent["level"][]).map((key) => <option key={key} value={key}>{LEVELS[key].label}</option>)}</select></label>
      <label className="text-xs text-zinc-600">Producto <input value={codigo} onChange={(event) => setCodigo(event.target.value)} placeholder="código" className="ml-1 h-8 w-28 rounded-lg border border-zinc-300 px-2 text-xs" /></label>
      {(level || codigo || tipo) && <button type="button" onClick={() => { setLevel(""); setCodigo(""); setTipo(""); }} className="h-8 rounded-lg border border-zinc-300 px-2 text-xs">Quitar filtros</button>}</div>
      <ol className="mt-2 flex max-h-[32rem] flex-col gap-1 overflow-auto text-sm">{events.map((event) => <li key={event.id} className="flex flex-wrap items-baseline gap-x-2 border-b border-zinc-50 py-1">
        <span className="w-16 shrink-0 text-xs tabular-nums text-zinc-400">{new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", timeStyle: "medium" }).format(new Date(event.created_at))}</span>
        <span className={`shrink-0 rounded px-1.5 text-xs font-medium ${LEVELS[event.level].color}`}>{LEVELS[event.level].label}</span>
        {event.codigo && <button type="button" onClick={() => setCodigo(event.codigo!)} className="shrink-0 text-xs font-medium text-sky-700">{event.codigo}</button>}
        <span className="shrink-0 text-xs text-zinc-500">{event.step}</span>
        <span className="min-w-0 flex-1 break-words text-zinc-800">{event.message}</span>
        {event.duration_ms != null && <span className="shrink-0 text-xs tabular-nums text-zinc-400">{seconds(event.duration_ms)}</span>}
      </li>)}{!events.length && <li className="text-sm text-zinc-500">Sin hechos todavía.</li>}</ol>
    </div>
  </section>;
}

function NewJob({ onCreated }: { onCreated: (id: string) => void }) {
  const [mode, setMode] = useState<"familias" | "banco" | "codigos">("familias"); const [tree, setTree] = useState<TreeLine[]>([]); const [chosen, setChosen] = useState<string[]>([]);
  const [codes, setCodes] = useState(""); const [title, setTitle] = useState(""); const [concurrency, setConcurrency] = useState(6); const [workerCount, setWorkerCount] = useState(2); const [upload, setUpload] = useState<"no" | "nuevos" | "todos">("no"); const [skipDone, setSkipDone] = useState(true);
  const [search, setSearch] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  useEffect(() => { api<{ tree: TreeLine[] }>("/api/importador-productos/familias").then((body) => setTree(body.tree ?? []), (caught: Error) => setError(caught.message)); }, []);
  const families = tree.flatMap((line) => line.families.filter((family) => family.products > 0).map((family) => ({ ...family, line: line.name })));
  const term = search.trim().toLowerCase();
  const visible = families.filter((family) => !term || `${family.code} ${family.name} ${family.line}`.toLowerCase().includes(term));
  const total = families.filter((family) => chosen.includes(family.code)).reduce((sum, family) => sum + family.products, 0);
  async function create() {
    setBusy(true); setError(null);
    try {
      const body = await post({ action: "crear", title, workers: workerCount, concurrency, skipDone, upload: upload === "nuevos" ? "nuevos" : upload === "todos", ...(mode === "banco" ? { bench: true } : mode === "codigos" ? { codes: codes.split(/[\s,;]+/) } : { families: chosen }) });
      if (body.note) window.alert(body.note);
      onCreated(body.job!);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo crear."); } finally { setBusy(false); }
  }
  return <div className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
    <div className="flex flex-wrap gap-2">{([["familias", "Familias"], ["banco", "Banco de prueba"], ["codigos", "Lista de códigos"]] as const).map(([key, label]) => <button key={key} type="button" onClick={() => setMode(key)} className={`h-9 rounded-lg px-3 text-sm font-medium ${mode === key ? "bg-zinc-900 text-white" : "border border-zinc-300 text-zinc-700"}`}>{label}</button>)}</div>
    {mode === "familias" && <>
      <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar familia" className="h-10 rounded-lg border border-zinc-300 px-3 text-sm" />
      <div className="max-h-72 overflow-auto rounded-lg border border-zinc-100 p-2">{visible.map((family) => <label key={family.code} className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-zinc-50"><input type="checkbox" checked={chosen.includes(family.code)} onChange={(event) => setChosen((current) => (event.target.checked ? [...current, family.code] : current.filter((code) => code !== family.code)))} /><span className="text-zinc-900">{family.name}</span><span className="text-xs text-zinc-400">{family.code}</span><span className={`rounded-full px-1.5 text-xs ${family.profile_status === "reviewed" ? "bg-emerald-100 text-emerald-800" : family.profile_status === "draft" ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800"}`}>{family.profile_status === "reviewed" ? "revisado" : family.profile_status === "draft" ? "borrador" : "sin perfil"}</span><span className="ml-auto text-xs tabular-nums text-zinc-500">{integer.format(family.products)}</span></label>)}</div>
      <p className="text-xs text-zinc-500">{chosen.length} familias · {integer.format(total)} productos (antes de quitar los ya hechos)</p>
    </>}
    {mode === "codigos" && <textarea value={codes} onChange={(event) => setCodes(event.target.value)} rows={4} placeholder="Códigos de MHD o EAN, separados por espacios, comas o líneas" className="rounded-lg border border-zinc-300 p-2 text-sm" />}
    <div className="flex flex-wrap items-end gap-3">
      <label className="min-w-48 flex-1 text-sm font-medium text-zinc-700">Nombre de la tanda<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Opcional" className="mt-1 block h-10 w-full rounded-lg border border-zinc-300 px-3 text-sm" /></label>
      <label className="text-sm font-medium text-zinc-700">Trabajadores<select value={workerCount} onChange={(event) => setWorkerCount(Number(event.target.value))} className="mt-1 block h-10 rounded-lg border border-zinc-300 bg-white px-2 text-sm">{[1, 2, 3, 4, 5, 6].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label className="text-sm font-medium text-zinc-700">Productos por trabajador<select value={concurrency} onChange={(event) => setConcurrency(Number(event.target.value))} className="mt-1 block h-10 rounded-lg border border-zinc-300 bg-white px-2 text-sm">{[1, 2, 4, 6, 8, 10, 12].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <span className="self-center text-xs text-zinc-500">{workerCount * concurrency} a la vez</span>
      <label className="flex h-10 items-center gap-2 text-sm text-zinc-700"><input type="checkbox" checked={skipDone} onChange={(event) => setSkipDone(event.target.checked)} />Solo los que faltan</label>
      <label className="text-sm font-medium text-zinc-700">Subir a Shopify<select value={upload} onChange={(event) => setUpload(event.target.value as typeof upload)} className="mt-1 block h-10 rounded-lg border border-zinc-300 bg-white px-2 text-sm"><option value="no">No</option><option value="nuevos">Solo los nuevos (borrador)</option><option value="todos">Todos (refresca los que ya están)</option></select></label>
      <button type="button" disabled={busy || (mode === "familias" && !chosen.length) || (mode === "codigos" && !codes.trim())} onClick={create} className="h-10 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white disabled:opacity-50">{busy ? "Creando…" : "Encolar y empezar"}</button>
    </div>
    {error && <p className="text-sm text-red-700">{error}</p>}
  </div>;
}
