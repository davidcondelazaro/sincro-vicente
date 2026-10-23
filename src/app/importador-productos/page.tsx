"use client";
/* eslint-disable @next/next/no-img-element -- las fotos de MHD se sirven por una ruta interna con sesión, no por next/image */

import { useEffect, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { createClient } from "@/lib/supabase/client";
import type { FamilySummary } from "@/lib/mhd-importer/family";
import type { FamilyProfile, FilterRule } from "@/lib/mhd-importer/profile";
import type { ProcessedProduct } from "@/lib/mhd-importer/processor";

// Importador de productos MHD (piloto). Ver docs/IMPORTADOR_PRODUCTOS_MHD.md: el analista fija un perfil por familia
// de MHD y el procesador monta cada producto con ese perfil. Todo se lanza a mano desde aquí.

type Family = { family_code: string; family_name: string };
type TreeSubfamily = { code: string; name: string; products: number; with_image: number };
type TreeFamily = { code: string; name: string; products: number; with_image: number; profile_status: "draft" | "reviewed" | null; analyzed_at: string | null; subfamilies: TreeSubfamily[] };
type TreeLine = { code: string; name: string; products: number; families: TreeFamily[] };
type Profile = { family_code: string; status: "draft" | "reviewed"; profile: FamilyProfile | null; reviewed_by: string | null; reviewed_at: string | null; analysis_input: { summary: FamilySummary; gatheredAt: string } | null; analyzed_at: string | null; cost_usd: number | null; model: string | null };

const integer = new Intl.NumberFormat("es-ES", { useGrouping: "always", maximumFractionDigits: 0 });
const money = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", useGrouping: "always" });
const dateTime = (value: string | null) => value ? new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "—";
async function fetchJson<T>(url: string, fallback: string): Promise<T> { const response = await fetch(url, { cache: "no-store" }); const body = await response.json(); if (!response.ok) throw new Error(body.error ?? fallback); return body as T; }
const statusLabel = (status: TreeFamily["profile_status"]) => status === "reviewed" ? "Revisado" : status === "draft" ? "Borrador" : "Sin perfil";

export default function ProductImporterPage() {
  const [email, setEmail] = useState<string | null>(null); const [error, setError] = useState<string | null>(null);
  const [tree, setTree] = useState<TreeLine[]>([]); const [search, setSearch] = useState(""); const [showEmpty, setShowEmpty] = useState(false); const [onlyProfiled, setOnlyProfiled] = useState(false); const [openLines, setOpenLines] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null); const [version, setVersion] = useState(0); const [tab, setTab] = useState<"families" | "product">("families");
  useEffect(() => { createClient().auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null)); }, []);
  useEffect(() => { fetchJson<{ tree: TreeLine[] }>("/api/importador-productos/familias", "No se pudo leer el árbol de MHD.").then((body) => setTree(body.tree ?? []), (caught: Error) => setError(caught.message)); }, [version]);
  const term = search.trim().toLowerCase();
  const matches = (text: string) => !term || text.toLowerCase().includes(term);
  // Al buscar o filtrar por perfil se abren solas las líneas con coincidencias; las familias vacías se ocultan salvo que se pidan.
  const visible = tree.map((line) => ({ ...line, families: line.families.filter((family) => (showEmpty || family.products > 0) && (!onlyProfiled || family.profile_status !== null) && (matches(`${line.name} ${line.code}`) || matches(`${family.name} ${family.code}`) || family.subfamilies.some((sub) => matches(`${sub.name} ${sub.code}`)))) })).filter((line) => line.families.length > 0);
  const familyCount = visible.reduce((total, line) => total + line.families.length, 0);
  const isOpen = (code: string) => Boolean(term) || onlyProfiled || openLines.includes(code);
  const toggleLine = (code: string) => setOpenLines((current) => (current.includes(code) ? current.filter((item) => item !== code) : [...current, code]));
  return <div className="min-h-screen bg-zinc-50 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]"><AppSidebar active="productImporter" userEmail={email} /><main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 pb-24 pt-28 sm:px-10 lg:mx-0 lg:py-16">
    <header><h1 className="text-4xl font-semibold tracking-tight">Importador de productos</h1><p className="mt-3 text-zinc-600">Piloto del paso de MHD a Shopify. Cada familia de MHD tiene un perfil con sus reglas: primero se prepara una muestra de productos (MHD e Icecat) y después el analista propone el perfil.</p></header>
    {error && <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">{error}</p>}
    <div className="flex flex-wrap gap-2">{([["families", "Familias"], ["product", "Prueba de producto"]] as const).map(([key, label]) => <button key={key} type="button" onClick={() => setTab(key)} className={`rounded-lg px-4 py-2 text-sm font-medium ${tab === key ? "bg-emerald-700 text-white" : "border border-zinc-300 bg-white text-zinc-700"}`}>{label}</button>)}</div>
    {tab === "product" ? <ProductTest /> : <>
    <div className="flex flex-wrap items-end justify-between gap-3"><label className="text-sm font-medium text-zinc-700">Buscar<input value={search} onChange={(event) => setSearch(event.target.value)} className="mt-1 block h-10 w-72 rounded-lg border border-zinc-300 px-3" placeholder="Línea, familia, subfamilia o código" /></label>
      <div className="flex flex-wrap items-center gap-4 text-sm text-zinc-600"><label className="flex items-center gap-2"><input type="checkbox" checked={onlyProfiled} onChange={(event) => setOnlyProfiled(event.target.checked)} />Solo con perfil</label><label className="flex items-center gap-2"><input type="checkbox" checked={showEmpty} onChange={(event) => setShowEmpty(event.target.checked)} />Mostrar familias sin productos</label><button type="button" onClick={() => setOpenLines(openLines.length ? [] : tree.map((line) => line.code))} className="font-medium text-emerald-700 hover:underline">{openLines.length ? "Plegar todo" : "Desplegar todo"}</button><span className="text-zinc-500">{integer.format(visible.length)} líneas · {integer.format(familyCount)} familias</span></div></div>
    <div className="rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm sm:p-4">
      {visible.map((line) => { const open = isOpen(line.code); return <div key={line.code} className="border-b border-zinc-100 last:border-b-0">
        <button type="button" onClick={() => toggleLine(line.code)} aria-expanded={open} className="flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left hover:bg-zinc-50">
          <svg viewBox="0 0 24 24" className={`h-4 w-4 shrink-0 text-zinc-400 transition-transform ${open ? "rotate-90" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
          <span className="font-semibold text-zinc-900">{line.name}</span><span className="text-xs text-zinc-400">{line.code}</span>
          <span className="ml-auto text-sm tabular-nums text-zinc-500">{integer.format(line.products)} productos · {line.families.length} familias</span>
        </button>
        {open && <ul className="mb-3 ml-[1.1rem] border-l border-zinc-200 pl-4">{line.families.map((family) => { const chosen = selected === family.code; return <li key={family.code} className="relative py-1 before:absolute before:top-[1.15rem] before:-left-4 before:w-3 before:border-t before:border-zinc-200">
          <button type="button" onClick={() => setSelected(chosen ? null : family.code)} aria-expanded={chosen} className={`flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2 py-1.5 text-left ${chosen ? "bg-emerald-50" : "hover:bg-zinc-50"} ${family.products ? "" : "opacity-50"}`}>
            <span className="font-medium text-zinc-900">{family.name}</span><span className="text-xs text-zinc-400">{family.code}</span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${family.profile_status === "reviewed" ? "bg-emerald-100 text-emerald-800" : family.profile_status === "draft" ? "bg-amber-100 text-amber-800" : "bg-zinc-100 text-zinc-500"}`}>{statusLabel(family.profile_status)}</span>
            <span className="ml-auto text-sm tabular-nums text-zinc-500">{integer.format(family.products)} productos{family.products ? ` · ${integer.format(family.with_image)} con imagen` : ""}</span>
          </button>
          {(family.subfamilies.length > 1 || chosen) && <ul className="ml-4 border-l border-zinc-100 pl-4 text-sm">{family.subfamilies.filter((sub) => showEmpty || sub.products > 0).map((sub) => <li key={sub.code} className="relative flex items-center gap-2 py-0.5 text-zinc-600 before:absolute before:top-[0.8rem] before:-left-4 before:w-3 before:border-t before:border-zinc-100"><span>{sub.name}</span><span className="text-xs text-zinc-400">{sub.code}</span><span className="ml-auto tabular-nums text-zinc-400">{integer.format(sub.products)}</span></li>)}</ul>}
          {chosen && <div className="mt-2 overflow-hidden rounded-xl border border-emerald-200"><FamilyPanel family={{ family_code: family.code, family_name: family.name }} onChange={() => setVersion((current) => current + 1)} /></div>}
        </li>; })}</ul>}
      </div>; })}
      {!visible.length && <p className="px-2 py-6 text-sm text-zinc-500">{tree.length ? "Nada coincide con la búsqueda." : "No hay datos. Ejecuta primero una importación del catálogo MHD."}</p>}
    </div>
    </>}
  </main></div>;
}

