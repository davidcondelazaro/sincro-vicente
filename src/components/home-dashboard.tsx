"use client";

import { useCallback, useEffect, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { ProcessOverview } from "@/components/process-overview";
import { createClient } from "@/lib/supabase/client";

// Inicio (2026-10-29): la sincronización con MHD en tiempo real. Pide /api/inicio cada 5 s (solo con la pestaña a la
// vista) y el reloj avanza cada segundo para los tiempos en marcha. Los procesos antiguos de Pladisel van plegados al final.
type Step = { name: string; started_at: string; finished_at?: string; status?: string; counts?: Record<string, unknown>; error?: string };
type Cycle = { id: string; trigger: string; status: string; started_at: string; finished_at: string | null; steps: Step[]; error: string | null };
type Product = { codigo: string; title: string | null; product_id: string | null };
type Today = {
  prices: { total: number; up: number; down: number; big: number; top: (Product & { antes: number; ahora: number; pct: number })[]; flips: (Product & { n: number; path: string })[] };
  stock: { total: number; out: number; back: number; out_list: (Product & { antes: number })[] };
  importer: { by_status: Record<string, number>; open_jobs: { id: string; title: string; status: string; paused_reason: string | null; total: number; done: number; errors: number }[] };
  ai_cost: { today: number; month: number };
  review: { pending: number };
};
type Overview = { read_at: string | null; in_listing: number; not_in_store: number; active_missing: number; active: number; draft: number; archived: number };
type Absences = { days: number; out: number; back: number; open: number; due: number; near: number };
type Data = { absences: Absences | null; cycles: Cycle[]; reading: { done: number; total: number } | null; today: Today | null; overview: Overview | null; alerts: { detail: { subject?: string; sent?: boolean; lines?: string[] }; created_at: string }[]; error: string | null; now: string };

const STEP_LABEL: Record<string, string> = { conexiones: "Conexiones", lectura: "Lectura de MHD", "precio-stock": "Precio y stock", agotados: "Agotados en MHD" };
const RUNNING = ["iniciando", "leyendo", "procesando"];
const STATUS: Record<string, { label: string; tone: string }> = {
  terminada: { label: "Terminada", tone: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" }, iniciando: { label: "Empezando", tone: "bg-sky-50 text-sky-700 ring-sky-600/20" },
  leyendo: { label: "Leyendo MHD", tone: "bg-sky-50 text-sky-700 ring-sky-600/20" }, procesando: { label: "Procesando", tone: "bg-sky-50 text-sky-700 ring-sky-600/20" },
  fallida: { label: "Fallida", tone: "bg-red-50 text-red-700 ring-red-600/20" }, atascada: { label: "Atascada", tone: "bg-red-50 text-red-700 ring-red-600/20" }, parada: { label: "Parada", tone: "bg-amber-50 text-amber-800 ring-amber-600/20" },
};
const integer = (value: number) => new Intl.NumberFormat("es-ES", { useGrouping: "always" }).format(value);
const dollars = (value: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "USD" }).format(value);
const euros = (value: number) => `${new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 }).format(value)} €`;
const clock = (iso: string) => new Date(iso).toLocaleTimeString("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit" });
const span = (from: string, to?: string | null, now = Date.now()) => Math.max(0, Math.round(((to ? new Date(to).getTime() : now) - new Date(from).getTime()) / 1000));
const duration = (secs: number) => (secs < 60 ? `${secs} s` : `${Math.floor(secs / 60)} min ${secs % 60} s`);
const shopifyHref = (item: Product) => (item.product_id ? `https://admin.shopify.com/store/electronica-vicente/products/${item.product_id.split("/").pop()}` : null);
// La vuelta programada sale en punto y a la media (pg_cron en UTC; Madrid tiene horas enteras de diferencia).
const nextCycle = (now: number) => { const date = new Date(now); date.setSeconds(0, 0); date.setMinutes(date.getMinutes() < 30 ? 30 : 60); return date; };

