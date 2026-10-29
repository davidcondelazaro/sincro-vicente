"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { createClient } from "@/lib/supabase/client";

// Avisos de bajada de precio: clientes que esperan a que un producto baje del precio que tenía al apuntarse.
type Subscription = {
  id: number; product_id: number; variant_id: number | null; product_title: string; price_at_signup: number; notified_price: number | null; email: string; name: string | null;
  source: "chat" | "web" | "otro"; conversation_id: string | null; status: "pendiente" | "avisado" | "cancelado" | "error";
  created_at: string; notified_at: string | null; cancelled_at: string | null; cancelled_by: string | null; last_error: string | null;
};
type Data = { rows: Subscription[]; total: number; pageSize: number; top: { productId: number; title: string; waiting: number; notified: number }[]; totals: { pending: number; notified: number }; schedule: Schedule };
type Schedule = { last: { at: string; ok: boolean; sent: number | null; ready: number | null; failed: number | null } | null; next: string | null; enabled: boolean };

const dateFormat = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "short" });
const statusInfo: Record<Subscription["status"], { label: string; tone: string }> = {
  pendiente: { label: "Esperando", tone: "bg-amber-50 text-amber-800" },
  avisado: { label: "Avisado", tone: "bg-emerald-50 text-emerald-800" },
  cancelado: { label: "Cancelado", tone: "bg-zinc-100 text-zinc-500" },
  error: { label: "Error", tone: "bg-red-50 text-red-800" },
};
const euro = (value: number) => new Intl.NumberFormat("es-ES", { useGrouping: "always", style: "currency", currency: "EUR", minimumFractionDigits: Number.isInteger(value) ? 0 : 2 }).format(value);
const sourceLabels: Record<Subscription["source"], string> = { chat: "Chat", web: "Web", otro: "Otro" };

