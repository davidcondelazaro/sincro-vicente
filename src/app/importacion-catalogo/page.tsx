"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { createClient } from "@/lib/supabase/client";

type Entity = "manufacturers" | "categories" | "features" | "products";
type Run = { id: string; entity_type: Entity; filters: { onlyActive?: boolean; manufacturerId?: string; categoryId?: string; featureId?: string; productId?: string; productIds?: string[]; modifiedSince?: string; forceImages?: boolean; name?: string }; status: "queued" | "running" | "paused" | "stopped" | "completed" | "failed"; total_count: number; processed_count: number; created_count: number; updated_count: number; unchanged_count: number; unpublished_count: number; error_count: number; created_at: string; started_at: string | null; finished_at: string | null };
type ImportEvent = { id: number; run_id: string; level: "info" | "success" | "warning" | "error"; outcome: "created" | "updated" | "error" | "status"; source_entity_id: string | null; source_entity_name: string | null; shopify_resource_id: string | null; message: string; created_at: string };

const entities: { value: Entity; label: string; description: string }[] = [
  { value: "manufacturers", label: "Marcas", description: "Crea o actualiza las colecciones inteligentes de marca en Shopify a partir del catálogo importado en Supabase." },
  { value: "categories", label: "Categorías", description: "Crea las categorías que falten. Las existentes no se modifican; si están inactivas —o lo está alguno de sus padres— se retiran de todos los canales, sin borrarlas." },
  { value: "features", label: "Características", description: "Crea únicamente las definiciones abiertas de producto que falten. Las que ya existen y los valores de los productos no se modifican." },
  { value: "products", label: "Productos", description: "Valida todos los enlaces de origen antes de crear o actualizar el producto en Shopify." },
];