export function HomeDashboard() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (document.visibilityState === "hidden") return;
    try {
      const response = await fetch("/api/inicio", { cache: "no-store" });
      const body = await response.json() as Data & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "No se pudo actualizar.");
      setData(body); setError(body.error); setLoadedAt(Date.now());
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo actualizar."); }
  }, []);
  useEffect(() => {
    const first = window.setTimeout(() => { setNow(Date.now()); void load(); }, 0);
    createClient().auth.getUser().then(({ data: auth }) => setUserEmail(auth.user?.email ?? null));
    const poll = window.setInterval(() => void load(), 5_000);
    const tick = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => { window.clearTimeout(first); window.clearInterval(poll); window.clearInterval(tick); };
  }, [load]);

  const cycles = data?.cycles ?? [];
  const current = cycles[0];
  const live = current && RUNNING.includes(current.status);
  const services = ([...cycles].map((cycle) => cycle.steps.find((step) => step.name === "conexiones")).find(Boolean)?.counts?.services ?? []) as { name: string; ok: boolean; ms: number; error?: string }[];
  const today = data?.today; const overview = data?.overview;
  const next = nextCycle(now);

  return <div className="min-h-screen bg-zinc-50 lg:grid lg:grid-cols-[17.5rem_minmax(0,1fr)]">
    <AppSidebar active="home" userEmail={userEmail} />
    <main className="min-w-0 px-4 pb-24 pt-28 sm:px-10 lg:px-12 lg:py-16"><div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-4xl font-semibold tracking-tight text-zinc-950">Inicio</h1><p className="mt-2 text-zinc-600">Sincronización con MHD y estado de la tienda, en tiempo real.</p></div>
        <p className="flex items-center gap-2 text-sm text-zinc-500"><span className={`h-2 w-2 rounded-full ${error ? "bg-red-500" : "animate-pulse bg-emerald-500"}`} />{loadedAt ? `Actualizado hace ${Math.max(0, Math.round((now - loadedAt) / 1000))} s` : "Cargando…"}</p>
      </header>
      {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">{error}</p>}

      <section className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card title={live ? "Vuelta en curso" : "Última vuelta"} aside={current ? <Badge status={current.status} /> : null}>
          {!current ? <Empty text="Aún no hay vueltas." /> : <>
            <p className="text-sm text-zinc-600">{current.trigger === "manual" ? "Lanzada a mano" : "Programada"} a las {clock(current.started_at)} · {live ? `lleva ${duration(span(current.started_at, null, now))}` : `${duration(span(current.started_at, current.finished_at))} en total`}</p>
            <ol className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{current.steps.map((step) => {
              const running = !step.finished_at && live; const secs = span(step.started_at, step.finished_at, now);
              return <li key={step.name} className={`rounded-xl border p-3 ${step.status === "error" ? "border-red-200 bg-red-50" : running ? "border-sky-200 bg-sky-50" : "border-zinc-200"}`}>
                <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{STEP_LABEL[step.name] ?? step.name}</p>
                <p className="mt-1 font-semibold tabular-nums text-zinc-900">{running ? <span className="text-sky-700">{duration(secs)}…</span> : duration(secs)}</p>
                <p className="mt-1 text-xs text-zinc-600">{stepDetail(step, running ? data?.reading : null)}</p>
                {running && step.name === "lectura" && data?.reading?.total ? <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sky-100"><div className="h-full bg-sky-600 transition-all duration-700" style={{ width: `${Math.round(100 * data.reading.done / data.reading.total)}%` }} /></div> : null}
              </li>;
            })}</ol>
            {current.error && <p className="mt-3 text-sm text-red-700">{current.error}</p>}
            <p className="mt-4 text-sm text-zinc-500">Próxima vuelta a las {next.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })} (en {duration(Math.max(0, Math.round((next.getTime() - now) / 1000)))}).</p>
          </>}
        </Card>
        <Card title="Conexiones" aside={<span className="text-xs text-zinc-500">en la última vuelta</span>}>
          {services.length ? <ul className="flex flex-col gap-2">{services.map((service) => <li key={service.name} className="flex items-center justify-between gap-3 rounded-lg bg-zinc-50 px-3 py-2">
            <span className="flex items-center gap-2 font-medium text-zinc-800"><span className={`h-2.5 w-2.5 rounded-full ${service.ok ? "bg-emerald-500" : "bg-red-500"}`} />{service.name}</span>
            <span className={`text-sm tabular-nums ${service.ok ? "text-zinc-500" : "font-medium text-red-700"}`}>{service.ok ? `${(service.ms / 1000).toLocaleString("es-ES", { maximumFractionDigits: 1 })} s` : "Sin conexión"}</span>
          </li>)}</ul> : <Empty text="Sin comprobaciones todavía." />}
        </Card>
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Stat label="Activos en la tienda" value={overview ? integer(overview.active) : "…"} note={overview ? `${integer(overview.draft)} borradores · ${integer(overview.archived)} archivados` : ""} />
        <Stat label="Listado de MHD" value={overview ? integer(overview.in_listing) : "…"} note={overview ? `${integer(overview.not_in_store)} sin estar en la tienda` : ""} />
        <Stat label="Agotados en MHD" value={data?.absences ? integer(data.absences.open) : "…"} note={data?.absences ? `hoy ${integer(data.absences.out)} se agotan y ${integer(data.absences.back)} vuelven${data.absences.due ? ` · ${integer(data.absences.due)} pasan de ${data.absences.days} días` : ""}` : ""} warn={Boolean(data?.absences?.due)} />
        <Stat label="Precios hoy" value={today ? integer(today.prices.total) : "…"} note={today ? `↑ ${integer(today.prices.up)} · ↓ ${integer(today.prices.down)}${today.prices.big ? ` · ${today.prices.big} >30 %` : ""}` : ""} warn={Boolean(today?.prices.big)} />
        <Stat label="Stock hoy" value={today ? integer(today.stock.total) : "…"} note={today ? `${integer(today.stock.out)} agotados · ${integer(today.stock.back)} repuestos` : ""} />
        <Stat label="Gasto de IA" value={today ? dollars(today.ai_cost.today) : "…"} note={today ? `${dollars(today.ai_cost.month)} este mes` : ""} />
      </section>

      <Card title="Últimas vueltas" aside={<a href="/importar-datos-mhd" className="text-sm font-medium text-emerald-700 underline">Ver todas</a>}>
        {cycles.length ? <CycleChart cycles={[...cycles].reverse()} now={now} /> : <Empty text="Aún no hay vueltas." />}
      </Card>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card title="Mayores cambios de precio hoy">
          {today?.prices.top.length ? <table className="w-full text-sm"><tbody className="divide-y divide-zinc-100">{today.prices.top.slice(0, 8).map((item) => <tr key={item.codigo}>
            <td className="py-1.5 pr-3"><ProductLink item={item} /></td>
            <td className="whitespace-nowrap py-1.5 pr-3 text-right tabular-nums text-zinc-500">{euros(item.antes)} → <span className="text-zinc-900">{euros(item.ahora)}</span></td>
            <td className={`whitespace-nowrap py-1.5 text-right font-medium tabular-nums ${Math.abs(item.pct) > 30 ? "text-amber-700" : item.pct > 0 ? "text-zinc-700" : "text-emerald-700"}`}>{item.pct > 0 ? "+" : ""}{item.pct} %</td>
          </tr>)}</tbody></table> : <Empty text="Sin cambios de precio hoy." />}
        </Card>
        <div className="flex flex-col gap-4">
          <Card title="Precios que van y vuelven" aside={<span className="text-xs text-zinc-500">hoy</span>}>
            {today?.prices.flips.length ? <ul className="flex flex-col gap-1.5 text-sm">{today.prices.flips.slice(0, 5).map((item) => <li key={item.codigo} className="flex justify-between gap-3"><ProductLink item={item} /><span className="shrink-0 tabular-nums text-zinc-500">{item.path} €</span></li>)}</ul> : <Empty text="Ninguno hoy." />}
          </Card>
          <Card title="Avisos" aside={<span className="text-xs text-zinc-500">últimas 24 h</span>}>
            {data?.alerts.length ? <ul className="flex flex-col gap-1.5 text-sm">{data.alerts.map((alert) => <li key={alert.created_at} className="flex gap-3"><span className="shrink-0 tabular-nums text-zinc-500">{clock(alert.created_at)}</span><span className="text-amber-800">{alert.detail.subject}</span></li>)}</ul> : <Empty text="Ningún aviso. Todo en orden." />}
          </Card>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card title="Importador de productos" aside={<a href="/importador-productos" className="text-sm font-medium text-emerald-700 underline">Abrir</a>}>
          {today?.importer.open_jobs.length ? <ul className="flex flex-col gap-3">{today.importer.open_jobs.map((job) => <li key={job.id}>
            <div className="flex justify-between gap-3 text-sm"><span className="font-medium text-zinc-800">{job.title}</span><span className="tabular-nums text-zinc-500">{integer(job.done)} / {integer(job.total)}</span></div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-zinc-100"><div className="h-full bg-emerald-600 transition-all duration-700" style={{ width: `${job.total ? Math.round(100 * job.done / job.total) : 0}%` }} /></div>
            {job.paused_reason && <p className="mt-1 text-xs text-amber-800">Pausado: {job.paused_reason}</p>}
          </li>)}</ul> : <p className="text-sm text-zinc-600">Ningún trabajo en marcha.</p>}
          {today && <p className="mt-3 text-sm text-zinc-600">Hoy: {integer(today.importer.by_status.ok ?? 0)} subidos bien, {integer(today.importer.by_status.descartado ?? 0)} descartados y {integer(today.importer.by_status.error ?? 0)} con error.</p>}
        </Card>
        <Card title="Cola de revisión" aside={<a href="/importador-productos" className="text-sm font-medium text-emerald-700 underline">Revisar</a>}>
          <p className="text-3xl font-semibold tabular-nums text-zinc-950">{today ? integer(today.review.pending) : "…"}</p>
          <p className="mt-1 text-sm text-zinc-600">productos en borrador esperando revisión.</p>
          {today?.stock.out_list.length ? <><p className="mt-4 text-xs font-medium uppercase tracking-wide text-zinc-500">Agotados hoy</p><ul className="mt-1 flex flex-col gap-1 text-sm">{today.stock.out_list.slice(0, 4).map((item) => <li key={item.codigo}><ProductLink item={item} /></li>)}</ul></> : null}
        </Card>
      </section>

      <details className="group rounded-2xl border border-zinc-200 bg-white shadow-sm">
        <summary className="cursor-pointer list-none px-5 py-4 text-sm font-medium text-zinc-700"><span className="mr-2 inline-block transition-transform group-open:rotate-90">›</span>Procesos de Pladisel (sincronización antigua)</summary>
        <div className="border-t border-zinc-100 p-5"><ProcessOverview embedded /></div>
      </details>
    </div></main>
  </div>;
}