function FamilyPanel({ family, onChange }: { family: Family; onChange: () => void }) {
  const [profile, setProfile] = useState<Profile | null>(null); const [busy, setBusy] = useState<string | null>(null); const [error, setError] = useState<string | null>(null); const [warnings, setWarnings] = useState<string[]>([]);
  const [version, setVersion] = useState(0);
  useEffect(() => { fetchJson<{ profile: Profile | null }>(`/api/importador-productos/familias?family=${encodeURIComponent(family.family_code)}`, "No se pudo leer el perfil.").then((body) => setProfile(body.profile), (caught: Error) => setError(caught.message)); }, [family.family_code, version]);
  async function post(action: string, label: string, extra: Record<string, unknown> = {}) {
    setBusy(label); setError(null);
    try { const response = await fetch("/api/importador-productos/familias", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, family: family.family_code, ...extra }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "No se pudo completar la acción."); setVersion((current) => current + 1); onChange(); return body; }
    catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo completar la acción."); return null; } finally { setBusy(null); }
  }
  async function prepareSample() {
    setBusy("Leyendo la muestra en MHD e Icecat… (puede tardar un minuto)"); setError(null); setWarnings([]);
    try { const response = await fetch("/api/importador-productos/familias", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sample", family: family.family_code }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "No se pudo preparar la muestra."); setWarnings(body.errors ?? []); setVersion((current) => current + 1); onChange(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo preparar la muestra."); } finally { setBusy(null); }
  }
  const summary = profile?.analysis_input?.summary;
  return <section className="bg-emerald-50/40 p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-semibold text-zinc-950">{family.family_name} <span className="text-zinc-400">{family.family_code}</span></h2><p className="mt-1 text-sm text-zinc-600">{summary ? `Muestra leída el ${dateTime(profile?.analysis_input?.gatheredAt ?? null)}.` : "Aún no hay muestra de esta familia."}</p></div>
      <div className="flex gap-2"><button type="button" disabled={Boolean(busy)} onClick={() => void prepareSample()} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{summary ? "Volver a leer la muestra" : "Preparar muestra"}</button><button type="button" disabled={Boolean(busy) || !summary} onClick={() => void post("analyze", "El analista está estudiando la familia… (uno o dos minutos)")} className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 disabled:opacity-50">{profile?.profile ? "Volver a analizar" : "Analizar con IA"}</button></div></div>
    {busy && <p className="mt-4 text-sm text-zinc-600">{busy}</p>}
    {error && <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {warnings.length > 0 && <ul className="mt-4 list-disc rounded-lg border border-amber-200 bg-amber-50 p-3 pl-8 text-sm text-amber-900">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
    {profile?.profile && <ProfileView profile={profile} busy={Boolean(busy)} onSave={(next) => void post("save", "Guardando el perfil…", { profile: next })} onReview={() => void post("review", "Marcando como revisado…")} />}
    {summary && <details className="mt-6"><summary className="cursor-pointer text-sm font-semibold text-zinc-900">Muestra y resumen de la familia</summary><FamilySummaryView summary={summary} /></details>}
  </section>;
}

function FamilySummaryView({ summary }: { summary: FamilySummary }) {
  const sampleWithDetail = summary.sample.filter((item) => item.withDetail).length; const sampleWithIcecat = summary.sample.filter((item) => item.withIcecat).length;
  const facts: [string, string][] = [["Productos", integer.format(summary.products)], ["Con imagen", integer.format(summary.withImage)], ["Con EAN", integer.format(summary.withEan)], ["Con etiqueta energética", integer.format(summary.withEnergyLabel)], ["Precio", summary.price.min === null ? "—" : `${money.format(summary.price.min)} – ${money.format(summary.price.max ?? 0)} (mediana ${money.format(summary.price.median ?? 0)})`], ["Muestra", `${summary.sample.length} productos · ${sampleWithDetail} con ficha · ${sampleWithIcecat} con Icecat`]];
  return <div className="mt-5 flex flex-col gap-5">
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">{facts.map(([label, value]) => <div key={label} className="border-t border-emerald-100 pt-2"><dt className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</dt><dd className="mt-1 text-sm text-zinc-900">{value}</dd></div>)}</dl>
    <div className="grid gap-5 lg:grid-cols-2">
      <List title="Subfamilias" rows={summary.subfamilies.map((item) => [`${item.name} (${item.code})`, integer.format(item.products)])} />
      <List title="Marcas" rows={summary.brands.map((item) => [item.value, integer.format(item.count)])} />
    </div>
    <Table title="Características de MHD en la muestra" head={["Característica", "Productos", "Valores (nº)"]} rows={summary.mhdFeatures.map((item) => [item.name, String(item.products), item.values.map((value) => `${value.value} (${value.count})`).join(" · ")])} />
    <Table title="Características de Icecat en la muestra" head={["Sección", "Característica", "Productos", "Valores (nº)"]} rows={summary.icecatFeatures.map((item) => [item.group, item.name, String(item.products), item.values.map((value) => `${value.value} (${value.count})`).join(" · ")])} />
    {summary.icecatCategories.length > 0 && <p className="text-sm text-zinc-600">Categorías de Icecat: {summary.icecatCategories.map((item) => `${item.value} (${item.count})`).join(" · ")}</p>}
  </div>;
}

function List({ title, rows }: { title: string; rows: [string, string][] }) { return <div className="rounded-xl border border-zinc-200 bg-white p-4"><h3 className="text-sm font-semibold text-zinc-900">{title}</h3><ul className="mt-2 max-h-56 divide-y divide-zinc-100 overflow-auto text-sm">{rows.map(([label, value]) => <li key={label} className="flex justify-between gap-4 py-1.5"><span className="text-zinc-700">{label}</span><span className="tabular-nums text-zinc-500">{value}</span></li>)}</ul></div>; }
function Table({ title, head, rows }: { title: string; head: string[]; rows: string[][] }) { return <div className="rounded-xl border border-zinc-200 bg-white"><h3 className="px-4 pt-4 text-sm font-semibold text-zinc-900">{title}</h3><div className="mt-2 max-h-96 overflow-auto"><table className="min-w-full text-sm"><thead className="sticky top-0 bg-zinc-50 text-left text-zinc-600"><tr>{head.map((label) => <th key={label} className="px-4 py-2 font-medium">{label}</th>)}</tr></thead><tbody className="divide-y divide-zinc-100">{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex} className={`px-4 py-2 align-top ${cellIndex === row.length - 1 ? "text-zinc-600" : "whitespace-nowrap text-zinc-900"}`}>{cell}</td>)}</tr>)}{!rows.length && <tr><td colSpan={head.length} className="px-4 py-4 text-zinc-500">Sin datos en la muestra.</td></tr>}</tbody></table></div></div>; }

