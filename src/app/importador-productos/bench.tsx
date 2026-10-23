"use client";

import { useEffect, useState } from "react";

// Banco de prueba del importador (docs/IMPORTADOR_PRODUCTOS_MHD.md): un conjunto fijo de productos de varias familias
// que se vuelve a generar cada vez que cambian las reglas, para revisar las fichas y contar los errores que quedan.
// Cada ficha se marca «Bien» o «Mal» con una nota; lo que se marca mal se convierte en una regla o en una comprobación.

type Review = { id: string; reviewer: string; verdict: "bien" | "mal"; note: string | null; created_at: string };
type Content = { title: string; meta_title: string; short_description: string; meta_description: string; long_description_html: string; elvi_tip: { text: string } };
type BenchRun = { id: string; status: string; discardReason: string | null; createdAt: string; costUsd: number | null; warnings: string[]; attempts: number | null; blocked: boolean; content: Content | null; elviReview: { ok: boolean; reason: string } | null; reviews: Review[] };
type BenchItem = { codigo: string; family_code: string; reason: string | null; run: BenchRun | null };
type FamilyRow = { family_code: string; family_name: string; status: "draft" | "reviewed" };

const CONCURRENCY = 3;
const dateTime = (value: string) => new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "short" }).format(new Date(value));
const textWarning = (warning: string) => /texto|Elvi|bloquead|sin respaldo/i.test(warning);

export function BenchView() {
  const [items, setItems] = useState<BenchItem[]>([]); const [families, setFamilies] = useState<FamilyRow[]>([]);
  const [error, setError] = useState<string | null>(null); const [version, setVersion] = useState(0);
  const [running, setRunning] = useState<Record<string, "cola" | "generando" | "hecho" | "error">>({});
  const [filter, setFilter] = useState<"todas" | "sin-revisar" | "mal" | "avisos">("todas");
  useEffect(() => {
    fetch("/api/importador-productos/banco", { cache: "no-store" }).then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "No se pudo leer el banco."); setItems(body.items); setFamilies(body.families); }).catch((caught: Error) => setError(caught.message));
  }, [version]);

  // Genera las fichas de tres en tres; cada una se refresca al terminar.
  async function generate(codes: string[]) {
    setRunning((current) => ({ ...current, ...Object.fromEntries(codes.map((code) => [code, "cola" as const])) }));
    const queue = [...codes];
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      while (queue.length) {
        const codigo = queue.shift()!;
        setRunning((current) => ({ ...current, [codigo]: "generando" }));
        const response = await fetch("/api/importador-productos/producto", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ codigo }) }).catch(() => null);
        setRunning((current) => ({ ...current, [codigo]: response?.ok ? "hecho" : "error" }));
        setVersion((current) => current + 1);
      }
    }));
  }

  const familyName = (code: string) => families.find((family) => family.family_code === code)?.family_name ?? code;
  const familyReviewed = (code: string) => families.find((family) => family.family_code === code)?.status === "reviewed";
  const generated = items.filter((item) => item.run?.status === "ok");
  const lastVerdict = (item: BenchItem) => item.run?.reviews.at(-1)?.verdict ?? null;
  const counts = {
    generadas: generated.length, bloqueadas: generated.filter((item) => item.run!.blocked).length,
    conAvisos: generated.filter((item) => item.run!.warnings.some(textWarning)).length,
    sinElvi: generated.filter((item) => !item.run!.content?.elvi_tip.text).length,
    bien: items.filter((item) => lastVerdict(item) === "bien").length, mal: items.filter((item) => lastVerdict(item) === "mal").length,
    coste: generated.reduce((total, item) => total + Number(item.run!.costUsd ?? 0), 0),
  };
  const busy = Object.values(running).some((state) => state === "cola" || state === "generando");
  const shown = items.filter((item) => filter === "todas" || (filter === "sin-revisar" && item.run && !lastVerdict(item)) || (filter === "mal" && lastVerdict(item) === "mal") || (filter === "avisos" && item.run?.warnings.some(textWarning)));

  return <section className="flex flex-col gap-5">
    <p className="text-sm text-zinc-600">{items.length} productos de {new Set(items.map((item) => item.family_code)).size} familias que se vuelven a generar cada vez que cambian las reglas de redacción. Revisa cada ficha y márcala como «Bien» o «Mal» diciendo qué falla: así se mide cuánto queda antes del masivo. Nada se guarda en Shopify.</p>
    {error && <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    <div className="grid gap-3 sm:grid-cols-4 lg:grid-cols-7">{([["Generadas", `${counts.generadas} de ${items.length}`], ["Bloqueadas", counts.bloqueadas], ["Con avisos de texto", counts.conAvisos], ["Sin frase de Elvi", counts.sinElvi], ["Revisadas bien", counts.bien], ["Revisadas mal", counts.mal], ["Coste de la vuelta", `${counts.coste.toFixed(2).replace(".", ",")} $`]] as const).map(([label, value]) => <div key={label} className="rounded-xl border border-zinc-200 bg-white p-3 shadow-sm"><p className="text-xs text-zinc-500">{label}</p><p className="mt-1 text-lg font-semibold tabular-nums text-zinc-900">{value}</p></div>)}</div>
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" disabled={busy || !items.length} onClick={() => generate(items.filter((item) => familyReviewed(item.family_code)).map((item) => item.codigo))} className="h-10 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white disabled:opacity-50">{busy ? `Generando… (${Object.values(running).filter((state) => state === "hecho" || state === "error").length} de ${Object.keys(running).length})` : "Generar todo el banco"}</button>
      <label className="text-sm text-zinc-600">Ver <select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)} className="ml-1 h-9 rounded-lg border border-zinc-300 bg-white px-2 text-sm"><option value="todas">todas</option><option value="sin-revisar">sin revisar</option><option value="mal">marcadas mal</option><option value="avisos">con avisos de texto</option></select></label>
      <span className="text-xs text-zinc-500">Solo se generan las familias con el perfil revisado.</span>
    </div>
    <div className="flex flex-col gap-4">{shown.map((item) => <BenchCard key={item.codigo} item={item} family={familyName(item.family_code)} reviewed={familyReviewed(item.family_code)} state={running[item.codigo]} onGenerate={() => generate([item.codigo])} onReviewed={() => setVersion((current) => current + 1)} />)}</div>
  </section>;
}

