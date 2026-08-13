"use client";

import { FormEvent, useState } from "react";

type Result = {
  canWrite: boolean;
  prestashop: {
    id: number;
    firstName: string;
    lastName: string;
    email: string;
    newsletter: boolean;
    createdAt: string;
    orderCount: number;
    totalSpent: number;
  };
  shopify: {
    found: boolean;
    id?: string;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    orderCount?: number;
    createdAt?: string;
  };
};

export default function Home() {
  const [customerId, setCustomerId] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [creationMessage, setCreationMessage] = useState<string | null>(null);
  const [showWriteDecision, setShowWriteDecision] = useState(false);

  async function inspectCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    setCreationMessage(null);
    setShowWriteDecision(false);

    try {
      const response = await fetch(`/api/customer?id=${encodeURIComponent(customerId)}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "No se pudo consultar el cliente.");
      setResult(body);
      setShowWriteDecision(!body.shopify.found && body.canWrite);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Error inesperado.");
    } finally {
      setLoading(false);
    }
  }

  async function createCustomer() {
    if (!result) return;
    setCreating(true);
    setError(null);
    setCreationMessage(null);
    try {
      const response = await fetch("/api/customer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: String(result.prestashop.id) }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "No se pudo crear el cliente.");
      if (!body.verification?.verified) throw new Error("Shopify confirmó la creación, pero la comprobación posterior no coincidió. Revísalo antes de reintentar.");
      setResult({ prestashop: result.prestashop, shopify: body.verification.customer, canWrite: result.canWrite });
      setShowWriteDecision(false);
      setCreationMessage(`Creación verificada en Shopify. Coinciden ID, email y nombre. Direcciones: ${body.addressesCreated}. Metafields: ${body.metafieldsCreated}.${body.warnings?.length ? ` Avisos: ${body.warnings.join(" ")}` : ""}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Error inesperado.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="border-b border-zinc-200 bg-white px-5 py-5 lg:min-h-screen lg:border-r lg:border-b-0">
        <div className="flex items-center justify-between gap-3 lg:block"><div><p className="text-sm font-semibold tracking-[0.18em] text-emerald-700 uppercase">Sincro Vicente</p><p className="mt-1 text-sm text-zinc-500">PrestaShop → Shopify</p></div><form action="/auth/logout" method="post"><button className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 lg:mt-8 lg:w-full">Cerrar sesión</button></form></div>
        <nav className="mt-6 flex gap-2 overflow-x-auto lg:flex-col" aria-label="Módulos de la aplicación"><a href="/" className="shrink-0 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-900">Importar un cliente</a><span className="shrink-0 rounded-lg px-3 py-2 text-sm text-zinc-400">Importaciones masivas <span className="ml-1 text-xs">Próximamente</span></span><span className="shrink-0 rounded-lg px-3 py-2 text-sm text-zinc-400">Ejecuciones <span className="ml-1 text-xs">Próximamente</span></span><span className="shrink-0 rounded-lg px-3 py-2 text-sm text-zinc-400">Configuración <span className="ml-1 text-xs">Próximamente</span></span></nav>
      </aside>
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-10 sm:px-10 lg:mx-0 lg:py-16">
      <header className="space-y-3">
        <p className="text-sm font-semibold tracking-[0.18em] text-emerald-700 uppercase">Clientes</p>
        <h1 className="text-4xl font-semibold tracking-tight text-zinc-950">Importar un cliente</h1>
        <p className="max-w-2xl text-zinc-600">Consulta un cliente de PrestaShop, comprueba su estado en Shopify y decide si deseas grabarlo.</p>
      </header>

      <form onSubmit={inspectCustomer} className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm sm:flex-row">
        <label className="flex flex-1 flex-col gap-1 text-sm font-medium text-zinc-700">
          ID de cliente en PrestaShop
          <input value={customerId} onChange={(event) => setCustomerId(event.target.value)} inputMode="numeric" pattern="[0-9]+" required placeholder="Ej. 391814" className="h-11 rounded-lg border border-zinc-300 px-3 outline-none ring-emerald-600 focus:ring-2" />
        </label>
        <button disabled={loading} className="mt-auto h-11 rounded-lg bg-emerald-700 px-5 font-medium text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60">
          {loading ? "Consultando…" : "Consultar cliente"}
        </button>
      </form>

      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">{error}</p>}
      {creationMessage && <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">{creationMessage}</p>}

      {result && <section className="grid gap-5 md:grid-cols-2">
        <CustomerCard title="PrestaShop" entries={[
          ["ID", String(result.prestashop.id)], ["Nombre", `${result.prestashop.firstName} ${result.prestashop.lastName}`], ["Email", result.prestashop.email], ["Pedidos válidos", String(result.prestashop.orderCount)], ["Importe histórico", `${result.prestashop.totalSpent.toFixed(2)} €`], ["Newsletter", result.prestashop.newsletter ? "Sí" : "No"],
        ]} />
        <CustomerCard title="Shopify (Admin GraphQL 2026-07)" entries={result.shopify.found ? [
          ["Estado", "Cliente encontrado"], ["ID", result.shopify.id!], ["Nombre", `${result.shopify.firstName ?? ""} ${result.shopify.lastName ?? ""}`.trim()], ["Email", result.shopify.email ?? "—"], ["Pedidos", String(result.shopify.orderCount ?? 0)],
        ] : [["Estado", "No existe un cliente con ese email"]]} />
      </section>}

      {result && !result.shopify.found && !result.canWrite && <section className="rounded-2xl border border-zinc-200 bg-zinc-50 p-5 shadow-sm"><h2 className="text-lg font-semibold text-zinc-900">Consulta en modo solo lectura</h2><p className="mt-1 text-sm text-zinc-700">Este cliente no está incluido en la prueba de escritura actual. No se realizará ningún cambio en Shopify.</p></section>}

      {result && !result.shopify.found && showWriteDecision && <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-amber-950">¿Quieres grabar este cliente en Shopify?</h2>
        <p className="mt-1 text-sm text-amber-900">Aplicará las reglas del importador Python. Solo usuarios con sesión pueden ejecutar esta prueba; además permite únicamente el ID autorizado y comprueba Shopify de nuevo antes de escribir.</p>
        <div className="mt-4 flex gap-3"><button type="button" disabled={creating} onClick={() => setShowWriteDecision(false)} className="h-11 rounded-lg border border-amber-300 bg-white px-5 font-medium text-amber-950 hover:bg-amber-100">Ahora no</button><button type="button" disabled={creating} onClick={createCustomer} className="h-11 rounded-lg bg-amber-700 px-5 font-medium text-white transition hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-60">{creating ? "Grabando…" : "Sí, grabar en Shopify"}</button></div>
      </section>}
    </main></div>
  );
}

function CustomerCard({ title, entries }: { title: string; entries: string[][] }) {
  return <article className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm"><h2 className="mb-4 text-lg font-semibold text-zinc-950">{title}</h2><dl className="space-y-3">{entries.map(([label, value]) => <div key={label} className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-3 border-b border-zinc-100 pb-3 last:border-0 last:pb-0"><dt className="text-sm text-zinc-500">{label}</dt><dd className="break-words text-sm font-medium text-zinc-800">{value}</dd></div>)}</dl></article>;
}