function stepDetail(step: Step, reading?: { done: number; total: number } | null) {
  const counts = step.counts ?? {};
  if (step.status === "error") return step.error ?? "Error";
  if (step.name === "conexiones") { const failed = (counts.failed as string[] | undefined) ?? []; return failed.length ? `Sin conexión: ${failed.join(", ")}` : "Todo responde"; }
  if (step.name === "lectura") return reading ? `${integer(reading.done)} de ${integer(reading.total)} productos` : counts.products ? `${integer(Number(counts.products))} productos` : "Leyendo…";
  if (step.name === "precio-stock") return step.finished_at ? `${integer(Number(counts.pricesSent ?? 0))} precios · ${integer(Number(counts.stockSent ?? 0))} stocks` : "Enviando a Shopify…";
  if (step.name === "agotados") return step.finished_at ? `${integer(Number(counts.applied ?? 0))} se agotan · ${integer(Number(counts.returned ?? 0))} vuelven${counts.braked ? " · freno" : ""}` : "Confirmando con MHD…";
  return step.finished_at ? "Hecho" : "En marcha…";
}

function CycleChart({ cycles, now }: { cycles: Cycle[]; now: number }) {
  const secs = cycles.map((cycle) => span(cycle.started_at, cycle.finished_at, now));
  const max = Math.max(300, ...secs);
  return <div>
    <div className="flex h-36 items-end gap-1.5">{cycles.map((cycle, index) => {
      const sync = cycle.steps.find((step) => step.name === "precio-stock")?.counts;
      const tone = cycle.status === "terminada" ? "bg-emerald-500" : RUNNING.includes(cycle.status) ? "animate-pulse bg-sky-500" : cycle.status === "parada" ? "bg-amber-400" : "bg-red-500";
      return <div key={cycle.id} className="group relative flex h-full min-w-0 max-w-10 flex-1 flex-col justify-end">
        <div className={`w-full rounded-t ${tone}`} style={{ height: `${Math.max(4, Math.round(100 * secs[index] / max))}%` }} />
        <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden w-48 -translate-x-1/2 rounded-lg bg-zinc-900 p-2 text-xs text-white shadow-lg group-hover:block">
          <p className="font-medium">{clock(cycle.started_at)} · {STATUS[cycle.status]?.label ?? cycle.status}</p>
          <p>{duration(secs[index])} en total</p>
          {sync && <p>{integer(Number(sync.pricesSent ?? 0))} precios · {integer(Number(sync.stockSent ?? 0))} stocks</p>}
          {cycle.error && <p className="text-red-300">{cycle.error}</p>}
        </div>
      </div>;
    })}</div>
    <div className="mt-2 flex justify-between text-xs tabular-nums text-zinc-500"><span>{clock(cycles[0].started_at)}</span><span>Duración de cada vuelta (pasa el ratón por encima)</span><span>{clock(cycles.at(-1)!.started_at)}</span></div>
  </div>;
}

