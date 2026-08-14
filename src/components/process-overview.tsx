"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { createClient } from "@/lib/supabase/client";

type Status = "queued" | "running" | "paused" | "stopped" | "completed" | "failed";
type Process = { id: string; entity: string; family: string; href: string; status: Status; total: number; processed: number; errors: number; syncType: string; startedAt: string | null; finishedAt: string | null; createdAt: string };
type Summary = { type: string; entity: string; family: string; href: string; latest: Process | null };
type Data = { active: Process[]; summaries: Summary[] };

export function ProcessOverview() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/dashboard/processes", { cache: "no-store" });
      const body = await response.json() as Data & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "No se pudo actualizar el resumen.");
      setData(body);
      setError(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo actualizar el resumen."); }
  }, []);

  useEffect(() => { void load(); createClient().auth.getUser().then(({ data: auth }) => setUserEmail(auth.user?.email ?? null)); }, [load]);
  useEffect(() => { const timer = window.setInterval(() => { setNow(Date.now()); void load(); }, 3_000); return () => window.clearInterval(timer); }, [load]);
  const active = useMemo(() => data?.active ?? [], [data]);

  return <div className="min-h-screen bg-zinc-50 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
    <AppSidebar active="home" userEmail={userEmail} />
    <main className="min-w-0 px-6 pb-24 pt-28 sm:px-10 lg:px-12 lg:py-16"><div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <header><h1 className="text-4xl font-semibold tracking-tight text-zinc-950">Resumen de sincronizaciones</h1><p className="mt-2 text-zinc-600">Procesos en curso y última ejecución correcta de cada entidad.</p></header>
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">{error}</p>}
      <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-baseline justify-between gap-3"><h2 className="text-xl font-semibold">En ejecución</h2><span className="text-sm text-zinc-500">{active.length} {active.length === 1 ? "proceso activo" : "procesos activos"}</span></div>{!data ? <p className="mt-5 text-sm text-zinc-500">Cargando procesos…</p> : active.length ? <div className="mt-5 grid gap-3 xl:grid-cols-2">{active.map((process) => <ActiveProcess key={process.id} process={process} now={now} />)}</div> : <p className="mt-5 rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-6 text-center text-sm text-zinc-600">No hay procesos en curso.</p>}</section>
      <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm"><h2 className="text-xl font-semibold">Última ejecución completada</h2><div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{(data?.summaries ?? []).map((summary) => <LatestProcess key={summary.type} summary={summary} />)}</div></section>
    </div></main>
  </div>;
}

function ActiveProcess({ process, now }: { process: Process; now: number }) {
  const progress = process.total ? Math.min(100, Math.round(process.processed / process.total * 100)) : 0;
  const started = process.startedAt ? new Date(process.startedAt).getTime() : null;
  const elapsed = started ? Math.max(0, now - started) : null;
  const average = elapsed !== null && process.processed > 0 ? elapsed / process.processed : null;
  const remaining = average !== null ? average * Math.max(0, process.total - process.processed) : null;
  return <article className="min-w-0 rounded-xl border border-zinc-200 p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold tracking-[0.1em] text-emerald-700 uppercase">{process.family}</p><h3 className="mt-1 font-semibold text-zinc-950">{process.entity} <span className="font-normal text-zinc-500">· {statusLabel(process.status)}</span></h3></div><a href={process.href} className="shrink-0 text-sm font-medium text-emerald-700 underline">Abrir</a></div><div className="mt-4"><div className="mb-2 flex justify-between gap-3 text-sm text-zinc-700"><span>{process.total ? `${formatNumber(process.processed)} de ${formatNumber(process.total)} procesados` : `${formatNumber(process.processed)} procesados`}</span><span>{process.total ? `${progress}%` : ""}</span></div><div className="h-2.5 overflow-hidden rounded-full bg-zinc-100"><div className="h-full bg-emerald-600 transition-all duration-500" style={{ width: `${progress}%` }} /></div><p className="mt-2 text-sm text-zinc-600">{elapsed === null ? "Preparando el proceso…" : average === null ? `Tiempo: ${formatDuration(elapsed)} · calculando estimación…` : `Tiempo: ${formatDuration(elapsed)} · restante: ${formatDuration(remaining ?? 0)} · promedio: ${formatDuration(average)} por registro`}</p></div></article>;
}

function LatestProcess({ summary }: { summary: Summary }) {
  const latest = summary.latest;
  return <a href={summary.href} className="rounded-xl border border-zinc-200 p-4 transition-colors hover:border-emerald-300 hover:bg-emerald-50/40"><p className="text-xs font-semibold tracking-[0.1em] text-zinc-500 uppercase">{summary.family}</p><h3 className="mt-1 font-semibold text-zinc-950">{summary.entity}</h3>{latest ? <><p className="mt-3 text-sm text-zinc-600">Completada {formatDate(latest.finishedAt ?? latest.createdAt)}</p><p className="mt-2 text-sm text-zinc-600">{latest.syncType} · {formatNumber(latest.processed)} procesados · <span className={latest.errors ? "font-medium text-red-700" : ""}>{formatNumber(latest.errors)} errores</span></p></> : <p className="mt-3 text-sm text-zinc-500">Aún no hay una ejecución completada.</p>}</a>;
}

function statusLabel(status: Status) { return ({ queued: "Preparando", running: "En marcha", paused: "Pausada", stopped: "Detenida", completed: "Completada", failed: "Con error" } as const)[status]; }
function formatNumber(value: number) { return new Intl.NumberFormat("es-ES").format(value); }
function formatDate(value: string) { return new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "short" }).format(new Date(value)); }
function formatDuration(milliseconds: number) { const safe = Math.max(0, milliseconds); if (safe < 1_000) return `${Math.round(safe)} ms`; const seconds = Math.round(safe / 1000); if (seconds < 60) return `${seconds} s`; const hours = Math.floor(seconds / 3600); const minutes = Math.floor(seconds % 3600 / 60); const rest = seconds % 60; return hours ? `${hours} h${minutes ? ` ${minutes} min` : ""}${rest ? ` ${rest} s` : ""}` : `${minutes} min${rest ? ` ${rest} s` : ""}`; }
