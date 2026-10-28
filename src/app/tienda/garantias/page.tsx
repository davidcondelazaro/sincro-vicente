"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { createClient } from "@/lib/supabase/client";

// Ampliación de garantía (src/lib/mhd-importer/warranty.ts): qué familias la admiten y las reglas por título para las
// familias mixtas. Con esto el importador escribe custom.admite_garantia en cada producto; el tema y el chatbot solo la leen.
type Family = { handle: string; title: string; group: string; eligible: boolean | null; products: number };
type Rule = { id: number; family_handle: string; pattern: string; eligible: boolean; position: number; note: string | null };
type Decision = { eligible: boolean | null; reason: string };
type Applied = { products: number; toYes: number; toNo: number; removed: number; pending: number; dryRun: boolean; examples: { title: string; before: string | null; after: boolean | null; reason: string }[] };
const integer = new Intl.NumberFormat("es-ES", { useGrouping: "always", maximumFractionDigits: 0 });
const label = (value: boolean | null) => (value === null ? "Sin decidir" : value ? "Sí" : "No");
const input = "mt-1 block h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm";

export default function WarrantyPage() {
  const [email, setEmail] = useState<string | null>(null); const [families, setFamilies] = useState<Family[]>([]); const [rules, setRules] = useState<Rule[]>([]);
  const [search, setSearch] = useState(""); const [filter, setFilter] = useState(""); const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); const [draft, setDraft] = useState<Partial<Rule> | null>(null);
  const [test, setTest] = useState({ handle: "", title: "" }); const [decision, setDecision] = useState<Decision | null>(null); const [applied, setApplied] = useState<Applied | null>(null);
  const load = useCallback(async () => {
    const response = await fetch("/api/tienda/garantias", { cache: "no-store" }); const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "No se pudieron leer las garantías.");
    setFamilies(body.families ?? []); setRules(body.rules ?? []);
  }, []);
  useEffect(() => { void load().catch((caught: Error) => setError(caught.message)); }, [load]);
  useEffect(() => { createClient().auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null)); }, []);
  async function post(action: string, payload: Record<string, unknown>, key = action) {
    setBusy(key); setError(null); setNotice(null);
    try {
      const response = await fetch("/api/tienda/garantias", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...payload }) }); const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "No se pudo guardar.");
      return body;
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo guardar."); return null; } finally { setBusy(null); }
  }
  async function setFamily(handle: string, eligible: boolean | null) {
    if (await post("familia", { handle, eligible }, `familia:${handle}`)) { setFamilies((all) => all.map((item) => (item.handle === handle ? { ...item, eligible } : item))); setNotice("Guardado. Pulsa «Ver cambios» para aplicarlo a lo ya subido."); }
  }
  async function saveRule() {
    if (!draft) return;
    if (await post("regla_guardar", draft)) { setDraft(null); await load(); setNotice("Regla guardada. Pulsa «Ver cambios» para aplicarla a lo ya subido."); }
  }
  async function deleteRule(rule: Rule) {
    if (!window.confirm(`¿Borrar la regla «${rule.pattern}»?`)) return;
    if (await post("regla_borrar", { id: rule.id }, `borrar:${rule.id}`)) await load();
  }
  async function tryTitle() { setDecision(await post("probar", test)); }
  async function apply(dryRun: boolean) { const body = await post("aplicar", { dryRun }, dryRun ? "ver" : "aplicar"); if (body) setApplied(body); }

  const titles = useMemo(() => new Map(families.map((item) => [item.handle, item.title])), [families]);
  const rulesByFamily = useMemo(() => rules.reduce((map, rule) => map.set(rule.family_handle, (map.get(rule.family_handle) ?? 0) + 1), new Map<string, number>()), [rules]);
  const shown = families.filter((item) => (!search || `${item.title} ${item.group}`.toLowerCase().includes(search.toLowerCase())) && (!filter || label(item.eligible) === filter));
  const count = (value: boolean | null) => families.filter((item) => item.eligible === value);
  const pendingChanges = applied ? applied.toYes + applied.toNo + applied.removed : 0;
  return <div className="min-h-screen bg-zinc-50 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]"><AppSidebar active="warranties" userEmail={email} /><main className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-6 px-4 pb-24 pt-28 sm:px-10 lg:mx-0 lg:py-16">
    <header><h1 className="text-4xl font-semibold tracking-tight">Garantías</h1><p className="mt-3 max-w-3xl text-zinc-600">Qué productos pueden llevar ampliación de Garantía3. Lo decide la familia y, en las familias mixtas, una regla por título. El importador lo escribe en cada producto al subirlo; la web y Elvi solo lo leen. El precio mínimo (60 €) y los tramos están en el editor del tema.</p></header>
    {error && <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">{error}</p>}
    {notice && <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">{notice}</p>}
    <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Stat label="Familias con garantía" value={count(true).length} hint={`${integer.format(count(true).reduce((n, item) => n + item.products, 0))} productos activos`} />
      <Stat label="Familias sin garantía" value={count(false).length} hint={`${integer.format(count(false).reduce((n, item) => n + item.products, 0))} productos activos`} />
      <Stat label="Sin decidir" value={count(null).length} hint="Sus productos no la ofrecen" warn={count(null).length > 0} />
      <Stat label="Reglas por título" value={rules.length} />
    </section>

    <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold">Aplicar a lo ya subido</h2>
      <p className="mt-1 max-w-3xl text-sm text-zinc-600">Los cambios de familias y reglas valen para las próximas subidas. Para corregir ya los productos de la tienda, mira primero qué cambiaría y luego aplícalo (tarda uno o dos minutos).</p>
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="button" onClick={() => void apply(true)} disabled={Boolean(busy)} className="h-10 rounded-lg border border-zinc-300 px-4 text-sm font-medium disabled:opacity-50">{busy === "ver" ? "Calculando…" : "Ver cambios"}</button>
        <button type="button" onClick={() => void apply(false)} disabled={Boolean(busy) || !applied?.dryRun || !pendingChanges} className="h-10 rounded-lg bg-emerald-700 px-4 text-sm font-medium text-white disabled:opacity-50">{busy === "aplicar" ? "Aplicando…" : "Aplicar en la tienda"}</button>
      </div>
      {applied && <div className="mt-4 text-sm text-zinc-700">
        <p>{applied.dryRun ? "Cambiaría" : "Cambiado"}: <b>{integer.format(applied.toYes)}</b> pasan a llevar garantía, <b>{integer.format(applied.toNo)}</b> dejan de llevarla y <b>{integer.format(applied.removed)}</b> se quedan sin marca (familia sin decidir), de {integer.format(applied.products)} productos de MHD.{applied.pending > 0 && <> Faltan <b>{integer.format(applied.pending)}</b>: vuelve a pulsar «Ver cambios» y «Aplicar».</>}</p>
        {applied.examples.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5 text-zinc-600">{applied.examples.map((item) => <li key={item.title}>{item.title}: {item.before === null ? "sin marca" : item.before === "true" ? "sí" : "no"} → <b>{label(item.after).toLowerCase()}</b> <span className="text-zinc-400">({item.reason})</span></li>)}</ul>}
      </div>}
    </section>

    <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold">Probar un título</h2>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-sm font-medium text-zinc-700">Familia<select value={test.handle} onChange={(event) => setTest({ ...test, handle: event.target.value })} className={`${input} w-64`}><option value="">Elige…</option>{families.map((item) => <option key={item.handle} value={item.handle}>{item.title}</option>)}</select></label>
        <label className="min-w-0 flex-1 text-sm font-medium text-zinc-700">Título del producto<input value={test.title} onChange={(event) => setTest({ ...test, title: event.target.value })} className={`${input} w-full`} placeholder="Cafetera italiana Bialetti Moka Express 6 tazas" /></label>
        <button type="button" onClick={() => void tryTitle()} disabled={!test.handle || !test.title.trim() || Boolean(busy)} className="h-10 rounded-lg border border-zinc-300 px-4 text-sm font-medium disabled:opacity-50">Probar</button>
      </div>
      {decision && <p className="mt-3 text-sm"><b>{label(decision.eligible)}</b> <span className="text-zinc-500">· {decision.reason}</span></p>}
    </section>

    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3"><h2 className="text-lg font-semibold">Reglas por título</h2><button type="button" onClick={() => setDraft({ eligible: true })} className="h-10 rounded-lg border border-zinc-300 bg-white px-4 text-sm font-medium">Nueva regla</button></div>
      <p className="max-w-3xl text-sm text-zinc-600">Ganan a la casilla de la familia. Se mira la primera regla de la familia cuyo patrón aparece en el título (sin distinguir mayúsculas). El patrón es una expresión regular: <code>eléctric|inducci</code> vale para «eléctrico» o «inducción»; <code>^Soporte</code>, para títulos que empiezan por «Soporte».</p>
      {draft && <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
        <label className="text-sm font-medium text-zinc-700">Familia<select value={draft.family_handle ?? ""} onChange={(event) => setDraft({ ...draft, family_handle: event.target.value })} className={`${input} w-56`}><option value="">Elige…</option>{families.map((item) => <option key={item.handle} value={item.handle}>{item.title}</option>)}</select></label>
        <label className="min-w-0 flex-1 text-sm font-medium text-zinc-700">Si el título contiene<input value={draft.pattern ?? ""} onChange={(event) => setDraft({ ...draft, pattern: event.target.value })} className={`${input} w-full font-mono`} placeholder="eléctric|inducci" /></label>
        <label className="text-sm font-medium text-zinc-700">Entonces<select value={String(draft.eligible)} onChange={(event) => setDraft({ ...draft, eligible: event.target.value === "true" })} className={input}><option value="true">Lleva garantía</option><option value="false">No lleva garantía</option></select></label>
        <label className="text-sm font-medium text-zinc-700">Nota<input value={draft.note ?? ""} onChange={(event) => setDraft({ ...draft, note: event.target.value })} className={`${input} w-48`} /></label>
        <button type="button" onClick={() => void saveRule()} disabled={Boolean(busy) || !draft.family_handle || !draft.pattern?.trim()} className="h-10 rounded-lg bg-emerald-700 px-4 text-sm font-medium text-white disabled:opacity-50">Guardar</button>
        <button type="button" onClick={() => setDraft(null)} className="h-10 rounded-lg px-3 text-sm text-zinc-600">Cancelar</button>
      </div>}
      <div className="overflow-auto rounded-2xl border border-zinc-200 bg-white shadow-sm"><table className="min-w-full text-sm"><thead className="bg-zinc-50 text-left text-zinc-600"><tr>
        <th className="px-4 py-3 font-medium">Familia</th><th className="px-4 py-3 font-medium">Si el título contiene</th><th className="px-4 py-3 font-medium">Garantía</th><th className="px-4 py-3 font-medium">Nota</th><th className="px-4 py-3" />
      </tr></thead><tbody className="divide-y divide-zinc-100">{rules.map((rule) => <tr key={rule.id} className="align-top">
        <td className="whitespace-nowrap px-4 py-3 text-zinc-900">{titles.get(rule.family_handle) ?? rule.family_handle}</td>
        <td className="max-w-[26rem] break-all px-4 py-3 font-mono text-xs text-zinc-700">{rule.pattern}</td>
        <td className="whitespace-nowrap px-4 py-3">{rule.eligible ? "Sí" : "No"}</td>
        <td className="px-4 py-3 text-zinc-500">{rule.note ?? ""}</td>
        <td className="whitespace-nowrap px-4 py-3 text-right"><button type="button" onClick={() => setDraft(rule)} className="text-emerald-800 hover:underline">Editar</button><button type="button" onClick={() => void deleteRule(rule)} disabled={Boolean(busy)} className="ml-3 text-red-700 hover:underline disabled:opacity-50">Borrar</button></td>
      </tr>)}{!rules.length && <tr><td colSpan={5} className="px-4 py-8 text-zinc-500">No hay reglas.</td></tr>}</tbody></table></div>
    </section>

    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Familias</h2>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm font-medium text-zinc-700">Buscar<input value={search} onChange={(event) => setSearch(event.target.value)} className={`${input} w-72 max-w-full`} placeholder="Familia o grupo" /></label>
        <label className="text-sm font-medium text-zinc-700">Garantía<select value={filter} onChange={(event) => setFilter(event.target.value)} className={input}><option value="">Todas</option><option>Sí</option><option>No</option><option>Sin decidir</option></select></label>
        <p className="ml-auto text-sm text-zinc-500">{integer.format(shown.length)} familias</p>
      </div>
      <div className="overflow-auto rounded-2xl border border-zinc-200 bg-white shadow-sm"><table className="min-w-full text-sm"><thead className="bg-zinc-50 text-left text-zinc-600"><tr>
        <th className="px-4 py-3 font-medium">Grupo</th><th className="px-4 py-3 font-medium">Familia</th><th className="px-4 py-3 text-right font-medium">Productos activos</th><th className="px-4 py-3 font-medium">Reglas</th><th className="px-4 py-3 font-medium">Garantía</th>
      </tr></thead><tbody className="divide-y divide-zinc-100">{shown.map((item) => <tr key={item.handle}>
        <td className="whitespace-nowrap px-4 py-3 text-zinc-500">{item.group}</td>
        <td className="px-4 py-3 text-zinc-900">{item.title}</td>
        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-zinc-700">{integer.format(item.products)}</td>
        <td className="whitespace-nowrap px-4 py-3 text-zinc-600">{rulesByFamily.get(item.handle) ? `${rulesByFamily.get(item.handle)} por título` : ""}</td>
        <td className="whitespace-nowrap px-4 py-3"><div className="inline-flex overflow-hidden rounded-lg border border-zinc-300">{([true, false, null] as const).map((value) => <button key={String(value)} type="button" onClick={() => void setFamily(item.handle, value)} disabled={Boolean(busy) || item.eligible === value} className={`px-3 py-1.5 text-xs ${item.eligible === value ? (value === null ? "bg-amber-100 font-semibold text-amber-900" : value ? "bg-emerald-100 font-semibold text-emerald-900" : "bg-zinc-200 font-semibold text-zinc-900") : "bg-white text-zinc-600 hover:bg-zinc-50"}`}>{label(value)}</button>)}</div></td>
      </tr>)}</tbody></table></div>
    </section>
  </main></div>;
}

function Stat({ label, value, hint, warn }: { label: string; value: number; hint?: string; warn?: boolean }) {
  return <div className={`rounded-2xl border bg-white p-4 shadow-sm ${warn ? "border-amber-300" : "border-zinc-200"}`}><p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900">{integer.format(value)}</p>{hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}</div>;
}