export default function PriceAlertsPage() {
  const [email, setEmail] = useState<string | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("pendiente");
  const [source, setSource] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

  useEffect(() => { createClient().auth.getUser().then(({ data: user }) => setEmail(user.user?.email ?? null)); }, []);
  useEffect(() => { const timer = setTimeout(() => setQuery(search.trim()), 300); return () => clearTimeout(timer); }, [search]);

  const [reload, setReload] = useState(0);

  useEffect(() => {
    let current = true;
    const params = new URLSearchParams({ status, source, search: query, page: String(page) });
    fetch(`/api/tienda/avisos-precio?${params}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "No se pudieron leer los avisos.");
        if (current) { setData(body); setError(null); }
      })
      .catch((caught) => { if (current) setError(caught instanceof Error ? caught.message : "No se pudieron leer los avisos."); });
    return () => { current = false; };
  }, [status, source, query, page, reload]);

  async function cancel(id: number) {
    if (!window.confirm("¿Cancelar este aviso? El cliente no recibirá el email.")) return;
    const response = await fetch("/api/tienda/avisos-precio", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    const body = await response.json();
    if (!response.ok) { setError(body.error ?? "No se pudo cancelar."); return; }
    setReload((n) => n + 1);
  }

  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const select = "mt-1 block h-10 rounded-lg border border-zinc-300 bg-white px-2 font-normal";
  return <div className="min-h-screen bg-zinc-50 lg:grid lg:grid-cols-[17.5rem_minmax(0,1fr)]"><AppSidebar active="priceAlerts" userEmail={email} /><main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 pb-24 pt-28 sm:px-10 lg:mx-0 lg:py-16">
    <header><p className="text-sm font-semibold tracking-[0.18em] text-emerald-700 uppercase">Tienda</p><h1 className="mt-2 text-4xl font-semibold tracking-tight text-zinc-950">Avisos de precio</h1><p className="mt-3 max-w-3xl text-zinc-600">Clientes que han pedido desde el chat que les avisemos si un producto baja de precio. Se guarda el precio del momento y el aviso se envía por email una sola vez, tras la copia de productos (cada hora) en la que está más barato y se puede comprar.</p></header>
    {data?.schedule && <ScheduleLine schedule={data.schedule} />}
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    {data && <section className="grid grid-cols-1 gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm"><p className="text-sm text-zinc-500">Esperando aviso</p><p className="mt-1 text-2xl font-semibold tabular-nums">{data.totals.pending.toLocaleString("es-ES", { useGrouping: "always" })}</p></div>
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm"><p className="text-sm text-zinc-500">Avisos enviados</p><p className="mt-1 text-2xl font-semibold tabular-nums">{data.totals.notified.toLocaleString("es-ES", { useGrouping: "always" })}</p></div>
      </div>
      <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-zinc-900">Productos con más gente esperando una bajada</h2>
        {data.top.length ? <ol className="mt-3 flex flex-col gap-2 text-sm">{data.top.map((item, index) => <li key={`${item.productId}-${index}`} className="flex items-baseline gap-3"><span className="w-5 shrink-0 text-right tabular-nums text-zinc-400">{index + 1}</span><span className="min-w-0 flex-1 truncate text-zinc-800" title={item.title}>{item.title}</span><span className="tabular-nums text-zinc-600">{item.waiting} esperando</span></li>)}</ol> : <p className="mt-3 text-sm text-zinc-500">Nadie está esperando una bajada de precio ahora mismo.</p>}
      </div>
    </section>}
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-sm font-medium text-zinc-700">Buscar<input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Email, nombre o producto" className="mt-1 block h-10 w-72 max-w-full rounded-lg border border-zinc-300 bg-white px-3 font-normal" /></label>
      <label className="text-sm font-medium text-zinc-700">Estado<select value={status} onChange={(event) => { setStatus(event.target.value); setPage(0); }} className={select}><option value="">Todos</option><option value="pendiente">Esperando</option><option value="avisado">Avisados</option><option value="cancelado">Cancelados</option><option value="error">Con error</option></select></label>
      <label className="text-sm font-medium text-zinc-700">Origen<select value={source} onChange={(event) => { setSource(event.target.value); setPage(0); }} className={select}><option value="">Todos</option><option value="chat">Chat</option><option value="web">Web</option><option value="otro">Otro</option></select></label>
      <p className="ml-auto pb-2 text-sm text-zinc-500">{(data?.total ?? 0).toLocaleString("es-ES", { useGrouping: "always" })} avisos</p>
    </div>
    <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
      {!data ? <p className="p-5 text-sm text-zinc-500">Cargando…</p> : !data.rows.length ? <p className="p-5 text-sm text-zinc-500">No hay avisos con estos filtros.</p> : <ul className="divide-y divide-zinc-100">{data.rows.map((row) => {
        const info = statusInfo[row.status];
        return <li key={row.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5 text-sm">
          <span className="min-w-0 flex-1"><span className="block truncate font-medium text-zinc-900" title={row.product_title}>{row.product_title}</span><span className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-zinc-500"><span>{row.email}{row.name ? ` · ${row.name}` : ""}</span><span>Precio al apuntarse: {euro(Number(row.price_at_signup))}</span>{row.notified_price !== null && <span className="text-emerald-700">Avisado a {euro(Number(row.notified_price))}</span>}<span>{sourceLabels[row.source]}</span><span>Pedido el {dateFormat.format(new Date(row.created_at))}</span>{row.notified_at && <span>Avisado el {dateFormat.format(new Date(row.notified_at))}</span>}{row.cancelled_at && <span>Cancelado el {dateFormat.format(new Date(row.cancelled_at))}{row.cancelled_by ? ` (${row.cancelled_by})` : ""}</span>}{row.last_error && <span className="text-red-700">Error: {row.last_error}</span>}</span></span>
          {row.conversation_id && <a href={`/chatbot/conversaciones?conversacion=${row.conversation_id}`} target="_blank" rel="noreferrer" className="text-xs font-medium text-emerald-700 hover:underline">Conversación ↗</a>}
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${info.tone}`}>{info.label}</span>
          {row.status === "pendiente" && <button type="button" onClick={() => void cancel(row.id)} className="cursor-pointer rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-red-50 hover:text-red-700">Cancelar</button>}
        </li>;
      })}</ul>}
    </section>
    {data && data.total > data.pageSize && <div className="flex items-center justify-between"><button type="button" disabled={!page} onClick={() => setPage((value) => value - 1)} className="cursor-pointer rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50">Anterior</button><span className="text-sm text-zinc-500">Página {page + 1} de {pages}</span><button type="button" disabled={page + 1 >= pages} onClick={() => setPage((value) => value + 1)} className="cursor-pointer rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50">Siguiente</button></div>}
  </main></div>;
}

/** Cuándo se comprueban los avisos: tras cada copia de productos del chatbot. */
function ScheduleLine({ schedule }: { schedule: Schedule }) {
  const { last, next, enabled } = schedule;
  const result = last && last.sent !== null ? ` · ${last.sent} ${last.sent === 1 ? "enviado" : "enviados"}${last.failed ? `, ${last.failed} con error` : ""}` : "";
  return <p className="-mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-600">
    <span>Última comprobación: {last ? `${dateFormat.format(new Date(last.at))}${last.ok ? result : " · la copia de productos falló"}` : "todavía ninguna"}</span>
    <span>Próxima: {enabled && next ? dateFormat.format(new Date(next)) : "copia de productos sin programar"}</span>
    <Link href="/chatbot/sincronizaciones" className="font-medium text-emerald-700 hover:underline">Programación</Link>
  </p>;
}