export default function CatalogImportPage() {
  const [entityType, setEntityType] = useState<Entity>("manufacturers");
  const [manufacturerId, setManufacturerId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [featureId, setFeatureId] = useState("");
  const [productId, setProductId] = useState("");
  const [modifiedSince, setModifiedSince] = useState("");
  const [forceImages, setForceImages] = useState(false);
  const [name, setName] = useState("");
  const [onlyActive, setOnlyActive] = useState(true);
  const [run, setRun] = useState<Run | null>(null);
  const [history, setHistory] = useState<Run[]>([]);
  const [historyEntity, setHistoryEntity] = useState<Entity | "all">("all");
  const [historyFrom, setHistoryFrom] = useState("");
  const [historyUntil, setHistoryUntil] = useState("");
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
    const { data } = await createClient().from("catalog_import_events").select("*").eq("run_id", runId).order("id", { ascending: true }).limit(300);
    setEvents((data ?? []) as ImportEvent[]);
  }, []);
  const loadRuns = useCallback(async () => {
    const search = new URLSearchParams({ page: String(historyPage) });
    if (historyEntity !== "all") search.set("entityType", historyEntity);
    if (historyFrom) search.set("from", historyFrom);
    if (historyUntil) search.set("until", historyUntil);
    const response = await fetch(`/api/catalog/runs?${search.toString()}`, { cache: "no-store" });
    const body = await response.json();
    if (response.ok) {
      const runs = body.runs as Run[];
      setHistory(runs);
      setHistoryHasMore(Boolean(body.hasMore));
      setRun((current) => { const selected = current ? runs.find((item) => item.id === current.id) ?? runs[0] ?? null : runs[0] ?? null; if (selected) void loadEvents(selected.id); return selected; });
    } else setError(body.error ?? "No se pudo cargar el historial.");
    setLoading(false);
  }, [historyEntity, historyFrom, historyUntil, historyPage, loadEvents]);

  useEffect(() => { const timer = window.setTimeout(() => { void loadRuns(); }, 0); return () => window.clearTimeout(timer); }, [loadRuns]);
  useEffect(() => { createClient().auth.getUser().then(({ data }) => setUserEmail(data.user?.email ?? null)); }, []);
  useEffect(() => { if (entityType === "products") setOnlyActive(false); }, [entityType]);
  const activeRunId = run?.id;
  const activeRunStatus = run?.status;
  useEffect(() => {
    if (!activeRunId) return;
    const supabase = createClient();
    const channel = supabase.channel(`catalog-import-${activeRunId}`).on("postgres_changes", { event: "*", schema: "public", table: "catalog_import_runs", filter: `id=eq.${activeRunId}` }, () => { void loadRuns(); }).on("postgres_changes", { event: "INSERT", schema: "public", table: "catalog_import_events", filter: `run_id=eq.${activeRunId}` }, () => { void loadEvents(activeRunId); }).subscribe();
    const timer = activeRunStatus === "queued" || activeRunStatus === "running" ? window.setInterval(() => { void loadRuns(); }, 3_000) : undefined;
    return () => { if (timer) window.clearInterval(timer); void supabase.removeChannel(channel); };
  }, [activeRunId, activeRunStatus, loadEvents, loadRuns]);

  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setStarting(true); setError(null);
    try {
      const response = await fetch("/api/catalog/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entityType, manufacturerId, categoryId, featureId, productId, modifiedSince, forceImages, onlyActive }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "No se pudo iniciar la importación.");
      setHistoryPage(0); setRun(body.run); setHistory((items) => [body.run, ...items.filter((item) => item.id !== body.run.id)]); setEvents([]); setLogsExpanded(true); await loadEvents(body.run.id);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Error inesperado."); } finally { setStarting(false); }
  }
  async function changeStatus(status: "paused" | "stopped" | "queued") {
    if (!run) return; setChanging(true); setError(null);
    try { const response = await fetch(`/api/catalog/runs/${run.id}/status`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "No se pudo actualizar la ejecución."); await loadRuns(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Error inesperado."); } finally { setChanging(false); }
  }

  const active = Boolean(run && ["queued", "running", "paused"].includes(run.status));
  const progress = run?.total_count ? Math.round((run.processed_count / run.total_count) * 100) : 0;
  const estimate = run ? remainingEstimate(run, events) : null;
  const elapsed = run?.started_at ? Math.max(0, (run.finished_at ? new Date(run.finished_at).getTime() : Date.now()) - new Date(run.started_at).getTime()) : null;
  const entityWord = run?.entity_type === "categories" ? "categoría" : run?.entity_type === "features" ? "característica" : run?.entity_type === "products" ? "producto" : "marca";
  const etaText = estimate && run ? `Tiempo transcurrido: ${formatDuration(elapsed ?? 0)} · restante estimado: ${formatDuration(estimate)} · promedio: ${formatDuration(Math.round(estimate / Math.max(1, run.total_count - run.processed_count)))} por ${entityWord}` : elapsed !== null ? `Tiempo transcurrido: ${formatDuration(elapsed)} · calculando el tiempo restante…` : "Esperando a que comience el proceso…";
  const selected = entities.find((item) => item.value === entityType)!;
  return <div className="min-h-screen bg-zinc-50 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
    <AppSidebar active="catalog" userEmail={userEmail} />
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-7 px-6 pb-24 pt-28 sm:px-10 lg:mx-0 lg:py-16">
      <header><h1 className="text-4xl font-semibold tracking-tight text-zinc-950">Importación catálogo</h1><p className="mt-3 max-w-3xl text-zinc-600">Importa entidades que ya están copiadas en Supabase. Cada ejecución queda en cola, conserva sus eventos y puede continuar aunque cierres esta pantalla.</p></header>
      <style>{`
        form:has(option[value="products"]:checked) > fieldset > div.border-t,
        form:has(option[value="products"]:checked) > fieldset > button,
        form:has(option[value="products"]:checked) > fieldset > p.rounded-lg.bg-zinc-50,
        form:has(option[value="products"]:checked) + form > fieldset > p.rounded-lg.bg-zinc-50 { display: none; }
        form:has(option[value="products"]:checked) { border-bottom-right-radius: 0; border-bottom-left-radius: 0; box-shadow: none; padding-bottom: 0; }
        form:has(option[value="products"]:checked) + form { margin-top: -1.75rem; border-top: 0; border-top-right-radius: 0; border-top-left-radius: 0; box-shadow: 0 1px 2px rgb(0 0 0 / 0.05); }
        form:has(option[value="products"]:checked) + form > fieldset > legend { display: none; }
        form:has(option[value="products"]:checked) + form > fieldset > div.grid > label:nth-child(3) { grid-column: 1 / -1; }
      `}</style>
      <form onSubmit={start} className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm"><fieldset disabled={active || starting} className="space-y-5 disabled:opacity-60"><legend className="text-lg font-semibold">Qué quieres importar</legend><label className="block text-sm font-medium text-zinc-700">Entidad<select value={entityType} onChange={(event) => setEntityType(event.target.value as Entity)} className="mt-1 block h-11 w-full rounded-lg border border-zinc-300 bg-white px-3"><option value="manufacturers">Marcas</option><option value="categories">Categorías</option><option value="features">Características</option><option value="products">Productos</option></select></label><p className="rounded-lg bg-zinc-50 p-3 text-sm text-zinc-600">{selected.description}</p>
        {entityType === "manufacturers" ? <div className="border-t border-zinc-100 pt-5"><h2 className="text-base font-semibold">Filtros de marcas</h2><div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium text-zinc-700">ID de marca <span className="font-normal text-zinc-500">(opcional)</span><input value={manufacturerId} onChange={(event) => setManufacturerId(event.target.value)} className="mt-1 block h-11 w-full rounded-lg border border-zinc-300 px-3" placeholder="Ej. AEG" /></label></div><label className="mt-4 flex cursor-pointer items-center gap-3 text-sm text-zinc-700"><input checked={onlyActive} onChange={(event) => setOnlyActive(event.target.checked)} type="checkbox" className="h-4 w-4" /><span className="font-medium">Sólo marcas activas</span></label></div> : entityType === "categories" ? <div className="border-t border-zinc-100 pt-5"><h2 className="text-base font-semibold">Filtros de categorías</h2><div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium text-zinc-700">ID de categoría <span className="font-normal text-zinc-500">(opcional)</span><input value={categoryId} onChange={(event) => setCategoryId(event.target.value)} className="mt-1 block h-11 w-full rounded-lg border border-zinc-300 px-3" placeholder="Ej. V110" /></label></div></div> : <div className="border-t border-zinc-100 pt-5"><h2 className="text-base font-semibold">Filtros de características</h2><div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium text-zinc-700">ID de característica <span className="font-normal text-zinc-500">(opcional)</span><input value={featureId} onChange={(event) => setFeatureId(event.target.value)} className="mt-1 block h-11 w-full rounded-lg border border-zinc-300 px-3" placeholder="Ej. 10356" /></label></div></div>}<button className="h-11 rounded-lg bg-emerald-700 px-5 font-medium text-white hover:bg-emerald-800 disabled:opacity-60">{starting ? "Preparando cola…" : "Iniciar el proceso"}</button>{error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">{error}</p>}</fieldset></form>
      {entityType === "products" && <form onSubmit={start} className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm"><fieldset disabled={active || starting} className="space-y-5 disabled:opacity-60"><legend className="text-lg font-semibold">Filtros de productos</legend><p className="rounded-lg bg-zinc-50 p-3 text-sm text-zinc-600">Antes de tocar Shopify se validan fabricante, categoría, características, valores, precio y stock. Los inactivos sólo se archivan si ya existen.</p><div className="grid gap-4 sm:grid-cols-3"><label className="text-sm font-medium text-zinc-700 sm:col-span-2">ID de producto <input value={productId} onChange={(event) => setProductId(event.target.value)} className="mt-1 block h-11 w-full rounded-lg border border-zinc-300 px-3" placeholder="Ej. 12345, 67890" /></label><label className="text-sm font-medium text-zinc-700">Desde fecha de modificación <input value={modifiedSince} onChange={(event) => setModifiedSince(event.target.value)} type="date" className="mt-1 block h-11 w-full rounded-lg border border-zinc-300 px-3" /></label></div><label className="flex items-center gap-3 text-sm text-zinc-700"><input checked={onlyActive} onChange={(event) => setOnlyActive(event.target.checked)} type="checkbox" className="h-4 w-4" /><span className="font-medium">Sólo productos activos</span></label><label className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"><input checked={forceImages} onChange={(event) => setForceImages(event.target.checked)} type="checkbox" className="mt-0.5 h-4 w-4" /><span><strong>Forzar todas las imágenes</strong><br />Borra las imágenes actuales del producto y vuelve a cargarlas desde origen.</span></label><button className="h-11 rounded-lg bg-emerald-700 px-5 font-medium text-white hover:bg-emerald-800 disabled:opacity-60">{starting ? "Preparando cola…" : "Iniciar el proceso"}</button></fieldset></form>}
      {loading ? <p className="text-zinc-500">Cargando ejecuciones…</p> : run && <section className="space-y-5 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-xl font-semibold">Ejecución actual</h2><p className="mt-1 text-sm text-zinc-600">{scopeLabel(run)} · <StatusBadge status={run.status} /></p></div><div className="flex gap-2">{(run.status === "queued" || run.status === "running") && <button disabled={changing} onClick={() => changeStatus("paused")} className="rounded-lg border border-amber-300 px-4 py-2 font-medium text-amber-900 hover:bg-amber-50">Pausar</button>}{run.status === "paused" && <button disabled={changing} onClick={() => changeStatus("queued")} className="rounded-lg bg-emerald-700 px-4 py-2 font-medium text-white hover:bg-emerald-800">Reanudar</button>}{active && <button disabled={changing} onClick={() => changeStatus("stopped")} className="rounded-lg border border-red-300 px-4 py-2 font-medium text-red-800 hover:bg-red-50">Detener</button>}</div></div>
        <div><div className="mb-2 flex justify-between text-sm font-medium"><span>{run.processed_count} de {run.total_count} {processedWord(run.entity_type)}</span><span>{progress}%</span></div><div className="h-3 overflow-hidden rounded-full bg-zinc-100"><div className="h-full bg-emerald-600 transition-all" style={{ width: `${progress}%` }} /></div><p className={`mt-3 text-sm ${run.status === "completed" ? "text-emerald-700" : "text-zinc-600"}`}>{run.status === "completed" ? `Proceso completado · duración: ${formatDuration(elapsed ?? 0)}.` : etaText}</p></div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6"><Counter label={run.entity_type === "products" ? "Creados" : "Creadas"} value={run.created_count} color="text-emerald-700" /><Counter label={run.entity_type === "products" ? "Actualizados" : "Actualizadas"} value={run.updated_count} color="text-amber-700" /><Counter label="Sin cambios" value={run.unchanged_count} color="text-zinc-700" /><Counter label={run.entity_type === "products" ? "Desactivados" : "Desactivadas"} value={run.unpublished_count} color="text-amber-700" /><Counter label="Errores" value={run.error_count} color="text-red-700" /><Counter label="Pendientes" value={Math.max(0, run.total_count - run.processed_count)} color="text-zinc-700" /></div>
        <div><button type="button" onClick={() => setLogsExpanded((value) => !value)} className="mb-3 flex w-full items-center justify-between text-left text-lg font-semibold text-zinc-950"><span>Registro en directo</span><span className="text-sm font-medium text-emerald-700">{logsExpanded ? "Ocultar" : `Ver registro (${events.length})`}</span></button>{logsExpanded && <div className="max-h-[28rem] overflow-auto rounded-xl border border-zinc-200"><ul className="divide-y divide-zinc-100">{events.length ? events.map((item) => <li key={item.id} className="p-3 text-sm"><div className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className={`font-semibold ${item.outcome === "created" ? "text-emerald-700" : item.outcome === "updated" ? "text-amber-700" : item.outcome === "error" ? "text-red-700" : "text-zinc-700"}`}>{eventLabel(item, run.entity_type)}</span>{item.source_entity_id && <span>{run.entity_type === "categories" ? "Categoría" : run.entity_type === "features" ? "Característica" : run.entity_type === "products" ? "Producto" : "Marca"} #{item.source_entity_id}</span>}{item.source_entity_name && <span className="text-zinc-600">{item.source_entity_name}</span>}<time className="ml-auto text-zinc-400">{formatMadridTime(item.created_at)}</time></div><p className="mt-1 text-zinc-600">{item.message}</p></li>) : <li className="p-4 text-sm text-zinc-500">La cola está preparada. Aquí aparecerá cada resultado.</li>}</ul></div>}</div>
      </section>}
      {!loading && <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm"><div className="flex items-baseline justify-between gap-4"><div><h2 className="text-xl font-semibold">Ejecuciones</h2><p className="mt-1 text-sm text-zinc-600">Cada proceso y todos sus eventos se conservan aquí.</p></div></div><div className="mt-4 grid gap-3 rounded-xl bg-zinc-50 p-4 sm:grid-cols-3"><label className="text-sm font-medium text-zinc-700">Entidad<select value={historyEntity} onChange={(event) => { setHistoryEntity(event.target.value as Entity | "all"); setHistoryPage(0); }} className="mt-1 block h-10 w-full rounded-lg border border-zinc-300 bg-white px-3"><option value="all">Todas</option><option value="manufacturers">Marcas</option><option value="categories">Categorías</option><option value="features">Características</option><option value="products">Productos</option></select></label><label className="text-sm font-medium text-zinc-700">Desde<input value={historyFrom} onChange={(event) => { setHistoryFrom(event.target.value); setHistoryPage(0); }} type="date" className="mt-1 block h-10 w-full rounded-lg border border-zinc-300 bg-white px-3" /></label><label className="text-sm font-medium text-zinc-700">Hasta<input value={historyUntil} onChange={(event) => { setHistoryUntil(event.target.value); setHistoryPage(0); }} type="date" className="mt-1 block h-10 w-full rounded-lg border border-zinc-300 bg-white px-3" /></label></div><div className="mt-4 overflow-auto rounded-xl border border-zinc-200"><ul className="divide-y divide-zinc-100">{history.length ? history.map((item) => <li key={item.id}><a href={`/ejecuciones-catalogo/${item.id}`} className={`flex w-full flex-wrap items-center gap-x-4 gap-y-1 p-4 text-left hover:bg-zinc-50 ${run?.id === item.id ? "bg-emerald-50" : ""}`}><span className="font-semibold text-zinc-900">{scopeLabel(item)}</span><span className="text-sm text-zinc-600">{formatMadridDateTime(item.created_at)}</span><span className="text-sm text-zinc-600">{durationLabel(item)}</span><span className="text-sm">{item.created_count} {item.entity_type === "products" ? "creados" : "creadas"} · {item.updated_count} {item.entity_type === "products" ? "actualizados" : "actualizadas"} · {item.unchanged_count} sin cambios · {item.unpublished_count} {item.entity_type === "products" ? "desactivados" : "desactivadas"} · {item.error_count} errores</span><span className="ml-auto text-sm font-medium text-zinc-700">{statusLabel(item.status)}</span></a></li>) : <li className="p-4 text-sm text-zinc-500">No hay ejecuciones para estos filtros.</li>}</ul></div><div className="mt-4 flex items-center justify-between text-sm"><button type="button" disabled={historyPage === 0} onClick={() => setHistoryPage((page) => Math.max(0, page - 1))} className="rounded-lg border border-zinc-300 px-3 py-2 font-medium text-zinc-700 disabled:cursor-not-allowed disabled:opacity-50">Anterior</button><span className="text-zinc-500">Página {historyPage + 1}</span><button type="button" disabled={!historyHasMore} onClick={() => setHistoryPage((page) => page + 1)} className="rounded-lg border border-zinc-300 px-3 py-2 font-medium text-zinc-700 disabled:cursor-not-allowed disabled:opacity-50">Siguiente</button></div></section>}
    </main>
  </div>;
}

function scopeLabel(run: Run) { const filters = run.filters; const productFilter = filters.productIds?.length ? filters.productIds.join(", ") : filters.productId; const selected = [filters.manufacturerId ? `ID ${filters.manufacturerId}` : filters.categoryId ? `ID ${filters.categoryId}` : filters.featureId ? `ID ${filters.featureId}` : productFilter ? `ID ${productFilter}` : ""].filter(Boolean).join(" · "); const entity = run.entity_type === "categories" ? "Categorías" : run.entity_type === "features" ? "Características" : run.entity_type === "products" ? "Productos" : "Marcas"; return `${entity}${selected ? `: ${selected}` : run.entity_type === "manufacturers" && filters.onlyActive === false ? " (todas)" : run.entity_type === "manufacturers" ? " activas" : ""}`; }
function processedWord(entity: Entity) { return entity === "products" ? "procesados" : "procesadas"; }
function eventLabel(event: ImportEvent, entity: Entity) { if (event.outcome === "updated" && entity === "categories") return event.message.includes("retirada") ? "Desactivada" : "Sin cambios"; if (event.outcome === "updated" && (entity === "manufacturers" || entity === "features") && event.message.includes("sin cambios")) return "Sin cambios"; if (entity === "products" && event.outcome === "updated" && event.message.includes("archivado")) return "Desactivado"; if (entity === "products") return ({ created: "Creado", updated: "Actualizado", error: "Error", status: "Estado" } as const)[event.outcome]; return ({ created: "Creada", updated: "Actualizada", error: "Error", status: "Estado" } as const)[event.outcome]; }
function statusLabel(status: Run["status"]) { return ({ queued: "En cola", running: "En marcha", paused: "Pausada", stopped: "Detenida", completed: "Completada", failed: "Con error" } as const)[status]; }
function StatusBadge({ status }: { status: Run["status"] }) { return <span className={status === "completed" ? "font-medium text-emerald-700" : status === "failed" ? "font-medium text-red-700" : "font-medium text-zinc-700"}>{statusLabel(status)}</span>; }
function Counter({ label, value, color }: { label: string; value: number; color: string }) { return <div className="rounded-xl border border-zinc-200 bg-white p-4"><p className="text-sm text-zinc-500">{label}</p><p className={`mt-1 text-2xl font-semibold ${color}`}>{value}</p></div>; }
function formatMadridDateTime(value: string) { return new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "short" }).format(new Date(value)); }
function formatMadridTime(value: string) { return new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", timeStyle: "medium" }).format(new Date(value)); }
function remainingEstimate(run: Run, events: ImportEvent[]) { if (!run.processed_count || run.processed_count >= run.total_count) return null; const processed = events.filter((event) => event.outcome !== "status"); if (processed.length >= 2) { const recent = processed.slice(-12); const intervals = recent.slice(1).map((item, index) => new Date(item.created_at).getTime() - new Date(recent[index].created_at).getTime()).filter((value) => value >= 0 && value < 60_000); if (intervals.length) return Math.round((intervals.reduce((sum, value) => sum + value, 0) / intervals.length) * (run.total_count - run.processed_count)); } if (!run.started_at) return null; const elapsed = Date.now() - new Date(run.started_at).getTime(); return Math.max(0, Math.round((elapsed / run.processed_count) * (run.total_count - run.processed_count))); }
function formatDuration(milliseconds: number) { const seconds = Math.max(0, Math.round(milliseconds / 1_000)); return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min${seconds % 60 ? ` ${seconds % 60} s` : ""}`; }
function durationLabel(run: Run) { if (!run.started_at) return "Sin iniciar"; const end = run.finished_at ? new Date(run.finished_at).getTime() : Date.now(); return `Duración: ${formatDuration(end - new Date(run.started_at).getTime())}`; }