function Card({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return <section className="min-w-0 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm"><div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold text-zinc-950">{title}</h2>{aside}</div>{children}</section>;
}
function Stat({ label, value, note, warn }: { label: string; value: string; note: string; warn?: boolean }) {
  return <div className={`min-w-0 rounded-2xl border bg-white p-4 shadow-sm ${warn ? "border-amber-200" : "border-zinc-200"}`}><p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p><p className={`mt-1 text-2xl font-semibold tabular-nums ${warn ? "text-amber-800" : "text-zinc-950"}`}>{value}</p><p className="mt-1 text-xs text-zinc-500">{note}</p></div>;
}
function Badge({ status }: { status: string }) {
  const meta = STATUS[status] ?? { label: status, tone: "bg-zinc-100 text-zinc-700 ring-zinc-600/20" };
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${meta.tone}`}>{meta.label}</span>;
}
function ProductLink({ item }: { item: Product }) {
  const href = shopifyHref(item);
  return href ? <a href={href} target="_blank" rel="noreferrer" className="text-zinc-800 hover:text-emerald-700 hover:underline">{item.title ?? item.codigo}</a> : <span className="text-zinc-800">{item.title ?? item.codigo}</span>;
}
function Empty({ text }: { text: string }) { return <p className="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-5 text-center text-sm text-zinc-600">{text}</p>; }
