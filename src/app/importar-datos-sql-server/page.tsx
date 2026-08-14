"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AppSidebar } from "@/components/app-sidebar";

const sourceTables = [
  ["ELECTRONICA_VICENTE_B2C_Productos", "Productos"],
  ["ELECTRONICA_VICENTE_B2C_Caracteristicas", "Características"],
  ["ELECTRONICA_VICENTE_B2C_CaracteristicasValores", "Valores de características"],
  ["ELECTRONICA_VICENTE_B2C_Categorias_Web", "Categorías web"],
  ["ELECTRONICA_VICENTE_B2C_Fabricantes", "Fabricantes"],
  ["ELECTRONICA_VICENTE_B2C_Precios", "Precios"],
  ["ELECTRONICA_VICENTE_B2C_Producto_Relacionados", "Productos relacionados"],
  ["ELECTRONICA_VICENTE_B2C_Stocks", "Stocks"],
] as const;

type ImportRun = { id: string; table_names: string[]; status: "running" | "completed" | "failed"; active: boolean; record_counts: Record<string, number>; progress: { phase?: string; currentTable?: string; tableIndex?: number; totalTables?: number; currentTableTotal?: number; normalized?: { record_counts?: Record<string, number> } }; error_message: string | null; started_at: string; completed_at: string | null };

