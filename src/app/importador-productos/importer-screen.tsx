"use client";
/* eslint-disable @next/next/no-img-element -- las fotos de MHD se sirven por una ruta interna con sesión, no por next/image */

import { Fragment, useEffect, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { createClient } from "@/lib/supabase/client";
import type { FamilySummary } from "@/lib/mhd-importer/family";
import type { FamilyProfile, FilterRule } from "@/lib/mhd-importer/profile";
import type { ProcessedProduct } from "@/lib/mhd-importer/processor";
import { ReviewView } from "./review";
import { ProcessesView } from "./processes";

// Importador de productos MHD. Ver docs/IMPORTADOR_PRODUCTOS_MHD.md: el analista fija un perfil por familia
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

// Una sola pantalla para dos entradas del menú (2026-10-29): el importador (Procesos, Cola de revisión, Un producto) y
// «Reglas por familia», la configuración de cada familia de MHD, que se toca poco.
export function ProductImporterScreen({ view }: { view: "importer" | "families" }) {
  const [email, setEmail] = useState<string | null>(null); const [error, setError] = useState<string | null>(null);
  const [tree, setTree] = useState<TreeLine[]>([]); const [search, setSearch] = useState(""); const [showEmpty, setShowEmpty] = useState(false); const [onlyProfiled, setOnlyProfiled] = useState(false); const [openLines, setOpenLines] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null); const [version, setVersion] = useState(0); const [tab, setTab] = useState<"families" | "product" | "review" | "processes">(view === "families" ? "families" : "processes");
  // Se puede abrir una pestaña desde otra pantalla: ?pestana=producto&codigo=… (la cola de revisión enlaza así la ficha).
  const [linkedCode, setLinkedCode] = useState("");
  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    const params = new URLSearchParams(window.location.search); const pestana = params.get("pestana");
    const tabs = { producto: "product", revision: "review", procesos: "processes" } as const;
    if (pestana && pestana in tabs) window.setTimeout(() => { setTab(tabs[pestana as keyof typeof tabs]); setLinkedCode(params.get("codigo") ?? ""); }, 0);
  }, []);
  // El árbol de familias es una consulta pesada: solo lo pide «Reglas por familia», que es quien lo enseña.
  useEffect(() => { if (view !== "families") return; fetchJson<{ tree: TreeLine[] }>("/api/importador-productos/familias", "No se pudo leer el árbol de MHD.").then((body) => setTree(body.tree ?? []), (caught: Error) => setError(caught.message)); }, [version, view]);
  const term = search.trim().toLowerCase();
  const matches = (text: string) => !term || text.toLowerCase().includes(term);
  // Al buscar o filtrar por perfil se abren solas las líneas con coincidencias; las familias vacías se ocultan salvo que se pidan.
  const visible = tree.map((line) => ({ ...line, families: line.families.filter((family) => (showEmpty || family.products > 0) && (!onlyProfiled || family.profile_status !== null) && (matches(`${line.name} ${line.code}`) || matches(`${family.name} ${family.code}`) || family.subfamilies.some((sub) => matches(`${sub.name} ${sub.code}`)))) })).filter((line) => line.families.length > 0);
  const familyCount = visible.reduce((total, line) => total + line.families.length, 0);
  const isOpen = (code: string) => Boolean(term) || onlyProfiled || openLines.includes(code);
  const toggleLine = (code: string) => setOpenLines((current) => (current.includes(code) ? current.filter((item) => item !== code) : [...current, code]));
  return <div className="min-h-screen bg-zinc-50 lg:grid lg:grid-cols-[17.5rem_minmax(0,1fr)]"><AppSidebar active={view === "families" ? "familyRules" : "productImporter"} userEmail={email} /><main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 pb-24 pt-28 sm:px-10 lg:mx-0 lg:py-16">
    {view === "families" ? <>
    <header><h1 className="text-4xl font-semibold tracking-tight">Reglas por familia</h1><p className="mt-3 text-zinc-600">El perfil de cada familia de MHD: cómo se titula el producto, qué filtros y datos lleva y dónde se coloca en la tienda. Lo propone el analista con una muestra de productos y se revisa a mano. Es la configuración del importador: se toca poco.</p></header>
    </> : <>
    <header><h1 className="text-4xl font-semibold tracking-tight">Importador de productos</h1><p className="mt-3 text-zinc-600">Monta la ficha de cada producto de MHD (textos con IA, fotos, filtros, etiqueta energética, documentos y colocación en la tienda) y la sube a Shopify. <strong className="font-medium text-zinc-800">Procesos</strong>: lo que se está procesando y nuevas tandas · <strong className="font-medium text-zinc-800">Cola de revisión</strong>: lo que hay que decidir · <strong className="font-medium text-zinc-800">Un producto</strong>: ver o rehacer uno concreto. Las reglas de cada familia están en «Reglas por familia».</p></header>
    </>}
    {error && <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">{error}</p>}
    <div className="flex flex-wrap gap-2">{view === "importer" && ([["processes", "Procesos"], ["review", "Cola de revisión"], ["product", "Un producto"]] as const).map(([key, label]) => <button key={key} type="button" onClick={() => setTab(key)} className={`rounded-lg px-4 py-2 text-sm font-medium ${tab === key ? "bg-emerald-700 text-white" : "border border-zinc-300 bg-white text-zinc-700"}`}>{label}</button>)}</div>
    {tab === "processes" ? <ProcessesView /> : tab === "review" ? <ReviewView /> : tab === "product" ? <ProductTest initialCode={linkedCode} /> : <>
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

type RunMedia = { id: string; role: "image" | "energy_label" | "video"; position: number; filename: string; content_type: string; width: number | null; height: number | null; meta: Record<string, unknown> };
type Run = { id: string; codigo: string; status: "ok" | "discarded" | "error"; discard_reason: string | null; result: ProcessedProduct | null; warnings: string[]; cost_usd: number | null; created_at: string; media: RunMedia[]; shopify_product_id: string | null };
const mediaUrl = (id: string) => `/api/importador-productos/imagen?media=${id}`;
const sourceUrl = (url: string) => `/api/importador-productos/imagen?url=${encodeURIComponent(url)}`;
const KIND_LABELS: Record<string, string> = { frontal: "Frontal", tres_cuartos: "Tres cuartos", lateral: "Lateral", trasera: "Trasera", abierto: "Abierta", detalle: "Detalle", ambiente: "Ambiente", medidas: "Medidas", icono_o_logo: "Icono o logo", etiqueta_energetica: "Etiqueta energética", otro: "Otro" };

// Un producto (2026-10-29; antes «Prueba de producto»): con un código de MHD o EAN enseña la última ficha procesada y
// deja procesarlo de nuevo; si salió bien, subirlo o refrescarlo en Shopify.
function ProductTest({ initialCode = "" }: { initialCode?: string }) {
  const [codigo, setCodigo] = useState(initialCode); const [run, setRun] = useState<Run | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [looked, setLooked] = useState(false);
  async function show(code = codigo) {
    if (!code.trim()) return;
    setBusy(true); setError(null);
    try { const body = await fetchJson<{ runs: Run[] }>(`/api/importador-productos/producto?codigo=${encodeURIComponent(code.trim())}`, "No se pudo leer la última ficha."); setRun(body.runs[0] ?? null); setLooked(true); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo leer la última ficha."); } finally { setBusy(false); }
  }
  useEffect(() => { if (initialCode) { const timer = window.setTimeout(() => { setCodigo(initialCode); void show(initialCode); }, 0); return () => window.clearTimeout(timer); } }, [initialCode]); // eslint-disable-line react-hooks/exhaustive-deps
  async function process() {
    setBusy(true); setError(null);
    try { const response = await fetch("/api/importador-productos/producto", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ codigo }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "No se pudo procesar el producto."); setRun(body.run); setLooked(true); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo procesar el producto."); } finally { setBusy(false); }
  }
  return <section className="flex flex-col gap-5">
    <p className="text-sm text-zinc-600">Busca un producto por su código de MHD o su EAN para ver la última ficha que montó el importador, con sus fuentes y avisos. Desde aquí puedes procesarlo de nuevo y subirlo o refrescarlo en Shopify. Para varios productos a la vez, usa «Procesos» → «Nueva tanda».</p>
    <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); void show(); }}>
      <label className="text-sm font-medium text-zinc-700">Código de MHD o EAN<input value={codigo} onChange={(event) => setCodigo(event.target.value)} placeholder="p. ej. 10042945" className="mt-1 block h-10 w-72 rounded-lg border border-zinc-300 px-3" /></label>
      <button type="submit" disabled={busy || !codigo.trim()} className="h-10 rounded-lg border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-800 disabled:opacity-50">Ver la última ficha</button>
      <button type="button" disabled={busy || !codigo.trim()} onClick={() => void process()} className="h-10 rounded-lg bg-emerald-700 px-4 text-sm font-medium text-white disabled:opacity-50">{busy ? "Trabajando… (hasta dos minutos)" : "Procesar de nuevo"}</button>
    </form>
    {error && <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    {looked && !run && !error && <p className="rounded-xl border border-dashed border-zinc-300 p-5 text-sm text-zinc-600">Este producto no se ha procesado nunca. Pulsa «Procesar de nuevo» para montarlo.</p>}
    {run && <RunView run={run} />}
    {run?.status === "ok" && <ShopifyDraft run={run} onCreated={(id) => setRun({ ...run, shopify_product_id: id })} />}
  </section>;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) { return <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm"><h3 className="text-sm font-semibold text-zinc-900">{title}</h3><div className="mt-3">{children}</div></div>; }
function Rows({ rows }: { rows: [string, React.ReactNode][] }) { return <dl className="grid grid-cols-[minmax(0,12rem)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">{rows.map(([label, value]) => <Fragment key={label}><dt className="text-zinc-500">{label}</dt><dd className="min-w-0 break-words text-zinc-900">{value}</dd></Fragment>)}</dl>; }

function RunView({ run }: { run: Run }) {
  if (run.status !== "ok" || !run.result) return <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><p><strong>Descartado:</strong> {run.discard_reason}</p>{run.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>;
  const product = run.result; const shop = product.shopify;
  const images = run.media.filter((item) => item.role === "image").sort((a, b) => a.position - b.position);
  const label = run.media.find((item) => item.role === "energy_label");
  const custom = shop.metafields.filter((item) => item.namespace === "custom");
  const filters = shop.metafields.filter((item) => item.namespace !== "custom");
  const show = (value: string, type: string) => type.startsWith("list.") ? (JSON.parse(value) as string[]).join(" · ") : type === "json" ? <code className="text-xs text-zinc-600">{value.length > 220 ? `${value.slice(0, 220)}…` : value}</code> : value;
  return <div className="flex flex-col gap-5">
    <p className="text-sm text-zinc-500">Prueba del {dateTime(run.created_at)} · coste de IA {run.cost_usd !== null ? `${Number(run.cost_usd).toFixed(4).replace(".", ",")} $` : "—"} · MHD {product.sources.mhdDetail ? "con ficha" : "sin ficha"} · {product.sources.icecat ? "con Icecat" : "sin Icecat"} · ficha técnica desde {product.sources.technicalSheet === "icecat" ? "Icecat" : product.sources.technicalSheet === "mhd" ? "MHD" : "—"}</p>
    {run.warnings.length > 0 && <ul className="list-disc rounded-lg border border-amber-200 bg-amber-50 p-3 pl-8 text-sm text-amber-900">{run.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
    <Card title="Ficha">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Título ({shop.title.length} caracteres)</p><h2 className="mt-1 text-2xl font-semibold text-zinc-950">{shop.title}</h2>
      <p className="mt-3 text-xs font-medium uppercase tracking-wide text-zinc-500">Descripción corta ({product.content.short_description.length})</p><p className="text-zinc-800">{product.content.short_description}</p>
      {product.content.elvi_tip.text ? <div className="mt-4 flex gap-3 rounded-xl border border-lime-200 bg-lime-50 p-4"><span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-lime-300 font-semibold text-zinc-900">E</span><div><p className="text-sm font-semibold text-zinc-900">Elvi, nuestra vendedora IA</p><p className="mt-1 text-sm text-zinc-800">{product.content.elvi_tip.text}</p><p className="mt-1 text-xs text-zinc-500">Se apoya en: {product.content.elvi_tip.sources.map((item) => `${item.source} = ${item.value}`).join(" · ")}{product.elviReview ? ` · revisión: ${product.elviReview.reason}` : ""}</p></div></div> : <p className="mt-4 text-sm text-zinc-500">Sin frase de Elvi{product.elviReview && !product.elviReview.ok ? ` (descartado: ${product.elviReview.reason.replace(/\.$/, "")})` : " (no había nada útil que decir)"}.</p>}
      <p className="mt-4 text-xs font-medium uppercase tracking-wide text-zinc-500">Descripción larga</p>
      <iframe title="Descripción larga" sandbox="" srcDoc={`<style>body{font-family:system-ui,sans-serif;font-size:14px;line-height:1.5;color:#27272a;margin:0}h2{font-size:16px;margin:14px 0 4px}</style>${shop.descriptionHtml}`} className="mt-1 h-[26rem] w-full rounded border border-zinc-100" />
    </Card>
    <Card title="Cómo saldría en Google">
      <p className="text-sm text-zinc-500">electronicavicente.com › products › {shop.handle}</p>
      <p className="text-lg text-blue-800">{shop.seo.title} <span className="text-xs text-zinc-400">({shop.seo.title.length})</span></p>
      <p className="text-sm text-zinc-700">{shop.seo.description} <span className="text-xs text-zinc-400">({shop.seo.description.length})</span></p>
    </Card>
    <Card title={`Fotos en el orden en que se subirían (${images.length}), ya tratadas`}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{images.map((image, index) => { const info = product.images[index]; return <figure key={image.id} className="rounded-lg border border-zinc-200 p-2 text-xs"><img src={mediaUrl(image.id)} alt={String(image.meta.alt ?? "")} className="aspect-square w-full rounded border border-zinc-100 object-contain" /><figcaption className="mt-2 space-y-0.5"><p className="font-medium text-zinc-900">{index + 1}. {KIND_LABELS[info?.kind ?? ""] ?? info?.kind}{info?.isMhdMain ? " · principal de MHD" : ""}</p><p className="text-zinc-600">{image.width}×{image.height} · fondo {info?.background} · {info?.treatment}</p><p className="break-all text-zinc-400">{image.filename}</p><p className="text-zinc-500">alt: {String(image.meta.alt ?? "")}</p></figcaption></figure>; })}</div>
      {product.droppedImages.length > 0 && <><h4 className="mt-5 text-sm font-semibold text-zinc-900">Descartadas ({product.droppedImages.length})</h4><div className="mt-2 grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">{product.droppedImages.map((image) => <figure key={image.url} className="rounded-lg border border-zinc-200 p-2 text-xs opacity-70"><img src={sourceUrl(image.url)} alt={image.description} className="aspect-square w-full object-contain" /><figcaption className="mt-1 text-zinc-600">{image.reason}</figcaption></figure>)}</div></>}
    </Card>
    <div className="grid gap-5 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <Card title={`Etiqueta energética${product.energyLabel.letter ? ` (${product.energyLabel.letter})` : ""}`}>{label ? <><img src={mediaUrl(label.id)} alt="Etiqueta energética" className="w-full border border-zinc-100" /><p className="mt-2 text-xs text-zinc-500">{label.filename} · {label.width}×{label.height} · desde {product.energyLabel.source}</p></> : <p className="text-sm text-amber-800">Sin etiqueta.</p>}{product.energyLabel.eprel && <p className="mt-2 text-sm">EPREL <a className="text-emerald-700 hover:underline" href={`https://eprel.ec.europa.eu/qr/${product.energyLabel.eprel}`} target="_blank" rel="noreferrer">{product.energyLabel.eprel}</a></p>}</Card>
      <Card title="Producto en Shopify (borrador)"><Rows rows={[
        ["Estado", "Borrador (no se ha creado)"], ["Dirección", `/products/${shop.handle}`], ["Proveedor", shop.vendor], ["Tipo de producto", shop.productType ?? "— (sin hermanas en la tienda)"],
        ["Etiquetas", shop.tags.join(" · ")], ["Categoría de Shopify", shop.category?.name ?? "—"],
        ["Colección de marca", product.classification.brandCollection ? `${product.classification.brandCollection.title} (/collections/${product.classification.brandCollection.handle})` : "—"],
        ["Hermanas por EAN", `${product.classification.siblings} productos de la tienda${product.classification.distinction ? ` · variante «${product.classification.distinction}»` : ""}`],
        ["SKU (código de MHD)", shop.variant.sku], ["Código de barras", shop.variant.barcode ?? "—"],
        ["Precio", `${money.format(Number(shop.variant.price))} (PVP de MHD, sin precio tachado)`], ["Vender sin stock", shop.variant.inventoryPolicy === "CONTINUE" ? "Sí (BSH / Electrolux, gran electrodoméstico)" : "No"],
        ["Peso", shop.variant.weightKg ? `${String(shop.variant.weightKg).replace(".", ",")} kg` : "—"], ["Stock", shop.inventory.map((item) => `${item.location}: ${item.quantity}`).join(" · ")],
        ["Canales al activarlo", shop.publications.join(" · ")],
      ]} /></Card>
    </div>
    <Card title="Filtros (metacampos)"><table className="min-w-full text-sm"><tbody className="divide-y divide-zinc-100">{filters.map((item) => { const key = `${item.namespace}.${item.key}`; return <tr key={key}><td className="py-1.5 pr-4 font-medium whitespace-nowrap">{key}</td><td className="py-1.5 pr-4">{show(item.value, item.type)}</td><td className="py-1.5 text-xs text-zinc-400">{(product.origins[key] ?? []).map((origin) => origin.source).join(", ")}</td></tr>; })}</tbody></table>{product.missingFilters.length > 0 && <p className="mt-2 text-sm text-amber-800">Sin dato: {[...new Set(product.missingFilters)].join(", ")}</p>}</Card>
    <Card title="Otros metacampos"><table className="min-w-full text-sm"><tbody className="divide-y divide-zinc-100">{custom.map((item) => <tr key={item.key}><td className="py-1.5 pr-4 align-top font-medium whitespace-nowrap">custom.{item.key}</td><td className="py-1.5">{show(item.value, item.type)}</td></tr>)}<tr><td className="py-1.5 pr-4 font-medium whitespace-nowrap">custom.etiqueta_energetica</td><td className="py-1.5 text-zinc-500">{label ? `${label.filename} (se sube al crear el borrador)` : "—"}</td></tr><tr><td className="py-1.5 pr-4 font-medium whitespace-nowrap">custom.documentos</td><td className="py-1.5 text-zinc-500">{product.documents.length ? product.documents.map((document) => document.filename).join(" · ") : "—"}</td></tr></tbody></table></Card>
    <div className="grid gap-5 lg:grid-cols-2">
      <Card title="Documentos (Icecat → archivos propios)"><ul className="space-y-1 text-sm">{product.documents.map((document) => <li key={document.url}>{document.filename} <span className="text-zinc-400">{document.sizeBytes ? `${(document.sizeBytes / 1_048_576).toFixed(1).replace(".", ",")} MB` : ""}</span></li>)}{!product.documents.length && <li className="text-zinc-500">Sin ficha UE ni manual en Icecat.</li>}</ul></Card>
      <Card title="Vídeos"><p className="text-sm text-zinc-700">YouTube en español: {product.videos.youtube.length ? product.videos.youtube.map((video) => video.title ?? video.id).join(" · ") : "ninguno"}</p>
        <div className="mt-3 grid gap-3">{run.media.filter((item) => item.role === "video").map((item) => { const info = product.videos.mp4.find((video) => video.filename === item.filename); return <figure key={item.id} className="rounded-lg border border-zinc-200 p-2 text-xs"><video src={mediaUrl(item.id)} controls preload="metadata" className="w-full rounded bg-black" /><figcaption className="mt-2 space-y-0.5"><p className="font-medium text-zinc-900">{info?.kind === "producto" ? "Del producto → galería" : "De marca → pestaña «Vídeos» (custom.videos)"} · «{info?.description || "sin título"}»</p><p className="text-zinc-500">{item.filename} · {info ? `${(info.sizeBytes / 1_048_576).toFixed(1).replace(".", ",")} MB` : ""}</p><p className="text-zinc-500">{info?.reason}</p></figcaption></figure>; })}</div>
        {!product.videos.mp4.length && <p className="mt-1 text-sm text-zinc-500">Sin vídeos MP4.</p>}</Card>
    </div>
    <Card title="Precio"><Rows rows={[["PVP de MHD", product.price.pvp !== null ? money.format(product.price.pvp) : "—"], ["Precio anterior", <span key="a" className="text-zinc-400">{product.price.ignored.pvpBefore !== null ? `${money.format(product.price.ignored.pvpBefore)} (no se usa)` : "—"}</span>], ["Triple neto", <span key="b" className="text-zinc-400">{product.price.ignored.cost !== null ? `${money.format(product.price.ignored.cost)} (no se usa)` : "—"}</span>], ["IVA · stock MHD", `${product.price.vat ?? "—"} % · ${product.price.stock ?? "—"} uds.`]]} /></Card>
  </div>;
}

function ShopifyDraft({ run, onCreated }: { run: Run; onCreated: (id: string) => void }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [done, setDone] = useState<{ adminUrl: string; updated: boolean } | null>(null);
  async function sync() {
    if (!window.confirm(run.shopify_product_id ? "Este producto ya está en Shopify. Se REESCRIBIRÁ con esta prueba (textos, fotos, metacampos, precio y stock) y se perderá lo arreglado a mano. ¿Seguir?" : "Se creará el producto en Shopify. ¿Seguir?")) return;
    setBusy(true); setError(null);
    try { const response = await fetch("/api/importador-productos/producto", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "shopify", runId: run.id, overwrite: Boolean(run.shopify_product_id) }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "No se pudo guardar en Shopify."); setDone(body.created); onCreated(body.created.id); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo guardar en Shopify."); } finally { setBusy(false); }
  }
  const productId = run.shopify_product_id?.split("/").pop();
  return <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-6">
    <p className="text-sm text-zinc-700">{run.shopify_product_id ? <>Esta prueba ya está en Shopify: <a className="font-medium text-emerald-800 underline" href={done?.adminUrl ?? `https://admin.shopify.com/store/electronica-vicente/products/${productId}`} target="_blank" rel="noreferrer">abrir en el admin</a>{done ? (done.updated ? " (actualizado)." : " (creado como borrador).") : "."}</> : "Cuando la ficha esté bien, guárdala en Shopify: si el producto no existe se crea como borrador (no se publica); si ya existe, se actualiza."}</p>
    <button type="button" disabled={busy} onClick={() => void sync()} className="mt-3 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{busy ? "Guardando en Shopify…" : run.shopify_product_id ? "Volver a guardar en Shopify" : "Guardar en Shopify"}</button>
    {error && <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
  </div>;
}