function ProfileView({ profile, busy, onSave, onReview }: { profile: Profile; busy: boolean; onSave: (next: FamilyProfile) => void; onReview: () => void }) {
  const [editing, setEditing] = useState(false); const [draft, setDraft] = useState(""); const [invalid, setInvalid] = useState<string | null>(null);
  const data = profile.profile!;
  const rule = (item: Pick<FilterRule, "method" | "ranges" | "table"> & { format?: string }) => item.method === "numero_exacto" ? `número → «${item.format}»` : item.method === "tramos" ? `tramos: ${item.ranges.map((range) => `${range.from || "…"}–${range.to || "…"} → «${range.value || "nada"}»`).join(" · ")}` : item.method === "tabla" || item.method === "contiene" ? `${item.method}: ${item.table.map((row) => `${row.source} → «${row.value || "nada"}»`).join(" · ")}` : `texto (${item.format})`;
  function save() { try { onSave(JSON.parse(draft) as FamilyProfile); setEditing(false); setInvalid(null); } catch { setInvalid("El JSON no es válido."); } }
  return <div className="mt-6 rounded-xl border border-zinc-200 bg-white p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-semibold text-zinc-950">Perfil propuesto <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${profile.status === "reviewed" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{profile.status === "reviewed" ? `Revisado${profile.reviewed_by ? ` por ${profile.reviewed_by}` : ""}` : "Borrador"}</span></h3><p className="mt-1 text-sm text-zinc-500">Analizado el {dateTime(profile.analyzed_at)} con {profile.model ?? "—"}{profile.cost_usd !== null ? ` · coste ${Number(profile.cost_usd).toFixed(2).replace(".", ",")} $` : ""}</p></div>
      <div className="flex gap-2"><button type="button" disabled={busy} onClick={() => { setDraft(JSON.stringify(data, null, 2)); setEditing((value) => !value); }} className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm">{editing ? "Cancelar" : "Corregir"}</button>{profile.status !== "reviewed" && <button type="button" disabled={busy || editing} onClick={onReview} className="rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">Dar por revisado</button>}</div></div>
    {editing ? <div className="mt-4"><textarea value={draft} onChange={(event) => setDraft(event.target.value)} spellCheck={false} className="h-[32rem] w-full rounded-lg border border-zinc-300 p-3 font-mono text-xs" />{invalid && <p className="mt-2 text-sm text-red-700">{invalid}</p>}<button type="button" disabled={busy} onClick={save} className="mt-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white">Guardar perfil</button></div> : <div className="mt-4 flex flex-col gap-4 text-sm">
      {data.questions.length > 0 && <Block title="Dudas para decidir"><ul className="list-disc pl-5 text-amber-900">{data.questions.map((item) => <li key={item}>{item}</li>)}</ul></Block>}
      <Block title="Producto"><p><strong>{data.product.singular}</strong> / {data.product.plural}</p>{data.product.distinctions.map((item) => <p key={item.name} className="text-zinc-600">{item.name}: {item.how_to_name} <Sources list={item.sources} /></p>)}</Block>
      <Block title="Título"><p className="font-mono text-xs">{data.title.template}</p><ul className="mt-1 list-disc pl-5">{data.title.key_data.map((item) => <li key={item.name}>{item.name} — «{item.format}» <Sources list={item.sources} /></li>)}</ul><p className="mt-1 text-zinc-600">Ejemplos: {data.title.examples.join(" · ")}</p>{data.title.avoid.length > 0 && <p className="text-zinc-600">Evitar: {data.title.avoid.join(" · ")}</p>}</Block>
      <Block title="Meta título"><p className="font-mono text-xs">{data.meta_title.template}</p><p className="text-zinc-600">Ejemplos: {data.meta_title.examples.join(" · ")}</p></Block>
      <Block title="Filtros"><ul className="divide-y divide-zinc-100">{data.filters.map((item, index) => <li key={`${item.metafield}-${index}`} className="py-1.5"><span className="font-medium">{item.metafield}{item.label && ` · ${item.label}`}</span>: {rule(item)} <Sources list={item.sources} />{item.note && <span className="block text-zinc-500">{item.note}</span>}</li>)}</ul></Block>
      <Block title="Descripciones"><p><strong>Corta:</strong> {data.descriptions.short}</p><p><strong>Larga:</strong> {data.descriptions.long}</p><p><strong>Destacar:</strong> {data.descriptions.highlight.join(" · ")}</p><p><strong>Evitar:</strong> {data.descriptions.avoid.join(" · ")}</p></Block>
      {data.subfamily_exceptions.length > 0 && <Block title="Excepciones por subfamilia"><ul className="list-disc pl-5">{data.subfamily_exceptions.map((item) => <li key={item.subfamily}><strong>{item.subfamily}</strong>: {item.changes}</li>)}</ul></Block>}
    </div>}
  </div>;
}
function Block({ title, children }: { title: string; children: React.ReactNode }) { return <section><h4 className="text-xs font-medium uppercase tracking-wide text-zinc-500">{title}</h4><div className="mt-1 text-zinc-800">{children}</div></section>; }
function Sources({ list }: { list: string[] }) { return list.length ? <span className="text-xs text-zinc-400">[{list.join(", ")}]</span> : null; }

type Run = { id: string; codigo: string; status: "ok" | "discarded" | "error"; discard_reason: string | null; result: ProcessedProduct | null; warnings: string[]; cost_usd: number | null; created_at: string };
const mediaUrl = (url: string, label = false) => `/api/importador-productos/imagen?url=${encodeURIComponent(url)}${label ? "&label=1" : ""}`;
const KIND_LABELS: Record<string, string> = { frontal: "Frontal", tres_cuartos: "Tres cuartos", lateral: "Lateral", trasera: "Trasera", abierto: "Abierto", detalle: "Detalle", ambiente: "Ambiente", medidas: "Medidas", icono_o_logo: "Icono o logo", etiqueta_energetica: "Etiqueta energética", otro: "Otro" };

function ProductTest() {
  const [codigo, setCodigo] = useState("10042945"); const [run, setRun] = useState<Run | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [loaded, setLoaded] = useState<string | null>(null);
  useEffect(() => { fetchJson<{ runs: Run[] }>("/api/importador-productos/producto?codigo=10042945", "No se pudo leer la última prueba.").then((body) => { setRun(body.runs[0] ?? null); setLoaded("10042945"); }, (caught: Error) => setError(caught.message)); }, []);
  async function process() {
    setBusy(true); setError(null);
    try { const response = await fetch("/api/importador-productos/producto", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ codigo }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "No se pudo procesar el producto."); setRun(body.run); setLoaded(codigo); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo procesar el producto."); } finally { setBusy(false); }
  }
  return <section className="flex flex-col gap-5">
    <p className="text-sm text-zinc-600">Monta la ficha de un producto de MHD con el perfil de su familia, tal como se subiría a Shopify, sin crear nada todavía.</p>
    <div className="flex flex-wrap items-end gap-3"><label className="text-sm font-medium text-zinc-700">Código de MHD o EAN<input value={codigo} onChange={(event) => setCodigo(event.target.value)} className="mt-1 block h-10 w-72 rounded-lg border border-zinc-300 px-3" /></label><button type="button" disabled={busy || !codigo.trim()} onClick={() => void process()} className="h-10 rounded-lg bg-emerald-700 px-4 text-sm font-medium text-white disabled:opacity-50">{busy ? "Procesando… (hasta un minuto)" : "Procesar"}</button></div>
    {error && <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    {run && loaded && <RunView run={run} />}
  </section>;
}

function RunView({ run }: { run: Run }) {
  if (run.status !== "ok" || !run.result) return <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><p><strong>Descartado:</strong> {run.discard_reason}</p>{run.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>;
  const product = run.result;
  return <div className="flex flex-col gap-5">
    <p className="text-sm text-zinc-500">Prueba del {dateTime(run.created_at)} · coste de IA {run.cost_usd !== null ? `${Number(run.cost_usd).toFixed(4).replace(".", ",")} $` : "—"} · MHD {product.sources.mhdDetail ? "con ficha" : "sin ficha"} · {product.sources.icecat ? "con Icecat" : "sin Icecat"}</p>
    {run.warnings.length > 0 && <ul className="list-disc rounded-lg border border-amber-200 bg-amber-50 p-3 pl-8 text-sm text-amber-900">{run.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
    <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Título ({product.content.title.length} caracteres)</p><h2 className="mt-1 text-2xl font-semibold text-zinc-950">{product.content.title}</h2>
      <p className="mt-3 text-xs font-medium uppercase tracking-wide text-zinc-500">Meta título ({product.content.meta_title.length})</p><p className="text-zinc-800">{product.content.meta_title}</p>
      <p className="mt-3 text-xs font-medium uppercase tracking-wide text-zinc-500">Descripción corta ({product.content.short_description.length}) · también meta descripción</p><p className="text-zinc-800">{product.content.short_description}</p>
      <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3"><div><dt className="text-zinc-500">Proveedor (vendor)</dt><dd>{product.vendor}</dd></div><div><dt className="text-zinc-500">Modelo / EAN</dt><dd>{product.model} · {product.ean}</dd></div><div><dt className="text-zinc-500">Familia de MHD</dt><dd>{product.family.name} ({product.family.code}) › {product.family.subfamilyName} ({product.family.subfamilyCode})</dd></div><div><dt className="text-zinc-500">Colección</dt><dd className="text-amber-800">Según el árbol nuevo (pendiente de cerrar con Vicente)</dd></div><div><dt className="text-zinc-500">Estado en Shopify</dt><dd>Borrador (no se ha creado)</dd></div><div><dt className="text-zinc-500">Perfil</dt><dd>{product.family.profileStatus === "reviewed" ? "Revisado" : "Borrador"}</dd></div></dl>
    </div>
    <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm"><h3 className="text-sm font-semibold text-zinc-900">Fotos en el orden en que se subirían ({product.images.length})</h3>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{product.images.map((image, index) => <figure key={image.url} className="rounded-lg border border-zinc-200 p-2 text-xs"><img src={mediaUrl(image.url)} alt={image.alt} className="aspect-square w-full rounded bg-zinc-50 object-contain" /><figcaption className="mt-2 space-y-0.5"><p className="font-medium text-zinc-900">{index + 1}. {KIND_LABELS[image.kind] ?? image.kind} · {image.width}×{image.height}</p><p className="text-zinc-600">{image.description}</p><p className="break-all text-zinc-400">{image.filename}</p><p className="text-zinc-500">alt: {image.alt}</p></figcaption></figure>)}</div>
      {product.droppedImages.length > 0 && <><h4 className="mt-5 text-sm font-semibold text-zinc-900">Descartadas ({product.droppedImages.length})</h4><div className="mt-2 grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">{product.droppedImages.map((image) => <figure key={image.url} className="rounded-lg border border-zinc-200 p-2 text-xs opacity-70"><img src={mediaUrl(image.url)} alt={image.description} className="aspect-square w-full object-contain" /><figcaption className="mt-1 text-zinc-600">{image.reason}</figcaption></figure>)}</div></>}
    </div>
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_16rem]">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm"><h3 className="text-sm font-semibold text-zinc-900">Descripción larga</h3><iframe title="Descripción larga" sandbox="" srcDoc={`<style>body{font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;color:#27272a;margin:0}h3{font-size:18px}h4{font-size:15px;margin-bottom:4px}</style>${product.content.long_description_html}`} className="mt-3 h-[28rem] w-full rounded border border-zinc-100" /></div>
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm"><h3 className="text-sm font-semibold text-zinc-900">Etiqueta energética {product.energyLabel.letter && `(${product.energyLabel.letter})`}</h3>{product.energyLabel.svgUrl ? <><img src={mediaUrl(product.energyLabel.svgUrl, true)} alt={`Etiqueta energética ${product.energyLabel.letter ?? ""}`} className="mt-3 w-full" /><p className="mt-2 text-xs text-zinc-500">SVG oficial de EPREL convertido a PNG.</p></> : <p className="mt-3 text-sm text-amber-800">MHD no trae etiqueta.</p>}</div>
    </div>
    <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm"><h3 className="text-sm font-semibold text-zinc-900">Filtros (metacampos)</h3><table className="mt-2 min-w-full text-sm"><tbody className="divide-y divide-zinc-100">{Object.entries(product.metafields).map(([key, value]) => <tr key={key}><td className="py-1.5 pr-4 font-medium whitespace-nowrap">{key}</td><td className="py-1.5 pr-4">{Array.isArray(value) ? value.join(" · ") : value}</td><td className="py-1.5 text-xs text-zinc-400">{(product.origins[key] ?? []).map((origin) => origin.source).join(", ")}</td></tr>)}</tbody></table>{product.missingFilters.length > 0 && <p className="mt-2 text-sm text-amber-800">Sin dato: {[...new Set(product.missingFilters)].join(", ")}</p>}</div>
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm"><h3 className="text-sm font-semibold text-zinc-900">Precio</h3><dl className="mt-2 grid grid-cols-2 gap-2 text-sm"><dt className="text-zinc-500">PVP de MHD</dt><dd>{product.price.pvp !== null ? money.format(product.price.pvp) : "—"}</dd><dt className="text-zinc-500">Precio anterior (no se usa)</dt><dd className="text-zinc-400 line-through">{product.price.pvpBefore !== null ? money.format(product.price.pvpBefore) : "—"}</dd><dt className="text-zinc-500">Coste (triple neto)</dt><dd>{product.price.cost !== null ? money.format(product.price.cost) : "—"}</dd><dt className="text-zinc-500">IVA · stock</dt><dd>{product.price.vat ?? "—"} % · {product.price.stock ?? "—"} uds.</dd></dl><p className="mt-2 text-sm text-amber-800">Qué precio va a Shopify: pendiente de decidir.</p></div>
      <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm"><h3 className="text-sm font-semibold text-zinc-900">Documentos y vídeos (Icecat)</h3><ul className="mt-2 space-y-1 text-sm">{product.documents.map((document) => <li key={document.url}><a href={document.url} target="_blank" rel="noreferrer" className="text-emerald-700 hover:underline">{document.filename}</a> <span className="text-zinc-400">{document.sizeBytes ? `${(document.sizeBytes / 1_048_576).toFixed(1).replace(".", ",")} MB` : ""}</span></li>)}{!product.documents.length && <li className="text-zinc-500">Sin PDF en español.</li>}</ul><p className="mt-2 text-sm text-zinc-600">{product.youtubeIds.length ? `${product.youtubeIds.length} vídeos de YouTube` : "Sin vídeos."}</p></div>
    </div>
  </div>;
}
