"use client";

import { useEffect, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { createClient } from "@/lib/supabase/client";

// Presupuestos a medida que los clientes piden desde el chat: líneas con los precios del día del envío,
// comentarios, datos de contacto, estado y notas internas.
type Line = {
  product_id: number; variant_id: number | null; title: string; option: string | null; handle: string; quantity: number; unit_price: number;
  services: { type: string; name: string; price: number }[]; warranty: { years: number; title: string; price: number } | null; unavailable: string[];
};
type Quote = {
  id: number; conversation_id: string | null; status: string; items: Line[]; comments: string | null; name: string | null; email: string | null;
  phone: string | null; postal_code: string | null; total: number | null; team_notes: string | null; conversation_summary: string | null; submitted_at: string; status_changed_at: string | null;
  status_changed_by: string | null; sent_team_at: string | null; ack_sent_at: string | null; last_error: string | null;
};

const STATUS: Record<string, { label: string; tone: string }> = {
  nuevo: { label: "Nuevo", tone: "bg-amber-50 text-amber-800" },
  en_curso: { label: "En curso", tone: "bg-sky-50 text-sky-800" },
  enviado: { label: "Presupuesto enviado", tone: "bg-indigo-50 text-indigo-800" },
  aceptado: { label: "Aceptado", tone: "bg-emerald-50 text-emerald-800" },
  descartado: { label: "Descartado", tone: "bg-zinc-100 text-zinc-500" },
};
const dateFormat = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "short" });
const euro = (v: number) => new Intl.NumberFormat("es-ES", { useGrouping: "always", style: "currency", currency: "EUR", minimumFractionDigits: Number.isInteger(v) ? 0 : 2 }).format(v);
const lineTotal = (l: Line) => l.quantity * (l.unit_price + l.services.reduce((s, x) => s + x.price, 0) + (l.warranty?.price ?? 0));

