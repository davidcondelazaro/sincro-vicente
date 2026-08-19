"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { createClient } from "@/lib/supabase/client";

type Entity = "products" | "categories" | "brands" | "prices" | "stock";
type Row = Record<string, string | number | boolean | null>;
const labels: Record<Entity, string> = { products: "Productos", categories: "Categorías", brands: "Marcas", prices: "Precios", stock: "Stock" };
const headers: Record<string, string> = { codigo: "Código", codigo_ean: "EAN", titulo: "Producto", descripcion_ampliada: "Descripción ampliada", nombre_marca: "Marca", nombre_familia: "Familia", pvp: "PVP", pvp_antes: "PVP anterior", iva: "IVA", stock: "Stock", presence_status: "Estado", fecha_modificacion_producto: "Modificado producto", fecha_modificacion_precio: "Modificado precio", fecha_modificacion_stock: "Modificado stock", cd_familia: "Código de línea", cod_familia: "Código de familia", cd_marca: "Código de marca", cod_linea: "Código de línea", cod_subfamilia: "Código de subfamilia", nombre: "Nombre", nivel: "Nivel", activo: "Activo", visible: "Visible", validada: "Validada", breadcrumb: "Ruta" };
const numericKeys = new Set(["pvp", "pvp_antes", "iva", "stock", "nivel"]);
const money = new Intl.NumberFormat("es-ES", { useGrouping: true, minimumFractionDigits: 2, maximumFractionDigits: 2 });
const integer = new Intl.NumberFormat("es-ES", { useGrouping: true, maximumFractionDigits: 0 });

