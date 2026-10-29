"use client";

import { useCallback, useEffect, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { createClient } from "@/lib/supabase/client";

// Productos bloqueados (2026-10-29): fichas arregladas a mano en Shopify que el importador no vuelve a procesar ni a
// subir. Precio y stock sí se siguen sincronizando.
type Lock = { codigo: string; reason: string; locked_by: string | null; locked_at: string; product: { product_id: string; title: string; status: string } | null };
const when = (iso: string) => new Date(iso).toLocaleString("es-ES", { timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "short" });

export default function ProductLocksPage() {
  const [email, setEmail] = useState<string | null>(null);
  const [locks, setLocks] = useState<Lock[] | null>(null);
  const [codigo, setCodigo] = useState(""); const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/productos-bloqueados", { cache: "no-store" });
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "No se pudo leer la lista.");
      setLocks(body.locks);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Error inesperado."); }
  }, []);
  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    createClient().auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    return () => window.clearTimeout(first);
  }, [load]);

  async function send(method: "POST" | "DELETE", payload: Record<string, string>) {
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/productos-bloqueados", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "No se pudo guardar.");
      if (method === "POST") { setCodigo(""); setReason(""); }
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Error inesperado."); } finally { setBusy(false); }
  }

  return <div className="min-h-screen bg-zinc-50 lg:grid lg:grid-cols-[17.5rem_minmax(0,1fr)]"><AppSidebar active="productLocks" userEmail={email} />
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 pb-24 pt-28 sm:px-10 lg:mx-0 lg:py-16">
      <header><h1 className="text-4xl font-semibold tracking-tight text-zinc-950">Productos bloqueados</h1><p className="mt-3 max-w-3xl text-zinc-600">Productos con la ficha arreglada a mano en Shopify. El importador no los vuelve a procesar ni a subir (ni las tandas, ni «Un producto», ni las altas y cambios automáticos), para no pisar el arreglo. El precio y el stock sí se siguen sincronizando con MHD.</p></header>
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">{error}</p>}
      <form className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm sm:flex-row sm:items-end" onSubmit={(event) => { event.preventDefault(); void send("POST", { codigo, reason }); }}>
        <label className="text-sm font-medium text-zinc-700">Código de MHD o EAN<input value={codigo} onChange={(event) => setCodigo(event.target.value)} className="mt-1 block h-10 w-full rounded-lg border border-zinc-300 px-3 sm:w-48" /></label>
        <label className="flex-1 text-sm font-medium text-zinc-700">Motivo<input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Qué se arregló a mano y hasta cuándo" className="mt-1 block h-10 w-full rounded-lg border border-zinc-300 px-3" /></label>
        <button type="submit" disabled={busy || !codigo.trim() || !reason.trim()} className="h-10 rounded-lg bg-emerald-700 px-4 text-sm font-medium text-white disabled:opacity-50">Bloquear</button>
      </form>
      <section className="rounded-2xl border border-zinc-200 bg-white shadow-sm">
        {!locks ? <p className="p-5 text-sm text-zinc-500">Cargando…</p> : !locks.length ? <p className="p-5 text-sm text-zinc-600">No hay ningún producto bloqueado.</p> : <ul className="divide-y divide-zinc-100">{locks.map((lock) => {
          const id = lock.product?.product_id.split("/").pop();
          return <li key={lock.codigo} className="flex flex-col gap-2 p-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="font-semibold text-zinc-900">{lock.product?.title ?? "Producto no encontrado en la tienda"} <span className="font-normal text-zinc-500">· {lock.codigo}</span></p>
              <p className="mt-1 text-sm text-zinc-700">{lock.reason}</p>
              <p className="mt-1 text-xs text-zinc-500">Bloqueado por {lock.locked_by ?? "—"} el {when(lock.locked_at)}{id ? <> · <a href={`https://admin.shopify.com/store/electronica-vicente/products/${id}`} target="_blank" rel="noreferrer" className="font-medium text-emerald-700 hover:underline">Ver en Shopify ↗</a></> : null}</p>
            </div>
            <button type="button" disabled={busy} onClick={() => { if (window.confirm(`¿Desbloquear ${lock.codigo}? El importador podrá volver a procesarlo y subirlo.`)) void send("DELETE", { codigo: lock.codigo }); }} className="h-9 shrink-0 rounded-lg border border-zinc-300 px-3 text-sm font-medium text-zinc-700 disabled:opacity-50">Desbloquear</button>
          </li>;
        })}</ul>}
      </section>
    </main></div>;
}
