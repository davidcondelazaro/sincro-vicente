"use client";

import { FormEvent, useState } from "react";

type Result = {
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

  async function inspectCustomer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch(`/api/customer?id=${encodeURIComponent(customerId)}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "No se pudo consultar el cliente.");
      setResult(body);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Error inesperado.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-8 px-6 py-16 sm:px-10">
      <header className="space-y-3">
        <p className="text-sm font-semibold tracking-[0.18em] text-emerald-700 uppercase">POC de migración</p>
        <h1 className="text-4xl font-semibold tracking-tight text-zinc-950">PrestaShop → Shopify</h1>
        <p className="max-w-2xl text-zinc-600">Consulta segura y de sólo lectura de un cliente de PrestaShop y su coincidencia en Shopify.</p>
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

      {result && <section className="grid gap-5 md:grid-cols-2">
        <CustomerCard title="PrestaShop" entries={[
          ["ID", String(result.prestashop.id)], ["Nombre", `${result.prestashop.firstName} ${result.prestashop.lastName}`], ["Email", result.prestashop.email], ["Pedidos válidos", String(result.prestashop.orderCount)], ["Importe histórico", `${result.prestashop.totalSpent.toFixed(2)} €`], ["Newsletter", result.prestashop.newsletter ? "Sí" : "No"],
        ]} />
        <CustomerCard title="Shopify (Admin GraphQL 2026-07)" entries={result.shopify.found ? [
          ["Estado", "Cliente encontrado"], ["ID", result.shopify.id!], ["Nombre", `${result.shopify.firstName ?? ""} ${result.shopify.lastName ?? ""}`.trim()], ["Email", result.shopify.email ?? "—"], ["Pedidos", String(result.shopify.orderCount ?? 0)],
        ] : [["Estado", "No existe un cliente con ese email"]]} />
      </section>}
    </main>
  );
}

function CustomerCard({ title, entries }: { title: string; entries: string[][] }) {
  return <article className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm"><h2 className="mb-4 text-lg font-semibold text-zinc-950">{title}</h2><dl className="space-y-3">{entries.map(([label, value]) => <div key={label} className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-3 border-b border-zinc-100 pb-3 last:border-0 last:pb-0"><dt className="text-sm text-zinc-500">{label}</dt><dd className="break-words text-sm font-medium text-zinc-800">{value}</dd></div>)}</dl></article>;
}