export default function MhdCatalogPage() {
  const [entity, setEntity] = useState<Entity>("products"); const [rows, setRows] = useState<Row[]>([]); const [total, setTotal] = useState(0); const [page, setPage] = useState(0); const [search, setSearch] = useState(""); const [email, setEmail] = useState<string | null>(null); const [error, setError] = useState<string | null>(null); const [selectedProduct, setSelectedProduct] = useState<Record<string, unknown> | null>(null); const [loadingProduct, setLoadingProduct] = useState(false);
  const load = useCallback(async () => { const params = new URLSearchParams({ entity, page: String(page), search }); const response = await fetch(`/api/mhd-catalog?${params}`, { cache: "no-store" }); const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "No se pudo leer el catálogo MHD."); setRows(body.rows ?? []); setTotal(body.total ?? 0); }, [entity, page, search]);
  useEffect(() => { void load().catch((caught) => setError(caught.message)); }, [load]);
  useEffect(() => { createClient().auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null)); }, []);
  function select(next: Entity) { setEntity(next); setPage(0); setSearch(""); }
  async function openProduct(codigo: string) { if (String(selectedProduct?.codigo ?? "") === codigo) { setSelectedProduct(null); return; } setLoadingProduct(true); setError(null); try { const response = await fetch(`/api/mhd-catalog?codigo=${encodeURIComponent(codigo)}`, { cache: "no-store" }); const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "No se pudo leer el producto MHD."); setSelectedProduct(body.product ?? {}); } catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo leer el producto MHD."); } finally { setLoadingProduct(false); } }
  const keys = rows[0] ? Object.keys(rows[0]).filter((key) => key !== "loaded_at") : [];
  return <div className="min-h-screen bg-zinc-50 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]"><AppSidebar active="mhdCatalog" userEmail={email} /><main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 pb-24 pt-28 sm:px-10 lg:mx-0 lg:py-16">
    <header><h1 className="text-4xl font-semibold tracking-tight">Importación de catálogo MHD</h1><p className="mt-3 text-zinc-600">Visor de la última fotografía válida importada desde MHD.</p></header>
    {error && <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">{error}</p>}
    <div className="flex flex-wrap gap-2">{(Object.keys(labels) as Entity[]).map((item) => <button key={item} onClick={() => select(item)} className={`rounded-lg px-4 py-2 text-sm font-medium ${entity === item ? "bg-emerald-700 text-white" : "border border-zinc-300 bg-white text-zinc-700"}`}>{labels[item]}</button>)}</div>
    <div className="flex flex-wrap items-end justify-between gap-3"><label className="text-sm font-medium text-zinc-700">Buscar<input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} className="mt-1 block h-10 w-72 rounded-lg border border-zinc-300 px-3" placeholder={entity === "products" ? "Código, EAN o nombre" : entity === "prices" || entity === "stock" ? "Código o EAN" : "Nombre o código"} /></label><p className="text-sm text-zinc-500">{total.toLocaleString("es-ES")} registros</p></div>
    <div className="overflow-auto rounded-2xl border border-zinc-200 bg-white shadow-sm"><table className="min-w-full text-sm"><thead className="bg-zinc-50 text-left text-zinc-600"><tr>{keys.map((key) => <th key={key} className={`whitespace-nowrap px-4 py-3 font-medium ${numericKeys.has(key) ? "text-right" : ""}`}>{headers[key] ?? key.replaceAll("_", " ")}</th>)}{entity === "products" && <th aria-label="Ver ficha" className="w-20 px-3 py-3" />}</tr></thead><tbody className="divide-y divide-zinc-100">{rows.map((row, index) => { const codigo = String(row.codigo ?? ""); const expanded = codigo === String(selectedProduct?.codigo ?? ""); return <Fragment key={String(row.codigo ?? row.cd_familia ?? row.cd_marca ?? index)}><tr onClick={entity === "products" ? () => void openProduct(codigo) : undefined} className={entity === "products" ? "cursor-pointer hover:bg-emerald-50" : undefined}>{keys.map((key) => <td key={key} title={key === "titulo" ? String(row[key] ?? "") : undefined} className={`px-4 py-3 align-middle text-zinc-800 whitespace-nowrap ${key === "titulo" ? "max-w-[24rem] overflow-hidden text-ellipsis" : ""} ${numericKeys.has(key) ? "text-right tabular-nums" : ""}`}>{formatValue(key, row[key])}</td>)}{entity === "products" && <td className="whitespace-nowrap px-3 py-3 text-right"><button type="button" onClick={(event) => { event.stopPropagation(); void openProduct(codigo); }} aria-expanded={expanded} className="text-sm font-medium text-emerald-700 hover:underline">{expanded ? "▼" : "▶ Ver"}</button></td>}</tr>{expanded && selectedProduct && <tr className="bg-emerald-50/40"><td colSpan={keys.length + 1} className="p-0"><ProductDetail product={selectedProduct} /></td></tr>}</Fragment>; })}{!rows.length && <tr><td colSpan={Math.max(1, keys.length)} className="px-4 py-8 text-zinc-500">No hay datos todavía. Ejecuta primero una importación MHD completa.</td></tr>}</tbody></table></div>
    {loadingProduct && <p className="text-sm text-zinc-500">Cargando ficha del producto…</p>}
    <div className="flex items-center justify-between"><button disabled={!page} onClick={() => setPage((current) => current - 1)} className="rounded-lg border border-zinc-300 px-4 py-2 text-sm disabled:opacity-50">Anterior</button><span className="text-sm text-zinc-500">Página {page + 1}</span><button disabled={(page + 1) * 50 >= total} onClick={() => setPage((current) => current + 1)} className="rounded-lg border border-zinc-300 px-4 py-2 text-sm disabled:opacity-50">Siguiente</button></div>
  </main></div>;
}

function ProductDetail({ product }: { product: Record<string, unknown> }) { return <section className="border-y border-emerald-200 bg-emerald-50/40 p-5"><div><h2 className="text-xl font-semibold text-zinc-950">Ficha completa de MHD</h2><p className="mt-1 text-sm text-zinc-600">{String(product.titulo ?? product.codigo ?? "Producto")}</p></div><dl className="mt-5 grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">{Object.entries(product).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => <div key={key} className="border-t border-emerald-100 pt-2"><dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">{headers[key] ?? key.replaceAll("_", " ")}</dt><dd className="mt-1 break-words text-sm text-zinc-900">{formatPayloadValue(key, value)}</dd></div>)}</dl></section>; }

function formatValue(key: string, value: Row[string]) {
  if (value === null) return "—";
  if (key.startsWith("fecha_modificacion")) { const date = new Date(Number(value)); return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "short" }).format(date); }
  if (key === "pvp" || key === "pvp_antes") return money.format(Number(value));
  if (key === "iva") return `${integer.format(Number(value))}%`;
  if (key === "stock") return integer.format(Number(value));
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (key === "presence_status") return value === "present" ? "Presente" : "Ausente en MHD";
  return String(value);
}
function formatPayloadValue(key: string, value: unknown) { if (value === null || value === undefined || value === "") return "—"; if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return formatValue(key, value); return JSON.stringify(value); }
