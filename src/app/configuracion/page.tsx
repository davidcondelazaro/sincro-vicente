"use client";

import { useCallback, useEffect, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { createClient } from "@/lib/supabase/client";

// Configuración de las sincronizaciones (2026-10-29): destinatarios de los correos, frecuencia del resumen y pausa de
// las vueltas. Cada ajuste se guarda por separado (store_settings); lo que toca a la programación lo aplica la base.
type Setting = { key: string; value: unknown; updated_by: string | null; updated_at: string };
const when = (iso: string) => new Date(iso).toLocaleString("es-ES", { timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "short" });

export default function SettingsPage() {
  const [email, setEmail] = useState<string | null>(null);
  const [settings, setSettings] = useState<Record<string, Setting> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/configuracion", { cache: "no-store" });
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "No se pudo leer la configuración.");
      setSettings(body.settings);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Error inesperado."); }
  }, []);
  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    createClient().auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    return () => window.clearTimeout(first);
  }, [load]);

  async function save(key: string, value: unknown, label: string) {
    setError(null); setSaved(null);
    try {
      const response = await fetch("/api/configuracion", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, value }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "No se pudo guardar.");
      setSaved(`Guardado: ${label}.`); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Error inesperado."); }
  }

  const stamp = (key: string) => settings?.[key]?.updated_by ? <p className="mt-2 text-xs text-zinc-500">Cambiado por {settings[key].updated_by} el {when(settings[key].updated_at)}.</p> : null;
  return <div className="min-h-screen bg-zinc-50 lg:grid lg:grid-cols-[17.5rem_minmax(0,1fr)]"><AppSidebar active="storeSettings" userEmail={email} />
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 pb-24 pt-28 sm:px-10 lg:mx-0 lg:py-16">
      <header><h1 className="text-4xl font-semibold tracking-tight text-zinc-950">Configuración</h1><p className="mt-3 max-w-3xl text-zinc-600">Ajustes de las sincronizaciones con MHD y de sus correos. Cada uno se guarda por separado y se aplica al momento.</p></header>
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">{error}</p>}
      {saved && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">{saved}</p>}
      {!settings ? <p className="text-sm text-zinc-500">Cargando…</p> : <>
        <Section title="Sincronización con MHD" text="Las vueltas de cada 30 minutos: conexiones, lectura del listado de MHD y precio y stock a Shopify. En pausa no se lee ni se envía nada (los avisos de esa parte dejan de llegar).">
          <label className="flex items-center gap-3 text-sm font-medium text-zinc-800"><input type="checkbox" className="h-5 w-5 accent-emerald-700" checked={settings.sync_enabled?.value === true} onChange={(event) => void save("sync_enabled", event.target.checked, event.target.checked ? "vueltas activas" : "vueltas en pausa")} />{settings.sync_enabled?.value === true ? "Activa: una vuelta cada 30 minutos" : "En pausa"}</label>
          {stamp("sync_enabled")}
        </Section>
        <Section title="Agotados en MHD" text="MHD quita de su listado lo que su proveedor no tiene y lo vuelve a poner cuando hay stock. Lo que deja de venir (confirmado uno a uno con MHD) pasa a stock 0 y deja de venderse sin stock, pero sigue publicado; si vuelve, se repone solo. Solo pasa a baja (archivar y redirigir) si no vuelve en estos días.">
          <NumberSetting label="Días agotado antes de pasar a baja" suffix="días" value={Number(settings.absence_days?.value ?? 30)} step={1} onSave={(value) => save("absence_days", value, "días hasta la baja")} />
          {stamp("absence_days")}
          <NumberSetting label="Freno: si en una vuelta desaparece más de este porcentaje de la tienda, no se toca nada y llega un aviso" suffix="%" value={Number(settings.absence_brake_pct?.value ?? 2)} step={0.5} onSave={(value) => save("absence_brake_pct", value, "freno de agotados")} />
          {stamp("absence_brake_pct")}
        </Section>
        <Section title="Resumen por correo" text="Lo hecho y lo que hay que mirar: vueltas, precio y stock, importador, cola de revisión y avisos.">
          <div className="flex flex-wrap gap-2">{([["hora", "Cada hora (mientras se estabiliza)"], ["diario", "Diario, a las 9:00"]] as const).map(([value, label]) => <button key={value} type="button" onClick={() => void save("report_frequency", value, `resumen ${value === "hora" ? "cada hora" : "diario"}`)} className={`h-10 rounded-lg px-4 text-sm font-medium ${settings.report_frequency?.value === value ? "bg-emerald-700 text-white" : "border border-zinc-300 bg-white text-zinc-700"}`}>{label}</button>)}</div>
          {stamp("report_frequency")}
          <Emails label="Destinatarios del resumen" value={settings.report_emails?.value} onSave={(list) => save("report_emails", list, "destinatarios del resumen")} />
          {stamp("report_emails")}
        </Section>
        <Section title="Avisos graves" text="Al momento, como mucho uno por motivo cada hora: sin conexión con un servicio, lectura de MHD fallida, precio y stock parados o con errores, importador parado por el freno, vuelta atascada.">
          <Emails label="Destinatarios de los avisos" value={settings.alert_emails?.value} onSave={(list) => save("alert_emails", list, "destinatarios de los avisos")} />
          {stamp("alert_emails")}
        </Section>
      </>}
    </main></div>;
}

function Section({ title, text, children }: { title: string; text: string; children: React.ReactNode }) {
  return <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm"><h2 className="text-lg font-semibold text-zinc-950">{title}</h2><p className="mt-1 mb-4 text-sm text-zinc-600">{text}</p>{children}</section>;
}

function Emails({ label, value, onSave }: { label: string; value: unknown; onSave: (list: string[]) => Promise<void> }) {
  const initial = Array.isArray(value) ? (value as string[]).join(", ") : "";
  const [text, setText] = useState(initial);
  const list = text.split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean);
  return <form className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={(event) => { event.preventDefault(); void onSave(list); }}>
    <label className="flex-1 text-sm font-medium text-zinc-700">{label}<input value={text} onChange={(event) => setText(event.target.value)} placeholder="correo@ejemplo.com, otro@ejemplo.com" className="mt-1 block h-10 w-full rounded-lg border border-zinc-300 px-3" /></label>
    <button type="submit" disabled={!list.length || text === initial} className="h-10 rounded-lg bg-emerald-700 px-4 text-sm font-medium text-white disabled:opacity-40">Guardar</button>
  </form>;
}

function NumberSetting({ label, suffix, value, step, onSave }: { label: string; suffix: string; value: number; step: number; onSave: (value: number) => Promise<void> }) {
  const [text, setText] = useState(String(value));
  const number = Number(text.replace(",", "."));
  return <form className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end" onSubmit={(event) => { event.preventDefault(); void onSave(number); }}>
    <label className="flex-1 text-sm font-medium text-zinc-700">{label}<span className="mt-1 flex items-center gap-2"><input inputMode="decimal" value={text} onChange={(event) => setText(event.target.value)} step={step} className="block h-10 w-28 rounded-lg border border-zinc-300 px-3" /><span className="text-zinc-500">{suffix}</span></span></label>
    <button type="submit" disabled={!Number.isFinite(number) || number === value} className="h-10 rounded-lg bg-emerald-700 px-4 text-sm font-medium text-white disabled:opacity-40">Guardar</button>
  </form>;
}
