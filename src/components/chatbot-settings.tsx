"use client";

import { useEffect, useState } from "react";

// Configuración editable del chatbot (/api/chatbot/settings → tabla bot_settings del chatbot).
type Settings = {
  phone: string;
  supportEmail: string;
  whatsapp: { number: string | null; hours: string | null; schedule: { days: number[]; from: string; to: string } };
  notices: string | null;
  teamEmails: { alerts: string[]; tickets: string[]; reports: string[]; quotes: string[] };
  priceAlerts: { minPercent: number; minEuros: number };
};
const teamLists: { key: keyof Settings["teamEmails"]; label: string; help: string }[] = [
  { key: "alerts", label: "Avisos de errores", help: "Sincronizaciones que fallan o se retrasan, tareas con error, tickets que no se envían y picos de errores del widget." },
  { key: "tickets", label: "Tickets de soporte", help: "Incidencias, reclamaciones y devoluciones que abren los clientes en el chat. Al responder, se contesta al cliente." },
  { key: "quotes", label: "Presupuestos", help: "Solicitudes de presupuesto a medida del chat, con los precios del día. Al responder, se contesta al cliente." },
  { key: "reports", label: "Resúmenes", help: "Resumen semanal (lunes, 8:00) y aviso diario de conversaciones a revisar." },
];

const dayNames = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const dateFormat = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "short" });
const input = "mt-1 block h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 font-normal text-zinc-900";
const label = "text-sm font-medium text-zinc-700";