export default function QuotesPage() {
  const [email, setEmail] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<Quote[] | null>(null);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  // Deep link ?presupuesto=<id> (desde el email al equipo). En el servidor no hay lista que abrir aún.
  const [openId, setOpenId] = useState<number | null>(() => (typeof window === "undefined" ? null : Number(new URLSearchParams(window.location.search).get("presupuesto")) || null));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { createClient().auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null)); }, []);
  useEffect(() => { const timer = setTimeout(() => setQuery(search.trim()), 300); return () => clearTimeout(timer); }, [search]);

  useEffect(() => {
    let current = true;
    fetch(`/api/tienda/presupuestos?${new URLSearchParams({ status, search: query })}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "No se pudieron leer los presupuestos.");
        if (current) { setQuotes(body.quotes); setError(null); }
      })
      .catch((caught) => { if (current) setError(caught instanceof Error ? caught.message : "No se pudieron leer los presupuestos."); });
    return () => { current = false; };
  }, [status, query]);

  async function save(id: number, changes: { status?: string; teamNotes?: string }) {
    const response = await fetch("/api/tienda/presupuestos", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...changes }) });
    const body = await response.json();
    if (!response.ok) { setError(body.error ?? "No se pudo guardar."); return; }
    setQuotes((current) => current?.map((q) => (q.id === id ? body.quote : q)) ?? null);
  }

  const counts = (quotes ?? []).reduce<Record<string, number>>((acc, q) => { acc[q.status] = (acc[q.status] ?? 0) + 1; return acc; }, {});
  return <div className="min-h-screen bg-zinc-50 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]"><AppSidebar active="quotes" userEmail={email} /><main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 pb-24 pt-28 sm:px-10 lg:mx-0 lg:py-16">
    <header><p className="text-sm font-semibold tracking-[0.18em] text-emerald-700 uppercase">Tienda</p><h1 className="mt-2 text-4xl font-semibold tracking-tight text-zinc-950">Presupuestos</h1><p className="mt-3 max-w-3xl text-zinc-600">Presupuestos a medida que piden los clientes desde el chat. Los precios son los de la web en el momento del envío; al cliente le llegó un resumen sin precios.</p></header>
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-sm font-medium text-zinc-700">Buscar<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nombre, email o comentario" className="mt-1 block h-10 w-72 max-w-full rounded-lg border border-zinc-300 bg-white px-3 font-normal" /></label>
      <label className="text-sm font-medium text-zinc-700">Estado<select value={status} onChange={(event) => setStatus(event.target.value)} className="mt-1 block h-10 rounded-lg border border-zinc-300 bg-white px-2 font-normal"><option value="">Todos</option>{Object.entries(STATUS).map(([key, s]) => <option key={key} value={key}>{s.label}{counts[key] && !status ? ` (${counts[key]})` : ""}</option>)}</select></label>
      <p className="ml-auto pb-2 text-sm text-zinc-500">{quotes?.length ?? 0} {quotes?.length === 1 ? "presupuesto" : "presupuestos"}</p>
    </div>
    <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
      {!quotes ? <p className="p-5 text-sm text-zinc-500">Cargando…</p> : !quotes.length ? <p className="p-5 text-sm text-zinc-500">No hay presupuestos.</p> : <ul className="divide-y divide-zinc-100">{quotes.map((q) => {
        const s = STATUS[q.status] ?? { label: q.status, tone: "bg-zinc-100 text-zinc-600" };
        const open = openId === q.id;
        return <li key={q.id}>
          <button type="button" onClick={() => setOpenId(open ? null : q.id)} aria-expanded={open} className="flex w-full cursor-pointer items-start gap-4 px-5 py-3.5 text-left hover:bg-zinc-50">
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-zinc-900">PRE-{q.id} · {q.name} · {q.items.length} {q.items.length === 1 ? "producto" : "productos"}</span>
              <span className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-zinc-500"><span className={`rounded-full px-2 font-medium ${s.tone}`}>{s.label}</span><span>{dateFormat.format(new Date(q.submitted_at))}</span><span>{q.email}</span>{q.total != null && <span className="font-medium text-zinc-700">{euro(Number(q.total))}</span>}{!q.sent_team_at && <span className="text-red-700">Email al equipo sin enviar</span>}</span></span>
            <span className="shrink-0 pt-0.5 text-sm font-medium text-emerald-700">{open ? "▼ Ocultar" : "▶ Ver"}</span>
          </button>
          {open && <QuoteDetail quote={q} onSave={(changes) => void save(q.id, changes)} />}
        </li>;
      })}</ul>}
    </section>
  </main></div>;
}

function QuoteDetail({ quote, onSave }: { quote: Quote; onSave: (changes: { status?: string; teamNotes?: string }) => void }) {
  const [notes, setNotes] = useState(quote.team_notes ?? "");
  return <div className="border-t border-zinc-100 bg-zinc-50 px-5 py-5 text-sm">
    {quote.conversation_summary && <div className="mb-4"><p className="text-xs text-zinc-500">Resumen de la conversación</p><ul className="mt-1 list-disc space-y-0.5 pl-5 text-zinc-800">{quote.conversation_summary.split("\n").filter(Boolean).map((line, i) => <li key={i}>{line.replace(/^[-•]\s*/, "")}</li>)}</ul></div>}
    <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
      {[["Nombre", quote.name], ["Email", quote.email], ["Teléfono", quote.phone], ["Código postal", quote.postal_code]].map(([k, v]) => <div key={k}><p className="text-xs text-zinc-500">{k}</p><p className="font-medium text-zinc-900">{k === "Email" && v ? <a href={`mailto:${v}?subject=${encodeURIComponent(`Tu presupuesto PRE-${quote.id}`)}`} className="text-emerald-700 hover:underline">{v}</a> : v ?? "—"}</p></div>)}
    </div>
    <div className="mt-4 overflow-x-auto rounded-xl border border-zinc-200 bg-white"><table className="w-full text-sm">
      <thead className="text-left text-xs text-zinc-500"><tr><th className="px-3 py-2 font-medium">Producto y extras</th><th className="px-3 py-2 text-center font-medium">Uds.</th><th className="px-3 py-2 text-right font-medium">Precio</th><th className="px-3 py-2 text-right font-medium">Total</th></tr></thead>
      <tbody className="divide-y divide-zinc-100">{quote.items.map((l, i) => <tr key={i} className="align-top">
        <td className="px-3 py-2"><a href={`https://www.electronicavicente.com/products/${l.handle}`} target="_blank" rel="noreferrer" className="font-medium text-zinc-900 hover:underline">{l.title}</a>{l.option && <span className="text-zinc-500"> ({l.option})</span>}
          {l.services.map((s) => <div key={s.type} className="text-xs text-zinc-600">+ {s.name} ({euro(s.price)}/ud.)</div>)}
          {l.warranty && <div className="text-xs text-zinc-600">+ {l.warranty.title} ({euro(l.warranty.price)}/ud.)</div>}
          {l.unavailable.length > 0 && <div className="text-xs text-amber-700">No disponible: {l.unavailable.join(", ")}</div>}</td>
        <td className="px-3 py-2 text-center">{l.quantity}</td>
        <td className="px-3 py-2 text-right tabular-nums">{euro(l.unit_price)}</td>
        <td className="px-3 py-2 text-right font-medium tabular-nums">{euro(lineTotal(l))}</td>
      </tr>)}</tbody>
      <tfoot><tr><td colSpan={3} className="px-3 py-2 text-right font-semibold">Total con precios del día del envío (sin portes)</td><td className="px-3 py-2 text-right font-semibold tabular-nums">{euro(Number(quote.total ?? 0))}</td></tr></tfoot>
    </table></div>
    {quote.comments && <div className="mt-4"><p className="text-xs text-zinc-500">Comentarios del cliente</p><p className="mt-1 whitespace-pre-wrap text-zinc-800">{quote.comments}</p></div>}
    <div className="mt-4 flex flex-wrap items-end gap-3">
      <label className="text-xs font-medium text-zinc-500">Estado<select value={quote.status} onChange={(event) => onSave({ status: event.target.value })} className="mt-1 block h-9 rounded-lg border border-zinc-300 bg-white px-2 text-sm font-normal text-zinc-900">{Object.entries(STATUS).map(([key, s]) => <option key={key} value={key}>{s.label}</option>)}</select></label>
      <label className="min-w-64 flex-1 text-xs font-medium text-zinc-500">Notas internas<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} className="mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm font-normal text-zinc-900" /></label>
      {notes !== (quote.team_notes ?? "") && <button type="button" onClick={() => onSave({ teamNotes: notes })} className="h-9 cursor-pointer rounded-lg border border-emerald-700 px-3 text-sm font-medium text-emerald-800 hover:bg-emerald-50">Guardar notas</button>}
    </div>
    <p className="mt-3 text-xs text-zinc-500">
      {quote.conversation_id && <><a href={`/chatbot/conversaciones?conversacion=${quote.conversation_id}`} target="_blank" rel="noreferrer" className="text-emerald-700 hover:underline">Ver la conversación ↗</a> · </>}
      Email al equipo: {quote.sent_team_at ? dateFormat.format(new Date(quote.sent_team_at)) : "pendiente"} · Acuse al cliente: {quote.ack_sent_at ? dateFormat.format(new Date(quote.ack_sent_at)) : "pendiente"}
      {quote.status_changed_by && ` · Último cambio de estado: ${quote.status_changed_by}${quote.status_changed_at ? `, ${dateFormat.format(new Date(quote.status_changed_at))}` : ""}`}
      {quote.last_error && <span className="text-red-700"> · Error: {quote.last_error}</span>}
    </p>
  </div>;
}
