"use client";

import { useCallback, useEffect, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { createClient } from "@/lib/supabase/client";

// Google Merchant (David, 2026-11-17). Estado del envío a Merchant Center por la Merchant API (src/lib/merchant): portes y
// plazos por país, EPREL, inventario regional de las zonas sin envío, la cola con sus reintentos, la conciliación de
// cada noche y los avisos de Google. Solo lectura: el encendido y las pruebas van en store_settings (merchant_*).
type PorPais = { pais: string; enMerchant: number; conPortes: number; sinPorte: number; regionalPorQuitar: number };
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
  const [cargadoEn, setCargadoEn] = useState(0);

  const cargar = useCallback(async () => {
    try {
      const respuesta = await fetch("/api/merchant/estado", { cache: "no-store" });
      const cuerpo = await respuesta.json(); if (!respuesta.ok) throw new Error(cuerpo.error ?? "No se pudo leer el estado.");
      setEstado(cuerpo); setCargadoEn(Date.now()); setError(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Error inesperado."); }
  }, []);
  useEffect(() => {
    const primero = window.setTimeout(() => void cargar(), 0);
    createClient().auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    return () => window.clearTimeout(primero);
  }, [cargar]);
  // Con cola pendiente, la pantalla se refresca sola cada 20 segundos.
  const conCola = (estado?.cola.total ?? 0) > 0;
  useEffect(() => {
    if (!conCola) return;
    const reloj = window.setInterval(() => void cargar(), 20_000);
    return () => window.clearInterval(reloj);
  }, [conCola, cargar]);

  const avisos = ((estado?.avisos?.detail.avisos ?? []) as Aviso[]);
  const importantes = avisos.filter((item) => item.importante);
  // Progreso: ofertas con portes mandados sobre las que hay en Merchant Center (España, que es igual que Portugal), y
  // ritmo de la última hora para estimar cuándo se vacía la cola.
  const es = estado?.porPais.find((item) => item.pais === "ES");
  const total = es?.enMerchant ?? 0;
  const hechas = Math.min(es?.conPortes ?? 0, total);
  const porcentaje = total ? Math.floor((100 * hechas) / total) : 0;
  const haceUnaHora = new Date(cargadoEn - 3_600_000).toISOString();
  const ritmo = (estado?.vueltas ?? []).filter((item) => item.kind === "vuelta" && item.created_at >= haceUnaHora).reduce((suma, item) => suma + Number((item.detail as Record<string, number>).productos ?? 0), 0);
  // Lo que Google ya aplica: ofertas de España sin aviso de portes, regiones ni EPREL en la última lectura (cada hora).
  const lectura = estado?.avisos?.detail as { ofertasPorPais?: Record<string, number>; conAvisoPortes?: Record<string, number>; atrasadas?: { total: number; ejemplos: string[] } } | undefined;
  const totalGoogle = lectura?.ofertasPorPais?.ES ?? 0;
  const bienGoogle = Math.max(0, totalGoogle - (lectura?.conAvisoPortes?.ES ?? 0));
  const porcentajeGoogle = totalGoogle ? Math.floor((100 * bienGoogle) / totalGoogle) : 0;
  const atrasadas = lectura?.atrasadas?.total ?? 0;
  const fin = conCola && ritmo ? new Date(cargadoEn + (estado!.cola.total / ritmo) * 3_600_000).toLocaleTimeString("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit" }) : null;
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
        {estado.ajustes.activo && total > 0 && <section aria-label="Progreso" className="rounded-xl border border-zinc-200 bg-white p-4">
          <div className="mb-2 flex justify-between text-sm font-medium"><span>{n(hechas)} de {n(total)} productos con portes en Merchant Center</span><span>{porcentaje}%</span></div>
          <div className="h-3 overflow-hidden rounded-full bg-zinc-100"><div className="h-full bg-emerald-600 transition-all" style={{ width: `${porcentaje}%` }} /></div>
          <p className="mt-3 text-sm text-zinc-600">{conCola ? `Quedan ${n(estado.cola.total)} en la cola${ritmo ? ` · ${n(ritmo)} por hora · termina hacia las ${fin}` : " · calculando el ritmo…"}. Se actualiza solo.` : "Cola vacía: todo al día."}</p>
          {totalGoogle > 0 && estado.avisos && <div className="mt-5 border-t border-zinc-100 pt-4">
            <div className="mb-2 flex justify-between text-sm font-medium"><span>{n(bienGoogle)} de {n(totalGoogle)} que Google ya da por buenos (sin aviso de portes, regiones ni EPREL)</span><span>{porcentajeGoogle}%</span></div>
            <div className="h-3 overflow-hidden rounded-full bg-zinc-100"><div className="h-full bg-sky-600 transition-all" style={{ width: `${porcentajeGoogle}%` }} /></div>
            <p className={`mt-3 text-sm ${atrasadas ? "font-medium text-red-800" : "text-zinc-600"}`}>{atrasadas ? `${n(atrasadas)} mandados hace más de una hora siguen con aviso en Google: ${lectura?.atrasadas?.ejemplos.join(", ")}.` : "Todo lo mandado hace más de una hora está aplicado en Google."} Leído en Google el {cuando(estado.avisos.created_at)}; se lee cada hora.</p>
          </div>}
        </section>}
        <section aria-label="Por país" className="grid gap-3 sm:grid-cols-2">
          {estado.porPais.map((item) => <div key={item.pais} className="rounded-xl border border-zinc-200 bg-white p-4">
            <h2 className="font-semibold text-zinc-950">{NOMBRE[item.pais] ?? item.pais}</h2>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <dt className="text-zinc-600">Ofertas en Merchant Center</dt><dd className="text-right font-medium">{n(item.enMerchant)}</dd>
              <dt className="text-zinc-600">Con portes mandados</dt><dd className="text-right font-medium">{n(item.conPortes)}</dd>
              <dt className="text-zinc-600">Sin porte conocido</dt><dd className={`text-right font-medium ${item.sinPorte ? "text-amber-700" : ""}`}>{n(item.sinPorte)}</dd>
              <dt className="text-zinc-600">Agotado regional por quitar</dt><dd className={`text-right font-medium ${item.regionalPorQuitar ? "text-amber-700" : ""}`}>{n(item.regionalPorQuitar)}</dd>
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
            <thead className="text-zinc-500"><tr><th className="py-1 pr-4">Hora</th><th className="pr-4 text-right">Productos</th><th className="pr-4 text-right">Mandados</th><th className="pr-4 text-right">Regionales quitados</th><th className="pr-4 text-right">Aún no están</th><th>Errores</th></tr></thead>
            <tbody>{estado.vueltas.map((item) => { const d = item.detail as Record<string, number | string[]>; return <tr key={item.created_at} className="border-t border-zinc-100"><td className="py-1 pr-4">{cuando(item.created_at)}</td><td className="pr-4 text-right">{n(Number(d.productos ?? 0))}</td><td className="pr-4 text-right">{n(Number(d.enviados ?? 0))}</td><td className="pr-4 text-right">{n(Number(d.regionales ?? 0))}</td><td className="pr-4 text-right">{n(Number(d.noEstan ?? 0))}</td><td className="text-red-800">{(d.errores as string[] | undefined)?.slice(0, 2).join(" · ")}</td></tr>; })}</tbody>
          </table></div>}
        </section>
      </>}
    </main>
  </div>;
}
