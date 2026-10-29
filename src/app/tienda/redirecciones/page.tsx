"use client";

import { useCallback, useEffect, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { createClient } from "@/lib/supabase/client";

// Base de redirecciones de la web vieja a la tienda nueva (docs/REDIRECCIONES.md): cada URL vieja, de dónde sale, a qué
// apunta (su clave) y sus clics en Search Console. El destino final se calcula más adelante, con el árbol nuevo.
type Redirect = { origin: string; sources: string[]; current_target: string | null; key_type: string; key_value: string | null; clicks_16m: number; impressions_16m: number; target: string | null; status: string; note: string | null; updated_at: string };
const TYPES: Record<string, string> = { producto: "Producto", producto_viejo: "Producto viejo", coleccion: "Colección", categoria_vieja: "Categoría vieja", marca: "Marca", pagina: "Página", blog: "Blog", otro: "Otro" };
const SOURCES: Record<string, string> = { shopify: "Shopify", inventario: "Inventario", search_console: "Search Console" };
const STATUS: Record<string, string> = { propuesta: "Propuesta", revisada: "Revisada", cargada: "Cargada", descartada: "Descartada" };
const integer = new Intl.NumberFormat("es-ES", { useGrouping: "always", maximumFractionDigits: 0 });

export default function RedirectsPage() {
  const [email, setEmail] = useState<string | null>(null); const [rows, setRows] = useState<Redirect[]>([]); const [total, setTotal] = useState(0); const [byType, setByType] = useState<Record<string, number>>({}); const [noRedirect, setNoRedirect] = useState(0);
  const [search, setSearch] = useState(""); const [type, setType] = useState(""); const [source, setSource] = useState(""); const [page, setPage] = useState(0); const [pageSize, setPageSize] = useState(50);
  const [error, setError] = useState<string | null>(null); const [loading, setLoading] = useState(false); const [notice, setNotice] = useState<string | null>(null);
  const load = useCallback(async () => {
    const params = new URLSearchParams({ q: search, tipo: type, fuente: source, pagina: String(page) });
    const response = await fetch(`/api/redirecciones?${params}`, { cache: "no-store" }); const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "No se pudieron leer las redirecciones.");
    setRows(body.rows ?? []); setTotal(body.total ?? 0); setByType(body.byType ?? {}); setNoRedirect(body.noRedirect ?? 0); setPageSize(body.pageSize ?? 50);
  }, [search, type, source, page]);
  useEffect(() => { void load().catch((caught: Error) => setError(caught.message)); }, [load]);
  useEffect(() => { createClient().auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null)); }, []);
  async function reload() {
    setLoading(true); setError(null); setNotice(null);
    try {
      const response = await fetch("/api/redirecciones", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cargar" }) }); const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "No se pudieron cargar las redirecciones.");
      setNotice(`Cargadas ${integer.format(body.total)} URLs viejas: ${integer.format(body.shopify)} de Shopify, ${integer.format(body.inventario)} del inventario y ${integer.format(body.searchConsole)} de Search Console.`);
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudieron cargar las redirecciones."); } finally { setLoading(false); }
  }
  const all = Object.values(byType).reduce((sum, n) => sum + n, 0);
  const select = "mt-1 block h-10 rounded-lg border border-zinc-300 bg-white px-2 text-sm";
  return <div className="min-h-screen bg-zinc-50 lg:grid lg:grid-cols-[17.5rem_minmax(0,1fr)]"><AppSidebar active="redirects" userEmail={email} /><main className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-6 px-4 pb-24 pt-28 sm:px-10 lg:mx-0 lg:py-16">
    <header className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-4xl font-semibold tracking-tight">Redirecciones</h1><p className="mt-3 max-w-3xl text-zinc-600">Cada URL de la web vieja, de dónde sale y a qué apunta. El destino final se calcula cuando estén cerrados el árbol nuevo de colecciones y las direcciones de los productos, para que nunca haya cadenas.</p></div><button type="button" onClick={() => void reload()} disabled={loading} className="h-10 rounded-lg bg-emerald-700 px-4 text-sm font-medium text-white disabled:opacity-50">{loading ? "Cargando…" : "Volver a cargar las fuentes"}</button></header>
    {error && <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">{error}</p>}
    {notice && <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">{notice}</p>}
    <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
      <Stat label="URLs viejas" value={all} />
      <Stat label="Sin redirección hoy" value={noRedirect} hint="Solo en Search Console" />
      {Object.entries(TYPES).map(([key, label]) => (byType[key] ? <Stat key={key} label={label} value={byType[key]} /> : null))}
    </section>
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-sm font-medium text-zinc-700">Buscar<input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} className="mt-1 block h-10 w-72 max-w-full rounded-lg border border-zinc-300 px-3" placeholder="URL vieja o destino" /></label>
      <label className="text-sm font-medium text-zinc-700">A qué apunta<select value={type} onChange={(event) => { setType(event.target.value); setPage(0); }} className={select}><option value="">Todo</option>{Object.entries(TYPES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label className="text-sm font-medium text-zinc-700">Fuente<select value={source} onChange={(event) => { setSource(event.target.value); setPage(0); }} className={select}><option value="">Todas</option>{Object.entries(SOURCES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}<option value="sin_redireccion">Sin redirección hoy</option></select></label>
      <p className="ml-auto text-sm text-zinc-500">{integer.format(total)} filas · por clics</p>
    </div>
    <div className="overflow-auto rounded-2xl border border-zinc-200 bg-white shadow-sm"><table className="min-w-full text-sm"><thead className="bg-zinc-50 text-left text-zinc-600"><tr>
      <th className="px-4 py-3 font-medium">URL vieja</th><th className="px-4 py-3 font-medium">Apunta a</th><th className="px-4 py-3 font-medium">Destino hoy</th><th className="px-4 py-3 font-medium">Destino final</th><th className="px-4 py-3 text-right font-medium">Clics 16 m</th><th className="px-4 py-3 font-medium">Fuentes</th><th className="px-4 py-3 font-medium">Estado</th>
    </tr></thead><tbody className="divide-y divide-zinc-100">{rows.map((row) => <tr key={row.origin} className="align-top">
      <td className="max-w-[22rem] break-all px-4 py-3 text-zinc-900">{row.origin}{row.note && <span className="mt-1 block text-xs text-zinc-500">{row.note}</span>}</td>
      <td className="whitespace-nowrap px-4 py-3 text-zinc-700">{TYPES[row.key_type] ?? row.key_type}<span className="block max-w-[14rem] truncate text-xs text-zinc-500" title={row.key_value ?? ""}>{row.key_value ?? "—"}</span></td>
      <td className="max-w-[16rem] break-all px-4 py-3 text-zinc-700">{row.current_target ?? "—"}</td>
      <td className="max-w-[16rem] break-all px-4 py-3 text-zinc-700">{row.target ?? <span className="text-zinc-400">Por calcular</span>}</td>
      <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-zinc-800">{integer.format(row.clicks_16m)}</td>
      <td className="whitespace-nowrap px-4 py-3 text-xs text-zinc-600">{row.sources.map((item) => SOURCES[item] ?? item).join(" · ")}</td>
      <td className="whitespace-nowrap px-4 py-3 text-zinc-700">{STATUS[row.status] ?? row.status}</td>
    </tr>)}{!rows.length && <tr><td colSpan={7} className="px-4 py-8 text-zinc-500">No hay redirecciones con este filtro. Si la tabla está vacía, pulsa «Volver a cargar las fuentes».</td></tr>}</tbody></table></div>
    <div className="flex items-center justify-between"><button disabled={!page} onClick={() => setPage((current) => current - 1)} className="rounded-lg border border-zinc-300 px-4 py-2 text-sm disabled:opacity-50">Anterior</button><span className="text-sm text-zinc-500">Página {page + 1} de {Math.max(1, Math.ceil(total / pageSize))}</span><button disabled={(page + 1) * pageSize >= total} onClick={() => setPage((current) => current + 1)} className="rounded-lg border border-zinc-300 px-4 py-2 text-sm disabled:opacity-50">Siguiente</button></div>
  </main></div>;
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm"><p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900">{integer.format(value)}</p>{hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}</div>;
}
