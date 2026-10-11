"use client";

import { useCallback, useEffect, useState } from "react";

// Estado, lanzamiento a mano y programación de las sincronizaciones del chatbot (/api/chatbot/sync).
type Kind = "collections" | "products" | "embeddings" | "content" | "discounts";
type KindState = {
  kind: Kind;
  schedule: { cron: string; enabled: boolean; updated_at: string; updated_by: string | null } | null;
  last: { started_at: string; finished_at: string | null; status: string; error: string | null } | null;
  running: boolean;
  next: string | null;
};

const info: Record<Kind, { label: string; description: string }> = {
  collections: { label: "Colecciones", description: "Categorías de la tienda. Van antes que los productos." },
  products: { label: "Productos", description: "Catálogo, precios, stock y metacampos." },
  embeddings: { label: "Vectores de búsqueda", description: "Recalcula la búsqueda por significado de los productos que han cambiado. Después de productos." },
  content: { label: "Contenido", description: "Páginas, políticas y blog de la tienda." },
  discounts: { label: "Cupones descuento", description: "Descuentos de Shopify; cuáles puede dar el bot se decide en Chatbot IA → Cupones descuento." },
};
const presets = [
  { cron: "0 * * * *", label: "Cada hora, en punto" },
  { cron: "15 * * * *", label: "Cada hora, a y cuarto" },
  { cron: "0 */2 * * *", label: "Cada 2 horas" },
  { cron: "0 */6 * * *", label: "Cada 6 horas" },
  { cron: "0 4 * * *", label: "Cada día a las 4:00" },
  { cron: "30 4 * * *", label: "Cada día a las 4:30" },
  { cron: "0 4 * * 1", label: "Los lunes a las 4:00" },
];
const dateFormat = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "short" });
const formatDate = (value: string | null | undefined) => (value ? dateFormat.format(new Date(value)) : "—");