export default function SqlServerImportPage() {
  const [selected, setSelected] = useState<string[]>(sourceTables.map(([name]) => name));
  const [runs, setRuns] = useState<ImportRun[]>([]);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRuns = useCallback(async () => {
    try {
      const response = await fetch("/api/sql-server-import", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "No se pudo consultar el estado de las copias.");
      setRuns(body.runs ?? []);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo consultar el estado de las copias."); }
  }, []);

  useEffect(() => { void loadRuns(); }, [loadRuns]);
  useEffect(() => { createClient().auth.getUser().then(({ data }) => setUserEmail(data.user?.email ?? null)); }, []);

  const running = runs.find((run) => run.status === "running");
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => { void loadRuns(); }, 10_000);
    return () => window.clearInterval(timer);
  }, [running, loadRuns]);

  function toggle(table: string) { setSelected((current) => current.includes(table) ? current.filter((item) => item !== table) : [...current, table]); }
  async function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setStarting(true); setError(null);
    try {
      const response = await fetch("/api/sql-server-import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tables: selected }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "No se pudo iniciar la copia.");
      await loadRuns();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo iniciar la copia."); } finally { setStarting(false); }
  }

  return <div className="min-h-screen bg-zinc-50 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
    <AppSidebar active="supabase" userEmail={userEmail} />
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-7 px-6 pb-24 pt-28 sm:px-10 lg:mx-0 lg:py-16">
      <header><h1 className="text-4xl font-semibold tracking-tight text-zinc-950">Importar datos de SQL Server a Supabase</h1><p className="mt-3 max-w-3xl text-zinc-600">Primero se recibe una copia desde Pladisel y después se actualizan las tablas de catálogo de Supabase. Una nueva copia sólo sustituye a la anterior cuando todo ha finalizado correctamente.</p></header>
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">{error}</p>}
      <form onSubmit={start} className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <fieldset disabled={Boolean(running) || starting} className="space-y-4 disabled:opacity-60"><legend className="text-lg font-semibold">Tablas a copiar</legend><p className="text-sm text-zinc-600">Sólo se ejecuta en este ordenador, con la VPN conectada. Primero se descarga cada tabla y, al acabar, se reemplazan los datos correspondientes del catálogo en Supabase.</p><div className="grid gap-3 sm:grid-cols-2">{sourceTables.map(([name, label]) => <label key={name} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-4 ${selected.includes(name) ? "border-emerald-600 bg-emerald-50" : "border-zinc-200"}`}><input type="checkbox" checked={selected.includes(name)} onChange={() => toggle(name)} /><span className="font-medium">{label}</span></label>)}</div><button disabled={!selected.length} className="h-11 rounded-lg bg-emerald-700 px-5 font-medium text-white hover:bg-emerald-800 disabled:opacity-60">{starting ? "Iniciando copia…" : running ? "Copia en curso…" : "Copiar datos a Supabase"}</button></fieldset>
      </form>
      <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm"><div className="flex items-baseline justify-between gap-4"><div><h2 className="text-xl font-semibold">Copias realizadas</h2><p className="mt-1 text-sm text-zinc-600">Se conserva el histórico de cada copia terminada.</p></div><span className="text-sm text-zinc-500">{runs.filter((item) => item.status !== "running").length} guardadas</span></div><div className="mt-4 space-y-3">{runs.filter((item) => item.status !== "running").length ? runs.filter((item) => item.status !== "running").map((run) => <article key={run.id} className="rounded-xl border border-zinc-200 p-4"><div className="flex flex-wrap items-center gap-x-3 gap-y-1"><span className="font-semibold text-zinc-900">{run.status === "completed" ? "Completada" : "Con error"}</span><time className="text-sm text-zinc-500">{formatMadridDateTime(run.started_at)}</time></div><RunDetails run={run} />{run.error_message && <p className="mt-2 text-sm text-red-700">{run.error_message}</p>}</article>) : <p className="text-sm text-zinc-500">Todavía no se ha copiado ninguna tabla terminada.</p>}</div></section>
    </main>
  </div>;
}

function RunDetails({ run }: { run: ImportRun }) {
  const total = Object.values(run.record_counts ?? {}).reduce((sum, value) => sum + Number(value), 0);
  const currentTable = run.progress?.currentTable;
  const copiedCurrent = currentTable ? Number(run.record_counts?.[currentTable] ?? 0) : 0;
  const totalCurrent = Number(run.progress?.currentTableTotal ?? 0);
  const currentProgress = totalCurrent ? Math.min(100, Math.round((copiedCurrent / totalCurrent) * 100)) : 0;
  const elapsed = Date.now() - new Date(run.started_at).getTime();
  const normalized = run.progress?.normalized?.record_counts ?? {};
  return <div className="mt-3 text-sm text-zinc-600">{run.status === "running" && <div className="mb-3 rounded-lg bg-white/70 p-3"><p className="font-medium text-zinc-900">{run.progress?.phase === "counting" ? `Calculando filas de ${shortName(currentTable ?? "")}…` : run.progress?.phase === "reading" ? `Leyendo ${shortName(currentTable ?? "")} desde SQL Server…` : run.progress?.phase === "normalizing" ? "Actualizando las tablas de catálogo en Supabase…" : `Copiando ${shortName(currentTable ?? "")} · tabla ${run.progress?.tableIndex ?? 1} de ${run.progress?.totalTables ?? run.table_names.length}`}</p><p className="mt-1">{run.progress?.phase === "normalizing" ? "La copia está completa; se están sustituyendo los datos utilizables del catálogo." : run.progress?.phase === "reading" ? "Preparando el envío de la tabla completa…" : totalCurrent ? `${copiedCurrent.toLocaleString("es-ES")} de ${totalCurrent.toLocaleString("es-ES")} filas · ${currentProgress}%` : "Preparando el siguiente lote…"} · Tiempo transcurrido: {formatDuration(elapsed)}</p>{totalCurrent > 0 && run.progress?.phase !== "reading" && run.progress?.phase !== "normalizing" && <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-200"><div className="h-full bg-emerald-600 transition-all" style={{ width: `${currentProgress}%` }} /></div>}</div>}<div className="flex flex-wrap gap-x-5 gap-y-1"><span>{run.table_names.length} tablas</span><span>{total.toLocaleString("es-ES")} filas copiadas</span>{run.completed_at && <span>Duración: {formatDuration(new Date(run.completed_at).getTime() - new Date(run.started_at).getTime())}</span>}{Object.entries(run.record_counts ?? {}).map(([table, count]) => <span key={table}>{shortName(table)}: {Number(count).toLocaleString("es-ES")}</span>)}</div>{run.status === "completed" && Object.keys(normalized).length > 0 && <p className="mt-3 rounded-lg bg-emerald-50 p-3 font-medium text-emerald-900">Catálogo actualizado en Supabase: {Object.entries(normalized).map(([entity, count]) => `${catalogName(entity)} (${Number(count).toLocaleString("es-ES")})`).join(" · ")}.</p>}</div>;
}
function shortName(table: string) { return sourceTables.find(([name]) => name === table)?.[1] ?? table; }
function catalogName(entity: string) { return ({ manufacturers: "Fabricantes", products: "Productos", categories: "Categorías web", features: "Características", feature_values: "Valores de características", prices: "Precios", related_products: "Productos relacionados", stock: "Stocks" } as Record<string, string>)[entity] ?? entity; }
function formatMadridDateTime(value: string) { return new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "short" }).format(new Date(value)); }
function formatDuration(milliseconds: number) { const safe = Math.max(0, milliseconds); if (safe < 1_000) return `${Math.round(safe)} ms`; const seconds = Math.round(safe / 1_000); if (seconds < 60) return `${seconds} s`; const hours = Math.floor(seconds / 3600); const minutes = Math.floor((seconds % 3600) / 60); const rest = seconds % 60; if (hours) return `${hours} h${minutes ? ` ${minutes} min` : ""}${rest ? ` ${rest} s` : ""}`; return `${minutes} min${rest ? ` ${rest} s` : ""}`; }
