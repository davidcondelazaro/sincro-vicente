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
        <Section title="Altas e importador" text="Cada vuelta encola sola en «Altas automáticas» lo nuevo de MHD (y lo que se descartó por no tener fotos cuando MHD se las pone). El importador lo procesa y lo sube a la tienda. El tope de trabajadores protege la base de datos: con 12 trabajadores la dejaron sin conexiones (29-10).">
          <label className="flex items-center gap-3 text-sm font-medium text-zinc-800"><input type="checkbox" className="h-5 w-5 accent-emerald-700" checked={settings.auto_altas?.value !== false} onChange={(event) => void save("auto_altas", event.target.checked, event.target.checked ? "altas automáticas activas" : "altas automáticas en pausa")} />{settings.auto_altas?.value !== false ? "Altas automáticas activas" : "Altas automáticas en pausa"}</label>
          {stamp("auto_altas")}
          <NumberSetting label="Freno: si en una vuelta salen más altas que estas, no se encola nada y llega un aviso" suffix="altas" value={Number(settings.auto_altas_max?.value ?? 300)} step={1} onSave={(value) => save("auto_altas_max", value, "freno de altas")} />
          {stamp("auto_altas_max")}
          <NumberSetting label="Tope de trabajadores del importador (para cualquier tanda)" suffix="trabajadores" value={Number(settings.importer_max_workers?.value ?? 3)} step={1} onSave={(value) => save("importer_max_workers", value, "tope de trabajadores")} />
          {stamp("importer_max_workers")}
          <NumberSetting label="Productos a la vez por trabajador" suffix="productos" value={Number(settings.importer_max_concurrency?.value ?? 4)} step={1} onSave={(value) => save("importer_max_concurrency", value, "productos por trabajador")} />
          {stamp("importer_max_concurrency")}
        </Section>
        <Section title="Agotados en MHD" text="MHD quita de su listado lo que su proveedor no tiene y lo vuelve a poner cuando hay stock. Lo que deja de venir (confirmado uno a uno con MHD) pasa a stock 0 y deja de venderse sin stock, pero sigue publicado; si vuelve, se repone solo. Solo pasa a baja (archivar y redirigir) si no vuelve en estos días.">
          <NumberSetting label="Días agotado antes de pasar a baja" suffix="días" value={Number(settings.absence_days?.value ?? 30)} step={1} onSave={(value) => save("absence_days", value, "días hasta la baja")} />
          {stamp("absence_days")}
          <NumberSetting label="Freno: si en una vuelta desaparece más de este porcentaje de la tienda, no se toca nada y llega un aviso" suffix="%" value={Number(settings.absence_brake_pct?.value ?? 2)} step={0.5} onSave={(value) => save("absence_brake_pct", value, "freno de agotados")} />
          {stamp("absence_brake_pct")}
        </Section>
        <Section title="Portes y servicios de MHD" text="Cada vuelta lleva a Shopify los portes y servicios de cada producto. Los cambios se aplican siempre; esto solo decide si llega un correo cuando MHD quita un dato o sube un importe más de un 50 %.">
          <label className="flex items-center gap-3 text-sm font-medium text-zinc-800"><input type="checkbox" className="h-5 w-5 accent-emerald-700" checked={settings.delivery_changes_alert?.value !== false} onChange={(event) => void save("delivery_changes_alert", event.target.checked, event.target.checked ? "aviso de portes activo" : "aviso de portes apagado")} />{settings.delivery_changes_alert?.value !== false ? "Avisar de cambios fuertes de portes" : "Sin aviso de cambios de portes"}</label>
          {stamp("delivery_changes_alert")}
        </Section>
        <Section title="Proveedor de MHD" text="Cada vuelta lleva a Shopify el proveedor de cada producto (metacampos de los que cuelgan reglas). Si muchos cambian de proveedor a la vez puede ser un dato roto de MHD; si el cambio es real, sube este freno.">
          <NumberSetting label="Freno: si en una vuelta cambian de proveedor más productos que estos, no se envía nada y llega un aviso" suffix="productos" value={Number(settings.supplier_switch_max?.value ?? 300)} step={1} onSave={(value) => save("supplier_switch_max", value, "freno de proveedor")} />
          {stamp("supplier_switch_max")}
        </Section>
        <Section title="Resumen por correo" text="Lo hecho y lo que hay que mirar: vueltas, precio y stock, importador, cola de revisión y avisos.">
          <div className="flex flex-wrap gap-2">{([["hora", "Cada hora (mientras se estabiliza)"], ["diario", "Diario, a las 9:00"]] as const).map(([value, label]) => <button key={value} type="button" onClick={() => void save("report_frequency", value, `resumen ${value === "hora" ? "cada hora" : "diario"}`)} className={`h-10 rounded-lg px-4 text-sm font-medium ${settings.report_frequency?.value === value ? "bg-emerald-700 text-white" : "border border-zinc-300 bg-white text-zinc-700"}`}>{label}</button>)}</div>
          {stamp("report_frequency")}
          <Emails label="Destinatarios del resumen" value={settings.report_emails?.value} onSave={(list) => save("report_emails", list, "destinatarios del resumen")} />
          {stamp("report_emails")}
        </Section>
        <Section title="Pedidos MHD" text="Cada 15 minutos se traen los pedidos de Shopify (y se exportan los listos, si está encendido); cada 30 se leen los estados de MHD: facturas, cancelaciones y envíos. Lo que se enciende solo actúa a partir de ese momento.">
          <Toggle settings={settings} name="pedidos_exportar_auto_activo" on="Exportar a MHD automáticamente" off="Exportar a MHD: solo con el botón" save={save} cutoff="pedidos_exportar_auto_desde" />
          <NumberSetting label="Espera desde el pago antes de exportar (en ese rato es cuando más se cancela o corrige)" suffix="minutos" value={Number(settings.pedidos_exportar_margen_minutos?.value ?? 30)} step={1} onSave={(value) => save("pedidos_exportar_margen_minutos", value, "espera antes de exportar")} />
          {stamp("pedidos_exportar_margen_minutos")}
          <Toggle settings={settings} name="pedidos_envio_auto_activo" on="Marcar en Shopify los pedidos que MHD da por enviados (el cliente recibe el seguimiento)" off="Marcar envíos: solo con el botón" save={save} />
          <Toggle settings={settings} name="cancelar_en_shopify_activo" on="Cancelar en Shopify lo que MHD cancela (sin reembolso, avisando al cliente)" off="Cancelaciones de MHD: no se trasladan" save={save} cutoff="cancelar_en_shopify_desde" />
          <Toggle settings={settings} name="factura_correo_activo" on="Mandar al cliente la factura de MHD cuando llegue" off="Correo de factura apagado" save={save} cutoff="factura_correo_desde" />
          <NumberSetting label="Avisar de pedidos pagados sin exportar después de (lunes a viernes, de 9 a 20 h)" suffix="horas" value={Number(settings.pedidos_aviso_sin_exportar_horas?.value ?? 2)} step={0.5} onSave={(value) => save("pedidos_aviso_sin_exportar_horas", value, "aviso de pedidos sin exportar")} />
          {stamp("pedidos_aviso_sin_exportar_horas")}
          <Emails label="Destinatarios de los avisos de pedidos (al momento)" value={settings.pedidos_avisos_emails?.value} onSave={(list) => save("pedidos_avisos_emails", list, "destinatarios de los avisos de pedidos")} />
          {stamp("pedidos_avisos_emails")}
          <NumberSetting label="Hora del resumen diario de pedidos (hora de Madrid)" suffix=":00 h" value={Number(settings.pedidos_informe_hora?.value ?? 9)} step={1} onSave={(value) => save("pedidos_informe_hora", value, "hora del resumen de pedidos")} />
          {stamp("pedidos_informe_hora")}
          <Emails label="Destinatarios del resumen diario de pedidos" value={settings.pedidos_informe_emails?.value} onSave={(list) => save("pedidos_informe_emails", list, "destinatarios del resumen de pedidos")} />
          {stamp("pedidos_informe_emails")}
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

function Toggle({ settings, name, on, off, save, cutoff }: { settings: Record<string, Setting>; name: string; on: string; off: string; save: (key: string, value: unknown, label: string) => Promise<void>; cutoff?: string }) {
  const active = settings[name]?.value === true;
  const since = cutoff && typeof settings[cutoff]?.value === "string" ? when(String(settings[cutoff].value)) : null;
  return <div className="mt-4">
    <label className="flex items-center gap-3 text-sm font-medium text-zinc-800"><input type="checkbox" className="h-5 w-5 accent-emerald-700" checked={active} onChange={(event) => void save(name, event.target.checked, event.target.checked ? on : off)} />{active ? on : off}</label>
    {active && since && <p className="mt-1 ml-8 text-xs text-zinc-500">Desde el {since}.</p>}
    {settings[name]?.updated_by && <p className="mt-1 ml-8 text-xs text-zinc-500">Cambiado por {settings[name].updated_by} el {when(settings[name].updated_at)}.</p>}
  </div>;
}