function BenchCard({ item, family, reviewed, state, onGenerate, onReviewed }: { item: BenchItem; family: string; reviewed: boolean; state?: string; onGenerate: () => void; onReviewed: () => void }) {
  const [note, setNote] = useState(""); const [saving, setSaving] = useState(false); const [error, setError] = useState<string | null>(null); const [open, setOpen] = useState(false);
  const run = item.run; const content = run?.content;
  async function review(verdict: "bien" | "mal") {
    setSaving(true); setError(null);
    try { const response = await fetch("/api/importador-productos/banco", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "review", runId: run!.id, verdict, note }) }); const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "No se pudo guardar."); setNote(""); onReviewed(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo guardar."); } finally { setSaving(false); }
  }
  const last = run?.reviews.at(-1);
  return <article className={`rounded-2xl border bg-white p-4 shadow-sm ${last?.verdict === "mal" ? "border-red-200" : last?.verdict === "bien" ? "border-emerald-200" : "border-zinc-200"}`}>
    <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="text-xs font-medium text-zinc-500">{family} · {item.codigo}{item.reason ? ` · ${item.reason}` : ""}</span>
      {run?.blocked && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">Bloqueada</span>}
      {last && <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${last.verdict === "bien" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>{last.verdict === "bien" ? "Bien" : "Mal"}</span>}
      <span className="ml-auto text-xs text-zinc-400">{state === "generando" ? "Generando…" : state === "cola" ? "En cola" : run ? `${dateTime(run.createdAt)}${run.attempts ? ` · ${run.attempts} intento${run.attempts > 1 ? "s" : ""}` : ""}${run.costUsd ? ` · ${Number(run.costUsd).toFixed(4).replace(".", ",")} $` : ""}` : "Sin generar"}</span>
      <button type="button" disabled={!reviewed || state === "generando" || state === "cola"} onClick={onGenerate} title={reviewed ? "" : "La familia aún no tiene el perfil revisado"} className="rounded-lg border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 disabled:opacity-40">Generar</button>
    </header>
    {run?.status === "discarded" && <p className="mt-2 text-sm text-amber-800">Descartado: {run.discardReason}</p>}
    {content && <div className="mt-3 flex flex-col gap-2 text-sm">
      <p className="text-base font-semibold text-zinc-900">{content.title}</p>
      <p className="text-zinc-700">{content.short_description}</p>
      <p className="text-xs text-zinc-500"><span className="font-medium">Google:</span> {content.meta_title} — {content.meta_description}</p>
      {content.elvi_tip.text ? <p className="rounded-lg bg-lime-50 p-2 text-zinc-800"><span className="font-semibold">Elvi:</span> {content.elvi_tip.text}</p> : <p className="text-xs text-zinc-500">Sin frase de Elvi{run?.elviReview && !run.elviReview.ok ? ` (descartada: ${run.elviReview.reason})` : ""}.</p>}
      <button type="button" onClick={() => setOpen(!open)} className="self-start text-xs font-medium text-zinc-600 underline">{open ? "Ocultar la descripción larga" : "Ver la descripción larga"}</button>
      {open && <div className="prose prose-sm max-w-none rounded-lg border border-zinc-100 p-3" dangerouslySetInnerHTML={{ __html: content.long_description_html }} />}
      {run!.warnings.filter(textWarning).length > 0 && <ul className="list-disc pl-5 text-xs text-amber-800">{run!.warnings.filter(textWarning).map((warning) => <li key={warning}>{warning}</li>)}</ul>}
    </div>}
    {run?.reviews.length ? <ul className="mt-3 flex flex-col gap-1 border-t border-zinc-100 pt-2 text-xs text-zinc-600">{run.reviews.map((item_) => <li key={item_.id}><span className={item_.verdict === "bien" ? "text-emerald-700" : "text-red-700"}>{item_.verdict === "bien" ? "Bien" : "Mal"}</span> · {item_.reviewer} · {dateTime(item_.created_at)}{item_.note ? `: ${item_.note}` : ""}</li>)}</ul> : null}
    {content && <div className="mt-3 flex flex-wrap items-start gap-2 border-t border-zinc-100 pt-3">
      <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} placeholder="Qué está mal y dónde (obligatorio si la marcas mal)" className="min-w-64 flex-1 rounded-lg border border-zinc-300 p-2 text-sm" />
      <button type="button" disabled={saving} onClick={() => review("bien")} className="h-9 rounded-lg bg-emerald-600 px-3 text-sm font-medium text-white disabled:opacity-50">Bien</button>
      <button type="button" disabled={saving} onClick={() => review("mal")} className="h-9 rounded-lg bg-red-600 px-3 text-sm font-medium text-white disabled:opacity-50">Mal</button>
      {error && <p className="w-full text-xs text-red-700">{error}</p>}
    </div>}
  </article>;
}
