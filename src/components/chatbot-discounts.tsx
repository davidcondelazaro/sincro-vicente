"use client";

import { useCallback, useEffect, useState } from "react";

// Cupones y descuentos de Shopify y cuáles puede dar el chatbot (/api/chatbot/discounts).
type Discount = {
  id: number; kind: "codigo" | "automatico"; title: string; codes: string[]; summary: string | null; status: string;
  starts_at: string | null; ends_at: string | null; usage_limit: number | null; used: number | null;
  open_to_all: boolean; bot_allowed: boolean; bot_note: string | null; updated_by: string | null; updated_at: string | null;
};

const dateFormat = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "short" });
const statusLabels: Record<string, { label: string; tone: string }> = {
  ACTIVE: { label: "Activo", tone: "bg-emerald-50 text-emerald-800" },
  SCHEDULED: { label: "Programado", tone: "bg-sky-50 text-sky-800" },
  EXPIRED: { label: "Caducado", tone: "bg-zinc-100 text-zinc-500" },
};

export function ChatbotDiscounts() {
  const [data, setData] = useState<{ discounts: Discount[]; lastSync: { started_at: string; status: string } | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/chatbot/discounts", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "No se pudieron leer los cupones.");
      setData(body); setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudieron leer los cupones.");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function syncNow() {
    setSyncing(true); setError(null);
    try {
      const response = await fetch("/api/chatbot/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "discounts" }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "No se pudo actualizar.");
      await new Promise((resolve) => setTimeout(resolve, 4000));
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo actualizar.");
    } finally { setSyncing(false); }
  }

  return <div className="flex flex-col gap-6">
    <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="mr-auto max-w-3xl">
        <p className="text-sm text-zinc-600">El chatbot solo da los cupones que actives aquí, y solo mientras estén activos en Shopify, dentro de sus fechas y con usos disponibles. Solo se pueden activar los abiertos a cualquier cliente. Si borras o desactivas un descuento en Shopify, el chatbot deja de darlo en la siguiente actualización (cada 15 minutos) o al pulsar «Actualizar ahora».</p>
        {data?.lastSync && <p className="mt-1 text-xs text-zinc-500">Última actualización: {dateFormat.format(new Date(data.lastSync.started_at))}{data.lastSync.status === "error" ? " · con error" : ""}</p>}
      </div>
      <button type="button" disabled={syncing} onClick={() => void syncNow()} className="h-10 cursor-pointer rounded-lg border border-emerald-700 px-4 text-sm font-medium text-emerald-800 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50">{syncing ? "Actualizando…" : "Actualizar ahora"}</button>
    </section>
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    {!data ? !error && <p className="text-sm text-zinc-500">Cargando…</p>
      : data.discounts.length === 0 ? <p className="rounded-2xl border border-zinc-200 bg-white p-5 text-sm text-zinc-500">No hay descuentos en Shopify. Cuando crees uno, aparecerá aquí tras la siguiente actualización.</p>
      : <div className="flex flex-col gap-3">{data.discounts.map((discount) => <DiscountCard key={discount.id} discount={discount} onChange={(next) => setData((current) => current && { ...current, discounts: current.discounts.map((item) => (item.id === next.id ? next : item)) })} />)}</div>}
  </div>;
}

function DiscountCard({ discount, onChange }: { discount: Discount; onChange: (next: Discount) => void }) {
  const [note, setNote] = useState(discount.bot_note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = statusLabels[discount.status] ?? { label: discount.status, tone: "bg-zinc-100 text-zinc-600" };
  const exhausted = discount.usage_limit != null && (discount.used ?? 0) >= discount.usage_limit;

  async function save(botAllowed: boolean) {
    setSaving(true); setError(null);
    try {
      const response = await fetch("/api/chatbot/discounts", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: discount.id, botAllowed, botNote: note }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "No se pudo guardar.");
      onChange(body.discount);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No se pudo guardar.");
    } finally { setSaving(false); }
  }

  return <article className={`rounded-2xl border bg-white p-5 shadow-sm ${discount.bot_allowed ? "border-emerald-300" : "border-zinc-200"}`}>
    <div className="flex flex-wrap items-center gap-2">
      <h3 className="mr-auto text-base font-semibold text-zinc-900">{discount.title}</h3>
      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${status.tone}`}>{status.label}</span>
      <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-700">{discount.kind === "automatico" ? "Automático" : "Código"}</span>
      {!discount.open_to_all && <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800">Solo para algunos clientes</span>}
      {exhausted && <span className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-500">Usos agotados</span>}
    </div>
    <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-zinc-600">
      {discount.codes.length > 0 && <span>Código: <span className="font-mono font-medium text-zinc-900">{discount.codes.join(", ")}</span></span>}
      {discount.summary && <span>{discount.summary}</span>}
      <span>{discount.starts_at ? `Desde ${dateFormat.format(new Date(discount.starts_at))}` : ""}{discount.ends_at ? ` · hasta ${dateFormat.format(new Date(discount.ends_at))}` : " · sin fecha de fin"}</span>
      {discount.usage_limit != null && <span>Usos: {discount.used ?? 0} de {discount.usage_limit}</span>}
    </div>
    <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-zinc-100 pt-4">
      <label className="flex items-center gap-2 pb-2 text-sm font-medium text-zinc-700"><input type="checkbox" checked={discount.bot_allowed} disabled={saving || !discount.open_to_all} onChange={(event) => void save(event.target.checked)} className="h-4 w-4 accent-emerald-700" />El chatbot puede darlo</label>
      <label className="min-w-64 flex-1 text-xs font-medium text-zinc-500">Nota para el chatbot (opcional)<input value={note} onChange={(event) => setNote(event.target.value)} disabled={!discount.open_to_all} placeholder="Por ejemplo: solo para la primera compra; no acumulable con ofertas" className="mt-1 block h-9 w-full rounded-lg border border-zinc-300 bg-white px-2 text-sm font-normal text-zinc-900" /></label>
      {note !== (discount.bot_note ?? "") && <button type="button" disabled={saving} onClick={() => void save(discount.bot_allowed)} className="h-9 cursor-pointer rounded-lg border border-emerald-700 px-3 text-sm font-medium text-emerald-800 hover:bg-emerald-50 disabled:opacity-50">Guardar nota</button>}
    </div>
    {discount.updated_by && <p className="mt-2 text-xs text-zinc-500">Cambiado por {discount.updated_by}{discount.updated_at ? ` · ${dateFormat.format(new Date(discount.updated_at))}` : ""}</p>}
    {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
  </article>;
}
