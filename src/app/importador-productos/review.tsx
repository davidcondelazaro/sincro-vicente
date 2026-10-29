"use client";

import { Fragment, useEffect, useState } from "react";

// Cola de revisión a mano del importador (docs/IMPORTADOR_PRODUCTOS_MHD.md): los productos cuya última prueba trae
// motivos de revisión (clase energética distinta, cifras de MHD e Icecat que no cuadran, precio raro, modelo o marca
// dudosos y las reglas «review» del perfil). Cada uno se marca «Está bien», «No importar» o «Avisar a MHD»; si una prueba
// nueva trae otros motivos, vuelve a la cola.

type Decision = "resuelto" | "no_importar" | "avisar_mhd";
type QueueItem = { codigo: string; shopify_product_id: string | null; family_code: string | null; family_name: string | null; run_id: string; run_at: string; title: string | null; ean: string | null; reasons: string[]; decision: Decision | null; note: string | null; reviewer: string | null; decided_at: string | null; pending: boolean };
type ReasonKind = "energia" | "cifras" | "precio" | "modelo" | "marca" | "foto" | "perfil";

const KINDS: Record<ReasonKind, string> = { energia: "Clase energética", cifras: "MHD e Icecat no cuadran", precio: "Precio", modelo: "Modelo", marca: "Marca", foto: "Foto pequeña", perfil: "Regla de la familia" };
const DECISIONS: Record<Decision, { label: string; badge: string }> = {
  resuelto: { label: "Está bien", badge: "bg-emerald-100 text-emerald-800" },
  no_importar: { label: "No importar", badge: "bg-red-100 text-red-800" },
  avisar_mhd: { label: "Avisar a MHD", badge: "bg-sky-100 text-sky-800" },
};
// El tipo sale del texto del motivo, que escribe el procesador (review.ts, facts.ts, processor.ts y las reglas del perfil).
function reasonKind(reason: string): ReasonKind {
  if (reason.startsWith("Clase energética distinta")) return "energia";
  if (/MHD dice «.*» e Icecat «.*» \(\d+ % de diferencia\)/.test(reason)) return "cifras";
  if (/^(Precio raro|Sin precio)/.test(reason)) return "precio";
  if (reason.startsWith("Modelo:")) return "modelo";
  if (reason.startsWith("Marca:")) return "marca";
  if (reason.startsWith("Foto pequeña:")) return "foto";
  return "perfil";
}
const integer = new Intl.NumberFormat("es-ES", { useGrouping: "always", maximumFractionDigits: 0 });
const dateTime = (value: string) => new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "short" }).format(new Date(value));
const csvCell = (value: string | null) => `"${(value ?? "").replaceAll("\"", "\"\"")}"`;

