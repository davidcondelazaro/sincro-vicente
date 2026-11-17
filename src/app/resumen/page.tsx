"use client";

import { useCallback, useEffect, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { createClient } from "@/lib/supabase/client";

// Resumen (David, 2026-11-17: «los principales indicadores de manera visual y luego algo de detalle con ver más»). Arriba,
// los indicadores del último resumen diario con su color y su evolución (los resúmenes guardados en mhd_daily_reports);
// debajo, el detalle de cada sección, con el mismo ancla que usan los enlaces del correo. «Calcular ahora» lo rehace con
// las últimas 24 horas sin enviarlo ni guardarlo.
type Tone = "ok" | "warn" | "bad" | "neutral";
type Kpi = { id: string; label: string; value: number; text?: string; sub?: string; tone: Tone; prev?: number | null; section?: string };
type Cell = string | { text: string; href: string };
type Section = { id?: string; title: string; warn?: boolean; lines: string[]; table?: { head: string[]; rows: Cell[][] }; link?: { text: string; href: string } };
type Report = { period_start: string; period_end: string; subject: string; kpis: Kpi[]; sections: Section[] };
type History = { period_end: string; kpis: Kpi[] }[];

const TONE: Record<Tone, { border: string; value: string; icon: string; label: string }> = {
  ok: { border: "border-l-emerald-600", value: "text-zinc-950", icon: "✓", label: "Bien" },
  warn: { border: "border-l-amber-500", value: "text-zinc-950", icon: "⚠", label: "Para mirar" },
  bad: { border: "border-l-red-600", value: "text-zinc-950", icon: "✖", label: "Problema" },
  neutral: { border: "border-l-zinc-300", value: "text-zinc-950", icon: "", label: "" },
};
const integer = (value: number) => new Intl.NumberFormat("es-ES", { useGrouping: "always", maximumFractionDigits: 2 }).format(value);
const when = (iso: string) => new Date(iso).toLocaleString("es-ES", { timeZone: "Europe/Madrid", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
const day = (iso: string) => new Date(iso).toLocaleDateString("es-ES", { timeZone: "Europe/Madrid", day: "numeric", month: "short" });

export default function ReportPage() {
  const [email, setEmail] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [history, setHistory] = useState<History>([]);
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/resumen", { cache: "no-store" });
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "No se pudo leer el resumen.");
      setReport(body.latest); setHistory(body.history ?? []); setLive(false);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Error inesperado."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    createClient().auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    return () => window.clearTimeout(first);
  }, [load]);
  // Al llegar desde un enlace del correo (#seccion), bajar a esa sección cuando ya está pintada.
  useEffect(() => {
    if (!report || !window.location.hash) return;
    document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [report]);

  async function compute() {
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/resumen", { method: "POST" });
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "No se pudo calcular.");
      setReport(body.live); setLive(true);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Error inesperado."); }
    finally { setBusy(false); }
  }

  const problems = report?.kpis.filter((item) => item.tone === "bad" || item.tone === "warn") ?? [];
  return <div className="min-h-screen bg-zinc-50 lg:grid lg:grid-cols-[17.5rem_minmax(0,1fr)]"><AppSidebar active="dailyReport" userEmail={email} />
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 pb-24 pt-28 sm:px-10 lg:mx-0 lg:py-16">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div><h1 className="text-4xl font-semibold tracking-tight text-zinc-950">Resumen</h1>
          <p className="mt-3 max-w-3xl text-zinc-600">{report ? <>{live ? "Calculado ahora" : "Resumen diario"}: de {when(report.period_start)} a {when(report.period_end)}.{problems.length ? ` ${problems.length} indicadores para mirar.` : " Todo en orden."}</> : "Los indicadores de las sincronizaciones con MHD y su detalle."}</p></div>
        <div className="flex gap-2">
          {live && <button type="button" onClick={() => void load()} className="h-10 rounded-lg border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-700">Volver al diario</button>}
          <button type="button" onClick={() => void compute()} disabled={busy} className="h-10 rounded-lg bg-emerald-700 px-4 text-sm font-medium text-white disabled:opacity-50">{busy ? "Calculando… (hasta un minuto)" : "Calcular ahora"}</button>
        </div>
      </header>
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">{error}</p>}
      {loading ? <p className="text-sm text-zinc-500">Cargando…</p> : !report ? <p className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-600">Todavía no hay ningún resumen guardado: el primero se guarda con el correo de las 9:00. Mientras, puedes calcularlo ahora.</p> : <>
        <section aria-label="Indicadores" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {report.kpis.map((item) => <Tile key={item.id} item={item} series={history.map((entry) => ({ at: entry.period_end, value: entry.kpis.find((kpi) => kpi.id === item.id)?.value ?? null }))} />)}
        </section>
        {report.sections.map((section, index) => <Detail key={section.id ?? index} section={section} />)}
      </>}
    </main>
  </div>;
}