export function ChatbotSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saved, setSaved] = useState<string>("");
  const [meta, setMeta] = useState<{ updatedAt: string | null; updatedBy: string | null }>({ updatedAt: null, updatedBy: null });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/chatbot/settings", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "No se pudo leer la configuración.");
        const loaded = normalize(body.settings);
        setSettings(loaded); setSaved(JSON.stringify(loaded)); setMeta({ updatedAt: body.updatedAt, updatedBy: body.updatedBy });
      })
      .catch((caught) => setMessage({ tone: "error", text: caught instanceof Error ? caught.message : "No se pudo leer la configuración." }));
  }, []);

  if (!settings) return message ? <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{message.text}</p> : <p className="text-sm text-zinc-500">Cargando configuración…</p>;
  const dirty = JSON.stringify(settings) !== saved;
  const update = (change: (draft: Settings) => void) => { const draft = structuredClone(settings); change(draft); setSettings(draft); setMessage(null); };

  async function save() {
    setSaving(true); setMessage(null);
    try {
      const response = await fetch("/api/chatbot/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "No se pudo guardar.");
      const next = normalize(body.settings);
      setSettings(next); setSaved(JSON.stringify(next)); setMeta({ updatedAt: body.updatedAt, updatedBy: body.updatedBy });
      setMessage({ tone: "ok", text: "Guardado. El chatbot lo usará en menos de un minuto." });
    } catch (caught) {
      setMessage({ tone: "error", text: caught instanceof Error ? caught.message : "No se pudo guardar." });
    } finally { setSaving(false); }
  }

  const schedule = settings.whatsapp.schedule;
  return <div className="flex flex-col gap-6">
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-zinc-900">Emails del equipo</h2>
      <p className="mt-1 text-sm text-zinc-500">Quién recibe los emails internos del chatbot. Varios emails, separados por comas. Si una lista está vacía, ese email no se envía a nadie.</p>
      <div className="mt-4 flex flex-col gap-4">{teamLists.map((list) => <label key={list.key} className={label}>{list.label}
        <input value={settings.teamEmails[list.key].join(", ")} onChange={(event) => update((draft) => { draft.teamEmails[list.key] = event.target.value.split(",").map((item) => item.trim()); })} onBlur={() => update((draft) => { draft.teamEmails[list.key] = draft.teamEmails[list.key].filter(Boolean); })} placeholder="persona@electronicavicente.com, otra@electronicavicente.com" className={input} />
        <span className="mt-1 block text-xs font-normal text-zinc-500">{list.help}</span></label>)}</div>
    </section>

    <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-zinc-900">Avisos e instrucciones temporales</h2>
      <p className="mt-1 text-sm text-zinc-500">Se añaden a las instrucciones del chatbot, en texto y en voz, y los tiene en cuenta cuando vienen al caso. Para cosas que cambian: vacaciones, retrasos en envíos, promociones, cierres de tienda… Quítalos cuando dejen de valer.</p>
      <textarea value={settings.notices ?? ""} onChange={(event) => update((draft) => { draft.notices = event.target.value || null; })} rows={5} maxLength={4000} placeholder={"Del 24 al 31 de diciembre los envíos tardan 2 días más de lo habitual.\nEsta semana hay un 10 % de descuento en lavadoras Balay (ya aplicado en el precio)."} className="mt-4 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900" />
      <p className="mt-1 text-right text-xs text-zinc-400">{(settings.notices ?? "").length.toLocaleString("es-ES", { useGrouping: "always" })} / 4.000</p>
    </section>

    <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-zinc-900">Avisos de bajada de precio</h2>
      <p className="mt-1 text-sm text-zinc-500">El aviso es único: solo se envía si el precio baja al menos esto respecto al que tenía cuando el cliente se apuntó (se exigen las dos cosas). Así no se gasta en una bajada de céntimos.</p>
      <div className="mt-4 flex flex-wrap gap-4">
        <label className={label}>Bajada mínima (%)<input type="number" min={0} max={50} step={0.5} value={settings.priceAlerts.minPercent} onChange={(event) => update((draft) => { draft.priceAlerts.minPercent = Number(event.target.value); })} className={input.replace("w-full", "w-32")} /></label>
        <label className={label}>Bajada mínima (€)<input type="number" min={0} max={500} step={1} value={settings.priceAlerts.minEuros} onChange={(event) => update((draft) => { draft.priceAlerts.minEuros = Number(event.target.value); })} className={input.replace("w-full", "w-32")} /></label>
      </div>
      <p className="mt-2 text-xs text-zinc-500">Ejemplo con estos valores: si se apuntó a {euroExample(500)}, se avisa cuando baje a {euroExample(Math.max(0, 500 - Math.max(settings.priceAlerts.minEuros || 0, 500 * (settings.priceAlerts.minPercent || 0) / 100)))} o menos.</p>
    </section>

    <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-zinc-900">Contacto</h2>
      <p className="mt-1 text-sm text-zinc-500">El chatbot los da cuando el cliente pide hablar con alguien o abre una incidencia.</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className={label}>Teléfono<input value={settings.phone} onChange={(event) => update((draft) => { draft.phone = event.target.value; })} className={input} /></label>
        <label className={label}>Email de soporte<input type="email" value={settings.supportEmail} onChange={(event) => update((draft) => { draft.supportEmail = event.target.value; })} className={input} /></label>
      </div>
    </section>

    <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-zinc-900">WhatsApp</h2>
      <p className="mt-1 text-sm text-zinc-500">Fuera del horario, el chatbot no ofrece WhatsApp y propone el teléfono o el email. Sin número, no lo ofrece nunca.</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className={label}>Número<input value={settings.whatsapp.number ?? ""} onChange={(event) => update((draft) => { draft.whatsapp.number = event.target.value || null; })} placeholder="34699742952" className={input} /><span className="mt-1 block text-xs font-normal text-zinc-500">Con prefijo de país, sin «+» ni espacios.</span></label>
        <label className={label}>Horario, como lo dice el chatbot<input value={settings.whatsapp.hours ?? ""} onChange={(event) => update((draft) => { draft.whatsapp.hours = event.target.value || null; })} placeholder="De lunes a viernes de 9:00 a 15:00" className={input} /></label>
      </div>
      <fieldset className="mt-4">
        <legend className={label}>Días y horas en que se atiende (hora peninsular)</legend>
        <div className="mt-2 flex flex-wrap gap-2">{dayNames.map((name, index) => { const day = index + 1; const on = schedule.days.includes(day); return <button key={day} type="button" aria-pressed={on} onClick={() => update((draft) => { const days = draft.whatsapp.schedule.days; draft.whatsapp.schedule.days = on ? days.filter((value) => value !== day) : [...days, day].sort(); })} className={`cursor-pointer rounded-lg px-3 py-1.5 text-sm font-medium ${on ? "bg-emerald-700 text-white" : "border border-zinc-300 bg-white text-zinc-600 hover:bg-zinc-50"}`}>{name}</button>; })}</div>
        <div className="mt-3 flex flex-wrap gap-4">
          <label className={label}>Desde<input type="time" value={schedule.from} onChange={(event) => update((draft) => { draft.whatsapp.schedule.from = event.target.value; })} className={input.replace("w-full", "w-32")} /></label>
          <label className={label}>Hasta<input type="time" value={schedule.to} onChange={(event) => update((draft) => { draft.whatsapp.schedule.to = event.target.value; })} className={input.replace("w-full", "w-32")} /></label>
        </div>
      </fieldset>
    </section>


    <div className="sticky bottom-16 flex flex-wrap items-center gap-4 rounded-2xl border border-zinc-200 bg-white/95 p-4 shadow-sm backdrop-blur">
      <button type="button" disabled={!dirty || saving} onClick={() => void save()} className="h-10 cursor-pointer rounded-lg bg-emerald-700 px-5 font-medium text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50">{saving ? "Guardando…" : "Guardar cambios"}</button>
      {dirty && !saving && <button type="button" onClick={() => { setSettings(JSON.parse(saved)); setMessage(null); }} className="h-10 cursor-pointer rounded-lg px-3 text-sm text-zinc-600 hover:bg-zinc-100">Descartar</button>}
      {message ? <p className={`text-sm ${message.tone === "ok" ? "text-emerald-700" : "text-red-700"}`}>{message.text}</p> : meta.updatedAt && <p className="text-sm text-zinc-500">Última modificación: {dateFormat.format(new Date(meta.updatedAt))}{meta.updatedBy ? ` · ${meta.updatedBy}` : ""}</p>}
    </div>
  </div>;
}

function normalize(raw: unknown): Settings {
  const value = (raw ?? {}) as Partial<Settings>;
  return {
    phone: value.phone ?? "",
    supportEmail: value.supportEmail ?? "",
    whatsapp: {
      number: value.whatsapp?.number ?? null,
      hours: value.whatsapp?.hours ?? null,
      schedule: { days: value.whatsapp?.schedule?.days ?? [1, 2, 3, 4, 5], from: value.whatsapp?.schedule?.from ?? "09:00", to: value.whatsapp?.schedule?.to ?? "15:00" },
    },
    notices: value.notices ?? null,
    teamEmails: { alerts: value.teamEmails?.alerts ?? [], tickets: value.teamEmails?.tickets ?? [], reports: value.teamEmails?.reports ?? [], quotes: value.teamEmails?.quotes ?? [] },
    priceAlerts: { minPercent: value.priceAlerts?.minPercent ?? 3, minEuros: value.priceAlerts?.minEuros ?? 1 },
  };
}

const euroExample = (value: number) => new Intl.NumberFormat("es-ES", { useGrouping: "always", style: "currency", currency: "EUR", minimumFractionDigits: Number.isInteger(value) ? 0 : 2 }).format(value);