export function ReviewView() {
  const [items, setItems] = useState<QueueItem[]>([]); const [error, setError] = useState<string | null>(null); const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<"pendientes" | "decididos" | "todos">("pendientes"); const [kind, setKind] = useState<ReasonKind | "">(""); const [family, setFamily] = useState(""); const [search, setSearch] = useState("");
  useEffect(() => {
    fetch("/api/importador-productos/revision", { cache: "no-store" }).then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "No se pudo leer la cola."); setItems(body.items); setError(null); })
      .catch((caught: Error) => setError(caught.message)).finally(() => setLoading(false));
  }, [version]);

  const term = search.trim().toLowerCase();
  const families = [...new Map(items.map((item) => [item.family_code ?? "", item.family_name ?? item.family_code ?? "Sin familia"])).entries()].sort((a, b) => a[1].localeCompare(b[1], "es"));
  const shown = items.filter((item) => (state === "todos" || (state === "pendientes") === item.pending)
    && (!kind || item.reasons.some((reason) => reasonKind(reason) === kind)) && (!family || item.family_code === family)
    && (!term || [item.codigo, item.ean, item.title].some((text) => text?.toLowerCase().includes(term))));
  const pending = items.filter((item) => item.pending);
  const decided = (decision: Decision) => items.filter((item) => !item.pending && item.decision === decision).length;
  const byKind = (Object.keys(KINDS) as ReasonKind[]).map((key) => [key, pending.filter((item) => item.reasons.some((reason) => reasonKind(reason) === key)).length] as const);

  // Lista para el informe al proveedor: los productos marcados «Avisar a MHD», con la nota y los motivos.
  function downloadNotices() {
    const rows = items.filter((item) => !item.pending && item.decision === "avisar_mhd");
    const csv = ["codigo,ean,familia,producto,nota,motivos", ...rows.map((item) => [item.codigo, item.ean, item.family_name ?? item.family_code, item.title, item.note, item.reasons.join(" | ")].map(csvCell).join(","))].join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
    link.download = `avisos-mhd-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click(); URL.revokeObjectURL(link.href);
  }

  return <section className="flex flex-col gap-5">
    <p className="text-sm text-zinc-600">Productos que el importador monta igual pero que alguien tiene que mirar: clase energética distinta en MHD e Icecat, cifras que no cuadran, precio raro, modelo o marca dudosos, fotos pequeñas y los casos que marca la regla de cada familia (productos mal clasificados, fichas cruzadas…). Si una prueba nueva trae otros motivos, el producto vuelve a la cola.</p>
    {error && <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{([["Pendientes", pending.length, "text-zinc-900"], ["Están bien", decided("resuelto"), "text-emerald-700"], ["No importar", decided("no_importar"), "text-red-700"], ["Avisar a MHD", decided("avisar_mhd"), "text-sky-700"]] as const).map(([label, value, color]) => <div key={label} className="rounded-xl border border-zinc-200 bg-white p-3 shadow-sm"><p className="text-xs text-zinc-500">{label}</p><p className={`mt-1 text-2xl font-semibold tabular-nums ${color}`}>{integer.format(value)}</p></div>)}</div>
    {pending.length > 0 && <div className="flex flex-wrap gap-2 text-xs">{byKind.filter(([, count]) => count).map(([key, count]) => <button key={key} type="button" onClick={() => { setKind(kind === key ? "" : key); setState("pendientes"); }} className={`rounded-full border px-3 py-1 ${kind === key ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-700"}`}>{KINDS[key]} · {integer.format(count)}</button>)}</div>}
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-sm font-medium text-zinc-700">Ver<select value={state} onChange={(event) => setState(event.target.value as typeof state)} className="mt-1 block h-10 rounded-lg border border-zinc-300 bg-white px-2 text-sm"><option value="pendientes">pendientes</option><option value="decididos">ya decididos</option><option value="todos">todos</option></select></label>
      <label className="text-sm font-medium text-zinc-700">Familia<select value={family} onChange={(event) => setFamily(event.target.value)} className="mt-1 block h-10 max-w-60 rounded-lg border border-zinc-300 bg-white px-2 text-sm"><option value="">todas</option>{families.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label>
      <label className="min-w-48 flex-1 text-sm font-medium text-zinc-700">Buscar<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Código, EAN o nombre" className="mt-1 block h-10 w-full rounded-lg border border-zinc-300 px-3 text-sm" /></label>
      <button type="button" onClick={downloadNotices} disabled={!decided("avisar_mhd")} className="h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-700 disabled:opacity-40">Descargar avisos a MHD</button>
    </div>
    {loading ? <p className="text-sm text-zinc-500">Cargando…</p> : !shown.length ? <p className="rounded-xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500">{items.length ? "Nada coincide con los filtros." : "No hay productos en la cola: ninguna prueba ha traído motivos de revisión."}</p>
      : <div className="flex flex-col gap-3">{shown.map((item) => <ReviewCard key={item.codigo} item={item} onSaved={() => setVersion((current) => current + 1)} />)}</div>}
  </section>;
}

function ReviewCard({ item, onSaved }: { item: QueueItem; onSaved: () => void }) {
  const [note, setNote] = useState(item.note ?? ""); const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null);
  async function decide(decision: Decision | "reabrir") {
    setSaving(true); setError(null);
    try {
      const response = await fetch("/api/importador-productos/revision", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ codigo: item.codigo, decision, note }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "No se pudo guardar.");
      onSaved();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo guardar."); } finally { setSaving(false); }
  }
  const decision = !item.pending && item.decision ? DECISIONS[item.decision] : null;
  return <article className={`rounded-2xl border bg-white p-4 shadow-sm ${decision ? "border-zinc-200 opacity-80" : "border-amber-200"}`}>
    <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="text-xs font-medium text-zinc-500">{item.family_name ?? item.family_code} · {item.codigo}{item.ean ? ` · EAN ${item.ean}` : ""}</span>
      {decision && <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${decision.badge}`}>{decision.label}</span>}
      {item.decision && item.pending && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Motivos nuevos</span>}
      <span className="ml-auto text-xs text-zinc-400">Prueba del {dateTime(item.run_at)}</span>
    </header>
    <p className="mt-1 text-base font-semibold text-zinc-900">{item.title ?? "Sin título"}</p>
    <ProductLinks item={item} />
    <ul className="mt-2 flex flex-col gap-1.5 text-sm">{item.reasons.map((reason) => <li key={reason} className="flex flex-wrap items-baseline gap-2"><span className="shrink-0 rounded-md bg-zinc-100 px-1.5 py-0.5 text-xs font-medium text-zinc-600">{KINDS[reasonKind(reason)]}</span><span className="min-w-0 flex-1 text-zinc-800">{reason}</span></li>)}</ul>
    {decision && item.decided_at && <p className="mt-2 text-xs text-zinc-500">{decision.label} · {item.reviewer ?? "—"} · {dateTime(item.decided_at)}{item.note ? ` · ${item.note}` : ""}</p>}
    <div className="mt-3 flex flex-wrap items-start gap-2 border-t border-zinc-100 pt-3">
      {decision ? <button type="button" disabled={saving} onClick={() => decide("reabrir")} className="h-9 rounded-lg border border-zinc-300 px-3 text-sm font-medium text-zinc-700 disabled:opacity-50">Reabrir</button> : <>
        <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} placeholder="Nota (obligatoria para «No importar» y «Avisar a MHD»)" className="min-w-0 flex-1 basis-64 rounded-lg border border-zinc-300 p-2 text-sm" />
        <div className="flex flex-wrap gap-2">{(Object.keys(DECISIONS) as Decision[]).map((key) => <button key={key} type="button" disabled={saving} onClick={() => decide(key)} className={`h-9 rounded-lg px-3 text-sm font-medium text-white disabled:opacity-50 ${key === "resuelto" ? "bg-emerald-600" : key === "no_importar" ? "bg-red-600" : "bg-sky-600"}`}>{DECISIONS[key].label}</button>)}</div>
      </>}
      {error && <p className="w-full text-xs text-red-700">{error}</p>}
    </div>
  </article>;
}

// Enlaces para comprobar la discrepancia sin buscar el producto (2026-10-29): el borrador en Shopify y los datos de MHD
// desplegados aquí mismo (mismos datos que «Catálogo MHD»).
const MHD_FIELDS: [string, string][] = [["titulo", "Título"], ["nombre_marca", "Marca"], ["ref_proved", "Referencia"], ["nombre_familia", "Familia"], ["nombre_subfamilia", "Subfamilia"], ["pvp", "PVP"], ["stock", "Stock"], ["descripcion_ampliada", "Descripción ampliada"]];
function ProductLinks({ item }: { item: QueueItem }) {
  const [mhd, setMhd] = useState<Record<string, unknown> | null>(null); const [open, setOpen] = useState(false); const [error, setError] = useState<string | null>(null);
  async function toggle() {
    setOpen(!open);
    if (mhd || open) return;
    try {
      const response = await fetch(`/api/mhd-catalog?codigo=${encodeURIComponent(item.codigo)}`, { cache: "no-store" });
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "No se pudieron leer los datos de MHD.");
      setMhd(body.product ?? {});
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Error inesperado."); }
  }
  const shopifyId = item.shopify_product_id?.split("/").pop();
  return <div className="mt-1">
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {shopifyId && <a href={`https://admin.shopify.com/store/electronica-vicente/products/${shopifyId}`} target="_blank" rel="noreferrer" className="font-medium text-emerald-700 hover:underline">Ver en Shopify ↗</a>}
      <button type="button" onClick={() => void toggle()} className="font-medium text-emerald-700 hover:underline">{open ? "Ocultar datos de MHD" : "Datos de MHD"}</button>
    </div>
    {open && <div className="mt-2 rounded-lg bg-zinc-50 p-3 text-sm">{error ? <p className="text-red-700">{error}</p> : !mhd ? <p className="text-zinc-500">Cargando…</p> : <dl className="grid gap-x-4 gap-y-1.5 sm:grid-cols-[10rem_minmax(0,1fr)]">{MHD_FIELDS.filter(([key]) => mhd[key] !== undefined && mhd[key] !== null && mhd[key] !== "").map(([key, label]) => <Fragment key={key}><dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</dt><dd className="break-words text-zinc-800">{String(mhd[key])}</dd></Fragment>)}</dl>}</div>}
  </div>;
}