function Tile({ item, series }: { item: Kpi; series: { at: string; value: number | null }[] }) {
  const tone = TONE[item.tone];
  const change = item.prev === null || item.prev === undefined || item.text?.includes(" de ") ? null : item.value - item.prev;
  return <a href={item.section ? `#${item.section}` : undefined} className={`block rounded-xl border border-l-4 border-zinc-200 ${tone.border} bg-white p-4 hover:bg-zinc-50`}>
    <div className="flex items-start justify-between gap-2">
      <p className="text-sm text-zinc-600">{item.label}</p>
      {tone.icon && <span className="text-xs font-medium text-zinc-600" title={tone.label}>{tone.icon} {tone.label}</span>}
    </div>
    <div className="mt-1 flex items-end justify-between gap-3">
      <div>
        <p className={`text-3xl font-semibold tracking-tight ${tone.value}`}>{item.text ?? integer(item.value)}</p>
        {change !== null && <p className="text-xs text-zinc-500">{change === 0 ? "Igual que el anterior" : `${change > 0 ? "▲" : "▼"} ${integer(Math.abs(change))} frente al anterior`}</p>}
      </div>
      <Sparkline label={item.label} series={series} />
    </div>
    {item.sub && <p className="mt-2 text-sm text-zinc-600">{item.sub}</p>}
  </a>;
}

// Evolución de un indicador en los resúmenes guardados: una línea de 2 px en tinta neutra (el color de estado va en el
// borde de la ficha, con icono), puntos al pasar el ratón con la fecha y la cifra. Con menos de dos días, nada.
function Sparkline({ label, series }: { label: string; series: { at: string; value: number | null }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const points = series.filter((item): item is { at: string; value: number } => item.value !== null);
  if (points.length < 2) return <span className="text-xs text-zinc-400">sin historial aún</span>;
  const width = 120; const height = 36; const pad = 4;
  const max = Math.max(...points.map((item) => item.value)); const min = Math.min(...points.map((item) => item.value));
  const x = (index: number) => pad + (index * (width - 2 * pad)) / (points.length - 1);
  const y = (value: number) => (max === min ? height / 2 : height - pad - ((value - min) * (height - 2 * pad)) / (max - min));
  const path = points.map((item, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(item.value).toFixed(1)}`).join(" ");
  const shown = hover ?? points.length - 1;
  return <div className="relative" onMouseLeave={() => setHover(null)}>
    <svg width={width} height={height} role="img" aria-label={`${label}: evolución en ${points.length} resúmenes, de ${integer(points[0].value)} a ${integer(points.at(-1)!.value)}`}>
      <path d={path} fill="none" stroke="#52525b" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(shown)} cy={y(points[shown].value)} r={4} fill="#18181b" stroke="#fff" strokeWidth={2} />
      {points.map((item, index) => <rect key={item.at} x={x(index) - (width - 2 * pad) / (points.length - 1) / 2} y={0} width={(width - 2 * pad) / (points.length - 1)} height={height} fill="transparent" onMouseEnter={() => setHover(index)} />)}
    </svg>
    {hover !== null && <span className="pointer-events-none absolute -top-7 right-0 whitespace-nowrap rounded bg-zinc-900 px-2 py-0.5 text-xs text-white">{day(points[hover].at)}: {integer(points[hover].value)}</span>}
  </div>;
}

function Detail({ section }: { section: Section }) {
  const cell = (value: Cell) => (typeof value === "string" ? value : <a href={value.href} target="_blank" rel="noreferrer" className="text-emerald-800 underline-offset-2 hover:underline">{value.text}</a>);
  return <section id={section.id} className="scroll-mt-24 rounded-xl border border-zinc-200 bg-white p-5">
    <h2 className="text-lg font-semibold text-zinc-950">{section.warn && <span className="mr-1 text-amber-600" aria-label="Para mirar">⚠</span>}{section.title}</h2>
    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-700">{section.lines.map((line, index) => <li key={index}>{line}</li>)}</ul>
    {section.table && <div className="mt-3 overflow-x-auto"><table className="min-w-full text-left text-sm">
      <thead><tr>{section.table.head.map((head) => <th key={head} className="border-b border-zinc-200 bg-zinc-50 px-3 py-2 font-medium text-zinc-700">{head}</th>)}</tr></thead>
      <tbody>{section.table.rows.map((row, index) => <tr key={index} className="border-b border-zinc-100 align-top">{row.map((value, column) => <td key={column} className="px-3 py-1.5 text-zinc-700">{cell(value)}</td>)}</tr>)}</tbody>
    </table></div>}
    {section.link && <p className="mt-3 text-sm"><a href={section.link.href} className="font-medium text-emerald-800 hover:underline">{section.link.text} →</a></p>}
  </section>;
}