export function ChatbotSyncPanel({ onChange }: { onChange: () => void }) {
  const [kinds, setKinds] = useState<KindState[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [launchingAll, setLaunchingAll] = useState(false);
  const [allMessage, setAllMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/chatbot/sync", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "No se pudo leer el estado de las sincronizaciones.");
      setKinds(body.kinds); setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo leer el estado de las sincronizaciones.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  // Mientras haya alguna en curso, se refresca el estado cada 10 segundos.
  const anyRunning = kinds?.some((item) => item.running) ?? false;
  useEffect(() => {
    if (!anyRunning) return;
    const timer = setInterval(() => { void load(); onChange(); }, 10_000);
    return () => clearInterval(timer);
  }, [anyRunning, load, onChange]);

  async function runAll() {
    if (!window.confirm("¿Lanzar ahora todas las sincronizaciones? Van en orden (colecciones, productos, vectores, contenido y cupones) y tardan unos minutos.")) return;
    setLaunchingAll(true); setAllMessage(null);
    try {
      const response = await fetch("/api/chatbot/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "all" }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "No se pudieron lanzar.");
      setAllMessage({ tone: "ok", text: "Lanzadas. Van una detrás de otra; el estado se actualiza solo." });
      setTimeout(() => { void load(); onChange(); }, 2000);
    } catch (caught) {
      setAllMessage({ tone: "error", text: caught instanceof Error ? caught.message : "No se pudieron lanzar." });
    } finally { setLaunchingAll(false); }
  }

  if (error) return <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>;
  if (!kinds) return <p className="text-sm text-zinc-500">Cargando sincronizaciones…</p>;
  return <section className="grid gap-4 md:grid-cols-2">
    <div className="flex flex-wrap items-center gap-3 md:col-span-2">
      <button type="button" disabled={launchingAll || anyRunning} onClick={() => void runAll()} className="cursor-pointer rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">{launchingAll ? "Lanzando…" : anyRunning ? "Hay sincronizaciones en curso…" : "Lanzar todo ahora"}</button>
      {allMessage && <p className={`text-sm ${allMessage.tone === "ok" ? "text-emerald-700" : "text-red-700"}`}>{allMessage.text}</p>}
    </div>
    {kinds.map((item) => <SyncCard key={item.kind} state={item} onChange={() => { void load(); onChange(); }} />)}
    <p className="text-xs text-zinc-500 md:col-span-2">La programación usa expresiones cron en hora de Madrid. El chatbot la revisa cada 5 minutos, así que una sincronización puede empezar hasta 5 minutos después de su hora.</p>
  </section>;
}

function SyncCard({ state, onChange }: { state: KindState; onChange: () => void }) {
  const [cron, setCron] = useState(state.schedule?.cron ?? "0 * * * *");
  const [enabled, setEnabled] = useState(state.schedule?.enabled ?? false);
  const [busy, setBusy] = useState<"save" | "run" | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const dirty = cron.trim() !== (state.schedule?.cron ?? "") || enabled !== (state.schedule?.enabled ?? false);
  const { label, description } = info[state.kind];
  const last = state.last;
  const lastTone = state.running ? "text-amber-700" : last?.status === "error" ? "text-red-700" : last?.status === "ok" ? "text-emerald-700" : "text-zinc-500";
  const lastText = state.running ? `En curso desde ${formatDate(last?.started_at)}` : !last ? "Nunca" : last.status === "ok" ? `Correcta · ${formatDate(last.finished_at ?? last.started_at)}` : last.status === "error" ? `Error · ${formatDate(last.started_at)}` : `Sin terminar · ${formatDate(last.started_at)}`;

  async function save() {
    setBusy("save"); setMessage(null);
    try {
      const response = await fetch("/api/chatbot/sync", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: state.kind, cron, enabled }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "No se pudo guardar.");
      setMessage({ tone: "ok", text: enabled ? `Guardado. Próxima: ${formatDate(body.next)}` : "Guardado. Programación desactivada." });
      onChange();
    } catch (caught) {
      setMessage({ tone: "error", text: caught instanceof Error ? caught.message : "No se pudo guardar." });
    } finally { setBusy(null); }
  }

  async function run() {
    setBusy("run"); setMessage(null);
    try {
      const response = await fetch("/api/chatbot/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: state.kind }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "No se pudo lanzar.");
      setMessage({ tone: "ok", text: "Lanzada. El resultado aparecerá en el historial." });
      setTimeout(onChange, 1500);
    } catch (caught) {
      setMessage({ tone: "error", text: caught instanceof Error ? caught.message : "No se pudo lanzar." });
    } finally { setBusy(null); }
  }

  return <article className="flex flex-col gap-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
    <div className="flex items-start justify-between gap-3">
      <div><h3 className="font-semibold text-zinc-900">{label}</h3><p className="mt-1 text-sm text-zinc-500">{description}</p></div>
      <button type="button" disabled={busy !== null || state.running} onClick={() => void run()} className="shrink-0 cursor-pointer rounded-lg bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">{busy === "run" ? "Lanzando…" : state.running ? "En curso…" : "Lanzar ahora"}</button>
    </div>
    <dl className="grid grid-cols-2 gap-3 text-sm">
      <div><dt className="text-xs font-medium text-zinc-500">Última</dt><dd className={`mt-0.5 font-medium ${lastTone}`}>{lastText}</dd></div>
      <div><dt className="text-xs font-medium text-zinc-500">Próxima programada</dt><dd className="mt-0.5 text-zinc-800">{state.next ? formatDate(state.next) : "Sin programar"}</dd></div>
    </dl>
    {last?.status === "error" && last.error && !state.running && <p className="line-clamp-2 text-xs text-red-700" title={last.error}>{last.error}</p>}
    <div className="flex flex-wrap items-end gap-3 border-t border-zinc-100 pt-4">
      <label className="flex items-center gap-2 pb-2 text-sm font-medium text-zinc-700"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} className="h-4 w-4 accent-emerald-700" />Programada</label>
      <label className="text-sm font-medium text-zinc-700">Frecuencia<select value={presets.some((preset) => preset.cron === cron.trim()) ? cron.trim() : "custom"} onChange={(event) => { if (event.target.value !== "custom") setCron(event.target.value); }} className="mt-1 block h-9 rounded-lg border border-zinc-300 bg-white px-2 font-normal">{presets.map((preset) => <option key={preset.cron} value={preset.cron}>{preset.label}</option>)}<option value="custom">Personalizada</option></select></label>
      <label className="text-sm font-medium text-zinc-700">Cron<input value={cron} onChange={(event) => setCron(event.target.value)} spellCheck={false} className="mt-1 block h-9 w-32 rounded-lg border border-zinc-300 bg-white px-2 font-mono text-sm font-normal" /></label>
      <button type="button" disabled={!dirty || busy !== null} onClick={() => void save()} className="h-9 cursor-pointer rounded-lg border border-emerald-700 px-3 text-sm font-medium text-emerald-800 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-40">{busy === "save" ? "Guardando…" : "Guardar"}</button>
    </div>
    {message && <p className={`text-sm ${message.tone === "ok" ? "text-emerald-700" : "text-red-700"}`}>{message.text}</p>}
  </article>;
}
