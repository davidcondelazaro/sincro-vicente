"use client";

import { Fragment, useCallback, useEffect, useState } from "react";

// Vueltas de sincronización con MHD (2026-10-29): la de ahora paso a paso, el botón para lanzar una sin esperar y el
// historial con el tiempo y las cifras de cada paso. Se actualiza cada 5 s.
type Step = { name: string; started_at: string; finished_at?: string; status?: string; counts?: Record<string, unknown>; error?: string };
type Cycle = { id: string; trigger: string; status: string; started_at: string; finished_at: string | null; steps: Step[]; error: string | null };
type Data = { cycles: Cycle[]; reading: { done: number; total: number } | null };

const STEPS = [["conexiones", "Conexiones"], ["lectura", "Lectura de MHD"], ["precio-stock", "Precio y stock"], ["agotados", "Agotados en MHD"], ["altas", "Altas"]] as const;
const RUNNING = ["iniciando", "leyendo", "procesando"];
const STATUS: Record<string, [string, string]> = {
  terminada: ["Terminada", "bg-emerald-50 text-emerald-700 ring-emerald-600/20"], iniciando: ["Empezando", "bg-sky-50 text-sky-700 ring-sky-600/20"], leyendo: ["Leyendo MHD", "bg-sky-50 text-sky-700 ring-sky-600/20"],
  procesando: ["Procesando", "bg-sky-50 text-sky-700 ring-sky-600/20"], fallida: ["Fallida", "bg-red-50 text-red-700 ring-red-600/20"], atascada: ["Atascada", "bg-red-50 text-red-700 ring-red-600/20"], parada: ["Parada", "bg-amber-50 text-amber-800 ring-amber-600/20"],
};
const integer = (value: unknown) => new Intl.NumberFormat("es-ES", { useGrouping: "always" }).format(Number(value ?? 0));
const when = (iso: string) => new Date(iso).toLocaleString("es-ES", { timeZone: "Europe/Madrid", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const secs = (from: string, to: string | null | undefined, now: number) => Math.max(0, Math.round(((to ? new Date(to).getTime() : now) - new Date(from).getTime()) / 1000));
const duration = (value: number) => (value < 60 ? `${value} s` : `${Math.floor(value / 60)} min ${value % 60} s`);

function stepText(step: Step | undefined, reading: Data["reading"]) {
  if (!step) return "—";
  const counts = step.counts ?? {};
  if (step.status === "error") return step.error ?? "Error";
  if (step.name === "conexiones") return ((counts.services ?? []) as { name: string; ok: boolean; ms: number }[]).map((item) => `${item.name} ${item.ok ? `${(item.ms / 1000).toLocaleString("es-ES", { maximumFractionDigits: 1 })} s` : "✕"}`).join(" · ");
  if (step.name === "lectura") return !step.finished_at && reading ? `${integer(reading.done)} de ${integer(reading.total)}` : `${integer(counts.products)} productos`;
  if (step.name === "precio-stock") return step.finished_at ? `${integer(counts.pricesSent)} precios · ${integer(counts.stockSent)} stocks${(counts.errors as unknown[] | undefined)?.length ? ` · ${(counts.errors as unknown[]).length} errores` : ""}` : "Enviando…";
  if (step.name === "agotados") return step.finished_at ? `${integer(counts.applied)} se agotan · ${integer(counts.returned)} vuelven${counts.braked ? " · FRENO" : ""}${counts.skippedByRead ? ` · ${integer(counts.skippedByRead)} saltados` : ""}` : "Confirmando con MHD…";
  if (step.name === "altas") return step.finished_at ? (counts.braked ? `FRENO: ${integer(counts.found)} de golpe` : `${integer(counts.queued)} a la cola${counts.fotosNuevas ? ` (${integer(counts.fotosNuevas)} con fotos nuevas)` : ""}`) : "Buscando…";
  return "";
}

export function SyncCycles() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (document.visibilityState === "hidden") return;
    try {
      const response = await fetch("/api/sincronizaciones", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "No se pudieron leer las vueltas.");
      setData(body); setError(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Error inesperado."); }
  }, []);
  useEffect(() => {
    const first = window.setTimeout(() => { setNow(Date.now()); void load(); }, 0);
    const poll = window.setInterval(() => void load(), 5_000);
    const tick = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => { window.clearTimeout(first); window.clearInterval(poll); window.clearInterval(tick); };
  }, [load]);

  async function startNow() {
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/sincronizaciones", { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "No se pudo lanzar la vuelta.");
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Error inesperado."); } finally { setBusy(false); }
  }

  const cycles = data?.cycles ?? [];
  const live = cycles[0] && RUNNING.includes(cycles[0].status);
  return <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h2 className="text-xl font-semibold">Vueltas de sincronización</h2><p className="mt-1 max-w-2xl text-sm text-zinc-600">Cada 30 minutos (en punto y a la media): comprueba las conexiones, lee el listado de MHD y manda a Shopify los precios y el stock que han cambiado. Si algo falla, la vuelta se para y llega un aviso por correo.</p></div>
      <button type="button" onClick={startNow} disabled={busy || Boolean(live)} className="h-10 shrink-0 rounded-lg bg-emerald-700 px-4 text-sm font-medium text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">{live ? "Hay una vuelta en marcha" : busy ? "Lanzando…" : "Leer ahora y actualizar"}</button>
    </div>
    {error && <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    <div className="mt-4 overflow-x-auto rounded-xl border border-zinc-200">
      <table className="w-full min-w-[64rem] text-sm">
        <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500"><tr><th className="px-3 py-2 font-medium">Empezó</th><th className="px-3 py-2 font-medium">Estado</th><th className="px-3 py-2 font-medium">Total</th>{STEPS.map(([, label]) => <th key={label} className="px-3 py-2 font-medium">{label}</th>)}</tr></thead>
        <tbody className="divide-y divide-zinc-100">{!data ? <tr><td colSpan={8} className="px-3 py-4 text-zinc-500">Cargando…</td></tr> : !cycles.length ? <tr><td colSpan={8} className="px-3 py-4 text-zinc-500">Todavía no hay vueltas.</td></tr> : cycles.map((cycle) => {
          const running = RUNNING.includes(cycle.status); const [label, tone] = STATUS[cycle.status] ?? [cycle.status, "bg-zinc-100 text-zinc-700 ring-zinc-600/20"];
          return <Fragment key={cycle.id}>
            <tr className="cursor-pointer align-top hover:bg-zinc-50" onClick={() => setOpen(open === cycle.id ? null : cycle.id)}>
              <td className="whitespace-nowrap px-3 py-2.5 text-zinc-700">{when(cycle.started_at)}<span className="block text-xs text-zinc-400">{cycle.trigger === "manual" ? "a mano" : "programada"}</span></td>
              <td className="px-3 py-2.5"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tone}`}>{label}</span></td>
              <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-zinc-700">{duration(secs(cycle.started_at, cycle.finished_at, now))}{running ? "…" : ""}</td>
              {STEPS.map(([name]) => { const step = cycle.steps.find((item) => item.name === name); const active = running && step && !step.finished_at;
                return <td key={name} className={`px-3 py-2.5 ${step?.status === "error" ? "text-red-700" : active ? "text-sky-700" : "text-zinc-700"}`}>{step ? <><span className="font-medium tabular-nums">{duration(secs(step.started_at, step.finished_at, now))}{active ? "…" : ""}</span><span className="block text-xs text-zinc-500">{stepText(step, active ? data.reading : null)}</span></> : <span className="text-zinc-300">—</span>}</td>; })}
            </tr>
            {open === cycle.id && <tr><td colSpan={8} className="bg-zinc-50 px-3 py-3 text-xs text-zinc-600">
              {cycle.error && <p className="mb-2 text-red-700">{cycle.error}</p>}
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap">{JSON.stringify(cycle.steps.map(({ name, status, started_at, finished_at, counts, error: stepError }) => ({ name, status, started_at, finished_at, error: stepError, counts: counts && { ...counts, sample: undefined } })), null, 2)}</pre>
            </td></tr>}
          </Fragment>;
        })}</tbody>
      </table>
    </div>
    <p className="mt-2 text-xs text-zinc-500">Pulsa una vuelta para ver todo su registro.</p>
  </section>;
}
