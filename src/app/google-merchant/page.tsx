"use client";

import { useCallback, useEffect, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { createClient } from "@/lib/supabase/client";

// Google Merchant (David, 2026-11-17). Estado del envío a Merchant Center por la Merchant API (src/lib/merchant): portes y
// plazos por país, EPREL, inventario regional de las zonas sin envío, la cola con sus reintentos, la conciliación de
// cada noche y los avisos de Google. Solo lectura: el encendido y las pruebas van en store_settings (merchant_*).
type PorPais = { pais: string; enMerchant: number; conPortes: number; sinPorte: number; regionalVencido: number };
type Evento = { kind: string; created_at: string; detail: Record<string, unknown> };
type Aviso = { codigo: string; porPais: Record<string, number>; total: number; ejemplos: string[]; importante: boolean };
type Estado = {
  ajustes: { activo: boolean; soloCodigos: string[]; fuentes: Record<string, string> };
  porPais: PorPais[];
  cola: { total: number; atascados: number; listaAtascados: { codigo: string; motivo: string; intentos: number; ultimo_error: string | null; siguiente_at: string }[] };
  conciliacion: Evento | null;
  avisos: Evento | null;
  vueltas: Evento[];
};

const n = (valor: number) => new Intl.NumberFormat("es-ES", { useGrouping: "always" }).format(valor);
const cuando = (iso: string) => new Date(iso).toLocaleString("es-ES", { timeZone: "Europe/Madrid", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const NOMBRE: Record<string, string> = { ES: "España", PT: "Portugal" };

export default function GoogleMerchantPage() {
  const [email, setEmail] = useState<string | null>(null);
  const [estado, setEstado] = useState<Estado | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const respuesta = await fetch("/api/merchant/estado", { cache: "no-store" });
      const cuerpo = await respuesta.json(); if (!respuesta.ok) throw new Error(cuerpo.error ?? "No se pudo leer el estado.");
      setEstado(cuerpo); setError(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Error inesperado."); }
  }, []);
  useEffect(() => {
    const primero = window.setTimeout(() => void cargar(), 0);
    createClient().auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    return () => window.clearTimeout(primero);
  }, [cargar]);

  const avisos = ((estado?.avisos?.detail.avisos ?? []) as Aviso[]);
  const importantes = avisos.filter((item) => item.importante);
  return <div className="min-h-screen bg-zinc-50 lg:grid lg:grid-cols-[17.5rem_minmax(0,1fr)]"><AppSidebar active="googleMerchant" userEmail={email} />
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 pb-24 pt-28 sm:px-10 lg:mx-0 lg:py-16">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div><h1 className="text-4xl font-semibold tracking-tight text-zinc-950">Google Merchant</h1>
          <p className="mt-3 max-w-3xl text-zinc-600">Portes, plazos y etiqueta energética de cada producto en Merchant Center, y las zonas sin envío (Canarias, Ceuta, Melilla, Azores y Madeira) como agotadas. Se manda al momento por la cola y se repasa todo cada noche.</p></div>
        <button type="button" onClick={() => void cargar()} className="h-10 rounded-lg border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-700">Actualizar</button>
      </header>
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">{error}</p>}
      {!estado ? !error && <p className="text-sm text-zinc-500">Cargando…</p> : <>
        <p className={`rounded-lg border p-4 text-sm ${estado.ajustes.activo ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
          {estado.ajustes.activo ? estado.ajustes.soloCodigos.length ? `Encendido en prueba: solo ${estado.ajustes.soloCodigos.length} productos (${estado.ajustes.soloCodigos.join(", ")}).` : "Encendido para todo el catálogo." : "Apagado: no se manda nada a Merchant Center."}
        </p>
        <section aria-label="Por país" className="grid gap-3 sm:grid-cols-2">
          {estado.porPais.map((item) => <div key={item.pais} className="rounded-xl border border-zinc-200 bg-white p-4">
            <h2 className="font-semibold text-zinc-950">{NOMBRE[item.pais] ?? item.pais}</h2>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-zinc-600">Ofertas en Merchant Center</dt><dd className="text-right font-medium">{n(item.enMerchant)}</dd>
              <dt className="text-zinc-600">Con portes mandados</dt><dd className="text-right font-medium">{n(item.conPortes)}</dd>
              <dt className="text-zinc-600">Sin porte conocido</dt><dd className={`text-right font-medium ${item.sinPorte ? "text-amber-700" : ""}`}>{n(item.sinPorte)}</dd>
              <dt className="text-zinc-600">Regional a punto de caducar</dt><dd className={`text-right font-medium ${item.regionalVencido ? "text-red-700" : ""}`}>{n(item.regionalVencido)}</dd>
            </dl>
          </div>)}
        </section>
        <section className="rounded-xl border border-zinc-200 bg-white p-4">
          <h2 className="font-semibold text-zinc-950">Cola</h2>
          <p className="mt-2 text-sm text-zinc-600">{n(estado.cola.total)} productos pendientes · {n(estado.cola.atascados)} reintentando desde hace horas.</p>
          {estado.cola.listaAtascados.length > 0 && <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm">
            <thead className="text-zinc-500"><tr><th className="py-1 pr-4">Código</th><th className="pr-4">Intentos</th><th className="pr-4">Próximo</th><th>Motivo</th></tr></thead>
            <tbody>{estado.cola.listaAtascados.map((item) => <tr key={item.codigo} className="border-t border-zinc-100"><td className="py-1 pr-4">{item.codigo}</td><td className="pr-4">{item.intentos}</td><td className="pr-4">{cuando(item.siguiente_at)}</td><td>{item.ultimo_error ?? item.motivo}</td></tr>)}</tbody>
          </table></div>}
        </section>
        <section className="rounded-xl border border-zinc-200 bg-white p-4">
          <h2 className="font-semibold text-zinc-950">Avisos de Google</h2>
          {!estado.avisos ? <p className="mt-2 text-sm text-zinc-600">Aún no se han leído.</p> : <>
            <p className="mt-2 text-sm text-zinc-600">Leídos el {cuando(estado.avisos.created_at)} en {n(Number(estado.avisos.detail.ofertas ?? 0))} ofertas. {importantes.length ? `${importantes.length} tipos de aviso de portes, regiones o certificación.` : "Ninguno de portes, regiones ni certificación."}</p>
            {avisos.length > 0 && <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm">
              <thead className="text-zinc-500"><tr><th className="py-1 pr-4">Aviso</th><th className="pr-4 text-right">España</th><th className="pr-4 text-right">Portugal</th><th className="text-right">Total</th></tr></thead>
              <tbody>{avisos.map((item) => <tr key={item.codigo} className={`border-t border-zinc-100 ${item.importante ? "font-medium text-red-800" : ""}`}><td className="py-1 pr-4">{item.codigo}</td><td className="pr-4 text-right">{n(item.porPais.ES ?? 0)}</td><td className="pr-4 text-right">{n(item.porPais.PT ?? 0)}</td><td className="text-right">{n(item.total)}</td></tr>)}</tbody>
            </table></div>}
          </>}
        </section>
        <section className="rounded-xl border border-zinc-200 bg-white p-4">
          <h2 className="font-semibold text-zinc-950">Últimas vueltas</h2>
          <p className="mt-2 text-sm text-zinc-600">{estado.conciliacion ? `Última conciliación: ${cuando(estado.conciliacion.created_at)}, ${n(Number((estado.conciliacion.detail.ofertas as Record<string, number> | undefined)?.ES ?? 0))} ofertas en España y ${n(Number((estado.conciliacion.detail.ofertas as Record<string, number> | undefined)?.PT ?? 0))} en Portugal.` : "Aún no se ha hecho ninguna conciliación."}</p>
          {estado.vueltas.length > 0 && <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm">
            <thead className="text-zinc-500"><tr><th className="py-1 pr-4">Hora</th><th className="pr-4 text-right">Productos</th><th className="pr-4 text-right">Mandados</th><th className="pr-4 text-right">Regionales</th><th className="pr-4 text-right">Aún no están</th><th>Errores</th></tr></thead>
            <tbody>{estado.vueltas.map((item) => { const d = item.detail as Record<string, number | string[]>; return <tr key={item.created_at} className="border-t border-zinc-100"><td className="py-1 pr-4">{cuando(item.created_at)}</td><td className="pr-4 text-right">{n(Number(d.productos ?? 0))}</td><td className="pr-4 text-right">{n(Number(d.enviados ?? 0))}</td><td className="pr-4 text-right">{n(Number(d.regionales ?? 0))}</td><td className="pr-4 text-right">{n(Number(d.noEstan ?? 0))}</td><td className="text-red-800">{(d.errores as string[] | undefined)?.slice(0, 2).join(" · ")}</td></tr>; })}</tbody>
          </table></div>}
        </section>
      </>}
    </main>
  </div>;
}
