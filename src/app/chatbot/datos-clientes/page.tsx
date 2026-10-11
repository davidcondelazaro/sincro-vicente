"use client";

import { useEffect, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { createClient } from "@/lib/supabase/client";

// Datos de clientes (RGPD): cuando un cliente pide qué datos tenemos de él o que los borremos. Se busca por email
// todo lo que guarda el chatbot, se puede descargar y se puede borrar. Todo queda registrado.
type Section = { label: string; rows: Record<string, unknown>[] };
type Result = {
  email: string; sections: Record<string, Section>; counts: Record<string, number>;
  history: { action: string; requested_by: string; counts: Record<string, number>; note: string | null; created_at: string }[];
};

const dateFormat = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "short" });
const ACTIONS: Record<string, string> = { busqueda: "Búsqueda", exportacion: "Exportación", borrado: "Borrado" };
const total = (counts: Record<string, number>) => Object.values(counts).reduce((sum, n) => sum + n, 0);

export default function CustomerDataPage() {
  const [user, setUser] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [note, setNote] = useState("");
  const [deleted, setDeleted] = useState<Record<string, number> | null>(null);

  useEffect(() => { createClient().auth.getUser().then(({ data }) => setUser(data.user?.email ?? null)); }, []);

  async function search(event?: React.FormEvent) {
    event?.preventDefault();
    setBusy(true); setError(null); setDeleted(null); setConfirm("");
    try {
      const response = await fetch(`/api/chatbot/datos-cliente?${new URLSearchParams({ email: email.trim() })}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "No se pudo buscar.");
      setResult(body);
    } catch (caught) {
      setResult(null); setError(caught instanceof Error ? caught.message : "No se pudo buscar.");
    } finally { setBusy(false); }
  }

  async function remove() {
    if (!result || !window.confirm(`¿Borrar definitivamente todos los datos de ${result.email}? No se puede deshacer.`)) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/chatbot/datos-cliente", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: result.email, confirm, note }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "No se pudo borrar.");
      setDeleted(body.deleted); setResult(null); setConfirm(""); setNote("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo borrar.");
    } finally { setBusy(false); }
  }

  const found = result ? total(result.counts) : 0;
  return <div className="min-h-screen bg-zinc-50 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]"><AppSidebar active="chatbotPrivacy" userEmail={user} /><main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 pb-24 pt-28 sm:px-10 lg:mx-0 lg:py-16">
    <header><p className="text-sm font-semibold tracking-[0.18em] text-emerald-700 uppercase">Chatbot IA</p><h1 className="mt-2 text-4xl font-semibold tracking-tight text-zinc-950">Datos de clientes</h1><p className="mt-3 max-w-3xl text-zinc-600">Para atender a un cliente que pide qué datos suyos tenemos, una copia o que los borremos (RGPD). Busca por su email todo lo que guarda el chatbot: conversaciones, avisos, presupuestos, tickets, consentimientos y emails enviados. Cada búsqueda, descarga o borrado queda registrado. Los pedidos y la newsletter están en Shopify y se gestionan allí.</p></header>

    <form onSubmit={search} className="flex flex-wrap items-end gap-3">
      <label className="text-sm font-medium text-zinc-700">Email del cliente<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="cliente@ejemplo.com" className="mt-1 block h-10 w-80 max-w-full rounded-lg border border-zinc-300 bg-white px-3 font-normal" /></label>
      <button type="submit" disabled={busy} className="h-10 cursor-pointer rounded-lg bg-emerald-700 px-4 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50">Buscar</button>
    </form>
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    {deleted && <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">Borrado: {Object.entries(deleted).filter(([, n]) => n).map(([key, n]) => `${n} ${key.replace(/_/g, " ")}`).join(", ") || "no había datos"}. Queda registrado en el historial.</p>}

    {result && <>
      <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-3"><h2 className="text-lg font-semibold text-zinc-900">{found ? `${found} registros de ${result.email}` : `No hay datos de ${result.email}`}</h2>
          {found > 0 && <a href={`/api/chatbot/datos-cliente?${new URLSearchParams({ email: result.email, export: "1" })}`} className="text-sm font-medium text-emerald-700 hover:underline">Descargar todo (JSON) ↓</a>}</div>
        <ul className="mt-4 divide-y divide-zinc-100 text-sm">{Object.entries(result.sections).map(([key, section]) => <li key={key} className="py-2.5">
          <details><summary className={`flex cursor-pointer justify-between gap-3 ${section.rows.length ? "text-zinc-900" : "text-zinc-400"}`}><span>{section.label}</span><span className="tabular-nums">{section.rows.length}</span></summary>
            {section.rows.length > 0 && <ul className="mt-2 flex flex-col gap-1.5 pl-3 text-xs text-zinc-600">{section.rows.slice(0, 50).map((row, index) => <li key={index} className="truncate">{describe(key, row)}</li>)}</ul>}
          </details></li>)}</ul>
      </section>

      {found > 0 && <section className="rounded-2xl border border-red-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-red-800">Borrar todos sus datos</h2>
        <p className="mt-1 text-sm text-zinc-600">Borra definitivamente todo lo anterior, incluidas sus conversaciones completas. No se puede deshacer. Descarga antes una copia si el cliente la ha pedido.</p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="text-sm font-medium text-zinc-700">Escribe el email para confirmar<input value={confirm} onChange={(event) => setConfirm(event.target.value)} placeholder={result.email} className="mt-1 block h-10 w-72 max-w-full rounded-lg border border-zinc-300 bg-white px-3 font-normal" /></label>
          <label className="min-w-56 flex-1 text-sm font-medium text-zinc-700">Motivo o referencia (opcional)<input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Email del cliente del 12/10/2026" className="mt-1 block h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 font-normal" /></label>
          <button type="button" onClick={() => void remove()} disabled={busy || confirm.trim().toLowerCase() !== result.email} className="h-10 cursor-pointer rounded-lg bg-red-700 px-4 text-sm font-medium text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-40">Borrar definitivamente</button>
        </div>
      </section>}

      {result.history.length > 0 && <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-zinc-900">Historial de peticiones sobre este email</h2>
        <ul className="mt-3 flex flex-col gap-1.5 text-sm text-zinc-600">{result.history.map((item, index) => <li key={index}>{dateFormat.format(new Date(item.created_at))} · <span className="font-medium text-zinc-800">{ACTIONS[item.action] ?? item.action}</span> · {item.requested_by} · {total(item.counts)} registros{item.note ? ` · ${item.note}` : ""}</li>)}</ul>
      </section>}
    </>}
  </main></div>;
}

function describe(section: string, row: Record<string, unknown>) {
  const date = (value: unknown) => (typeof value === "string" ? dateFormat.format(new Date(value)) : "");
  switch (section) {
    case "conversations": return `${date(row.started_at)} · ${String(row.summary ?? "sin resumen")}`;
    case "consents": return `${date(row.created_at)} · ${row.purpose} · ${row.status}${row.newsletter ? " · newsletter" : ""}`;
    case "stock_subscriptions": case "price_alerts": return `${date(row.created_at)} · ${row.product_title} · ${row.status}`;
    case "quotes": return `PRE-${row.id} · ${row.status} · ${date(row.submitted_at)}`;
    case "support_requests": return `${date(row.created_at)} · ${String(row.kind ?? row.type ?? "ticket")} · ${String(row.status ?? "")}`;
    case "customer_emails": return `${date(row.created_at)} · ${row.kind}`;
    default: return date(row.created_at);
  }
}
