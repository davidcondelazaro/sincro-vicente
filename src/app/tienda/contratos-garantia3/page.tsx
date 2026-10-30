"use client";

import { useCallback, useEffect, useState } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { createClient } from "@/lib/supabase/client";

// Altas de contratos de Garantía3 (docs/GARANTIA3.md): ajustes, estado de cada unidad vendida y acciones manuales.
type Ajustes = { modo: "test" | "produccion"; dias: number; desde: string; incidencias: string[]; resumen: string[] };
type Contrato = { id: string; shopify_order_name: string; unidad: number; sku: string; ean13: string; sku_aparato: string | null; nombre: string | null; apellidos: string | null; email: string | null; telefono: string | null; fecha_inicio: string | null; origen_fecha: string | null; fecha_prevista: string | null; estado: string; motivo: string | null; modo: string; contrato: string | null; pin: string | null; fecha_alta: string | null };
type Vuelta = { origen: string; modo: string; inicio: string; fin: string | null; resumen: { creadas?: number; fallos?: string[] } | null };

const ESTADOS: Record<string, string> = { espera: "En espera", lista: "Lista", enviando: "Enviando", creado: "Creado", error: "Error", dudoso: "Dudoso", bloqueado: "Bloqueado", anulacion_pendiente: "Por anular", anulado: "Anulado" };
const COLORES: Record<string, string> = { creado: "bg-emerald-100 text-emerald-900", error: "bg-red-100 text-red-800", dudoso: "bg-amber-100 text-amber-900", bloqueado: "bg-zinc-200 text-zinc-800", anulacion_pendiente: "bg-amber-100 text-amber-900" };
const fecha = (value: string | null) => (value ? new Date(value).toLocaleDateString("es-ES", { timeZone: "Europe/Madrid" }) : "—");
const fechaHora = (value: string | null) => (value ? new Date(value).toLocaleString("es-ES", { timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "short" }) : "—");
const input = "mt-1 block h-10 rounded-lg border border-zinc-300 bg-white px-3 text-sm";
const correoAnulacion = (fila: Contrato) => `mailto:info@bcwm.es?subject=${encodeURIComponent("Solicitud de anulación de garantía")}&body=${encodeURIComponent(`Estimados:\n\nSolicitamos la anulación de la siguiente garantía:\n\nContrato: ${fila.contrato}\nProducto: ${fila.sku}\nEAN: ${fila.ean13}\nPedido: ${fila.shopify_order_name}\n\nUn saludo.`)}`;

export default function ContratosGarantia3Page() {
  const [email, setEmail] = useState<string | null>(null); const [ajustes, setAjustes] = useState<Ajustes | null>(null); const [contratos, setContratos] = useState<Contrato[]>([]); const [vuelta, setVuelta] = useState<Vuelta | null>(null);
  const [proxy, setProxy] = useState(false); const [filtro, setFiltro] = useState(""); const [busy, setBusy] = useState<string | null>(null); const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null);
  const [incidencias, setIncidencias] = useState(""); const [resumen, setResumen] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/garantia3", { cache: "no-store" }); const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "No se pudieron leer los contratos.");
    setAjustes(body.ajustes); setContratos(body.contratos ?? []); setVuelta(body.vuelta); setProxy(body.proxyConfigurado);
    setIncidencias(body.ajustes.incidencias.join(", ")); setResumen(body.ajustes.resumen.join(", "));
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- Carga inicial desde la API, como las demás pantallas.
  useEffect(() => { void load().catch((caught: Error) => setError(caught.message)); }, [load]);
  useEffect(() => { createClient().auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null)); }, []);

  async function post(action: string, payload: Record<string, unknown> = {}, key = action) {
    setBusy(key); setError(null); setNotice(null);
    try {
      const response = await fetch("/api/garantia3", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...payload }) }); const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "No se pudo completar.");
      await load();
      return body;
    } catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudo completar."); return null; } finally { setBusy(null); }
  }
  async function guardar(key: string, value: unknown) { if (await post("ajustes", { key, value }, key)) setNotice("Guardado."); }
  const separar = (texto: string) => texto.split(/[,\s;]+/).map((item) => item.trim()).filter(Boolean);
  async function cambiarModo(modo: Ajustes["modo"]) {
    if (modo === "produccion" && !window.confirm("En producción cada alta es un contrato real que se paga. ¿Pasar a producción?")) return;
    await guardar("garantia3_modo", modo);
  }
  async function lanzar() {
    const body = await post("vuelta");
    if (body) setNotice(`Vuelta terminada: ${body.nuevas} nuevas, ${body.creadas} creadas, ${body.bloqueadas} bloqueadas, ${body.dudosas} dudosas, ${body.errores} con error.${body.fallos.length ? ` Fallos: ${body.fallos.join(" · ")}` : ""}`);
  }
  async function prueba() { const body = await post("prueba"); if (body) setNotice(`Pedido de prueba ${body.pedido}: ${ESTADOS[body.estado] ?? body.estado}, contrato simulado ${body.contrato}.`); }
  async function comprobar() { const body = await post("comprobar"); if (body) setNotice(body.correcto ? "Conexión correcta: token e IP autorizados." : `Garantía3 respondió ${body.garantia3}: revisa token e IP.`); }
  async function pedirYa(fila: Contrato) { if (window.confirm(`¿Pedir ya el contrato de ${fila.shopify_order_name}, sin esperar los días?`)) await post("pedir_ya", { id: fila.id }, fila.id); }
  async function resolverDudoso(fila: Contrato) {
    const contrato = window.prompt("Mira el contrato en el portal. Si se creó, pega aquí su número. Déjalo vacío si no se creó: se volverá a pedir.");
    if (contrato === null) return;
    await post(contrato.trim() ? "dudoso_creado" : "dudoso_no_creado", { id: fila.id, contrato }, fila.id);
  }

  const shown = contratos.filter((fila) => !filtro || fila.estado === filtro);
  const cuantos = (estados: string[]) => contratos.filter((fila) => estados.includes(fila.estado)).length;
  return <div className="min-h-screen bg-zinc-50 lg:grid lg:grid-cols-[17.5rem_minmax(0,1fr)]"><AppSidebar active="warrantyContracts" userEmail={email} /><main className="mx-auto flex w-full max-w-6xl min-w-0 flex-col gap-6 px-4 pb-24 pt-28 sm:px-10 lg:mx-0 lg:py-16">
    <header><h1 className="text-4xl font-semibold tracking-tight">Contratos Garantía3</h1><p className="mt-3 max-w-3xl text-zinc-600">Pide a Garantía3 el contrato de cada ampliación vendida, pasados los días de espera desde que MHD envía el pedido. Al cliente le escribe Garantía3.</p></header>
    {error && <p className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">{error}</p>}
    {notice && <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">{notice}</p>}
    {ajustes?.modo === "test" && <p className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900"><b>Modo test.</b> Se hace todo el recorrido, pero no se llama a Garantía3 y los contratos son simulados.</p>}

    <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Stat label="En espera" value={cuantos(["espera", "lista"])} />
      <Stat label="Creados" value={cuantos(["creado"])} />
      <Stat label="Necesitan revisión" value={cuantos(["error", "dudoso", "bloqueado"])} warn={cuantos(["error", "dudoso"]) > 0} />
      <Stat label="Por anular" value={cuantos(["anulacion_pendiente"])} warn={cuantos(["anulacion_pendiente"]) > 0} />
    </section>

    {ajustes && <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold">Ajustes</h2>
      <div className="mt-4 flex flex-wrap items-end gap-4">
        <div className="text-sm font-medium text-zinc-700">Modo<div className="mt-1 inline-flex h-10 overflow-hidden rounded-lg border border-zinc-300">{(["test", "produccion"] as const).map((modo) => <button key={modo} type="button" disabled={Boolean(busy) || ajustes.modo === modo} onClick={() => void cambiarModo(modo)} className={`px-4 text-sm ${ajustes.modo === modo ? (modo === "test" ? "bg-amber-100 font-semibold text-amber-900" : "bg-emerald-100 font-semibold text-emerald-900") : "bg-white text-zinc-600 hover:bg-zinc-50"}`}>{modo === "test" ? "Test" : "Producción"}</button>)}</div></div>
        <label className="text-sm font-medium text-zinc-700">Días desde Enviado<input key={ajustes.dias} type="number" min={0} max={365} defaultValue={ajustes.dias} onBlur={(event) => { const dias = Number(event.target.value); if (dias !== ajustes.dias) void guardar("garantia3_dias", dias); }} className={`${input} w-28`} /></label>
        <label className="text-sm font-medium text-zinc-700">Pedidos desde<input key={ajustes.desde} type="date" defaultValue={ajustes.desde} onBlur={(event) => { if (event.target.value && event.target.value !== ajustes.desde) void guardar("garantia3_desde", event.target.value); }} className={input} /></label>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium text-zinc-700">Correos de incidencias<input value={incidencias} onChange={(event) => setIncidencias(event.target.value)} onBlur={() => { if (separar(incidencias).join() !== ajustes.incidencias.join()) void guardar("garantia3_emails_incidencias", separar(incidencias)); }} className={`${input} w-full`} placeholder="uno@…, otro@…" /></label>
        <label className="text-sm font-medium text-zinc-700">Correos de resúmenes<input value={resumen} onChange={(event) => setResumen(event.target.value)} onBlur={() => { if (separar(resumen).join() !== ajustes.resumen.join()) void guardar("garantia3_emails_resumen", separar(resumen)); }} className={`${input} w-full`} placeholder="uno@…, otro@…" /></label>
      </div>
      <p className="mt-2 text-xs text-zinc-500">Quien recibe los resúmenes resuelve dudosos y anulaciones y revisa el cuadre mensual. Si una lista está vacía, los correos van a los avisos generales.</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void lanzar()} disabled={Boolean(busy)} className="h-10 rounded-lg bg-emerald-700 px-4 text-sm font-medium text-white disabled:opacity-50">{busy === "vuelta" ? "En marcha…" : "Lanzar vuelta ahora"}</button>
        {ajustes.modo === "test" && <button type="button" onClick={() => void prueba()} disabled={Boolean(busy)} className="h-10 rounded-lg border border-amber-300 bg-amber-50 px-4 text-sm font-medium text-amber-900 disabled:opacity-50">{busy === "prueba" ? "Enviando…" : "Enviar pedido de prueba"}</button>}
        <button type="button" onClick={() => void comprobar()} disabled={Boolean(busy) || !proxy} className="h-10 rounded-lg border border-zinc-300 px-4 text-sm font-medium disabled:opacity-50">Comprobar conexión</button>
        <a href="/api/garantia3?csv=1" className="flex h-10 items-center rounded-lg border border-zinc-300 px-4 text-sm font-medium">Exportar CSV</a>
        {!proxy && <p className="text-sm text-zinc-500">Proxy sin configurar.</p>}
        {vuelta && <p className="ml-auto text-sm text-zinc-500">Última vuelta: {fechaHora(vuelta.fin ?? vuelta.inicio)} ({vuelta.origen})</p>}
      </div>
    </section>}

    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3"><h2 className="text-lg font-semibold">Contratos</h2>
        <label className="text-sm font-medium text-zinc-700">Estado<select value={filtro} onChange={(event) => setFiltro(event.target.value)} className={input}><option value="">Todos</option>{Object.entries(ESTADOS).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label></div>
      <div className="overflow-auto rounded-2xl border border-zinc-200 bg-white shadow-sm"><table className="min-w-full text-sm"><thead className="bg-zinc-50 text-left text-zinc-600"><tr>
        <th className="px-4 py-3 font-medium">Pedido</th><th className="px-4 py-3 font-medium">Garantía</th><th className="px-4 py-3 font-medium">Cliente</th><th className="px-4 py-3 font-medium">Enviado</th><th className="px-4 py-3 font-medium">Se pide</th><th className="px-4 py-3 font-medium">Estado</th><th className="px-4 py-3 font-medium">Contrato y PIN</th><th className="px-4 py-3" />
      </tr></thead><tbody className="divide-y divide-zinc-100">{shown.map((fila) => <tr key={fila.id} className="align-top">
        <td className="whitespace-nowrap px-4 py-3 text-zinc-900">{fila.shopify_order_name}{fila.unidad > 1 && <span className="text-zinc-400"> · ud. {fila.unidad}</span>}</td>
        <td className="whitespace-nowrap px-4 py-3 text-zinc-700">{fila.sku}<div className="text-xs text-zinc-400">{fila.sku_aparato ?? "Sin aparato"}</div></td>
        <td className="px-4 py-3 text-zinc-700">{[fila.nombre, fila.apellidos].filter(Boolean).join(" ") || "—"}<div className="text-xs text-zinc-400">{fila.email} {fila.telefono}</div></td>
        <td className="whitespace-nowrap px-4 py-3 text-zinc-700">{fecha(fila.fecha_inicio)}{fila.origen_fecha === "Recogida en tienda" && <div className="text-xs text-zinc-400">Recogida</div>}</td>
        <td className="whitespace-nowrap px-4 py-3 text-zinc-700">{fecha(fila.fecha_prevista)}</td>
        <td className="px-4 py-3"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${COLORES[fila.estado] ?? "bg-zinc-100 text-zinc-700"}`}>{ESTADOS[fila.estado] ?? fila.estado}</span>{fila.modo === "test" && <span className="ml-1 text-xs text-amber-700">test</span>}{fila.motivo && <div className="mt-1 max-w-[16rem] text-xs text-zinc-500">{fila.motivo}</div>}</td>
        <td className="px-4 py-3 font-mono text-xs text-zinc-700">{fila.contrato ?? "—"}{fila.pin && <div>{fila.pin}</div>}</td>
        <td className="whitespace-nowrap px-4 py-3 text-right text-sm">
          {fila.estado === "espera" && <button type="button" onClick={() => void pedirYa(fila)} disabled={Boolean(busy)} className="text-emerald-800 hover:underline disabled:opacity-50">Pedir ya</button>}
          {["error", "bloqueado"].includes(fila.estado) && <button type="button" onClick={() => void post("reintentar", { id: fila.id }, fila.id)} disabled={Boolean(busy)} className="text-emerald-800 hover:underline disabled:opacity-50">Reintentar</button>}
          {fila.estado === "dudoso" && <button type="button" onClick={() => void resolverDudoso(fila)} disabled={Boolean(busy)} className="text-emerald-800 hover:underline disabled:opacity-50">Resolver</button>}
          {fila.estado === "creado" && <button type="button" onClick={() => void post("anular", { id: fila.id }, fila.id)} disabled={Boolean(busy)} className="text-red-700 hover:underline disabled:opacity-50">Anular</button>}
          {fila.estado === "anulacion_pendiente" && <><a href={correoAnulacion(fila)} className="text-emerald-800 hover:underline">Correo</a><button type="button" onClick={() => void post("anulado", { id: fila.id }, fila.id)} disabled={Boolean(busy)} className="ml-3 text-emerald-800 hover:underline disabled:opacity-50">Hecha</button></>}
        </td>
      </tr>)}{!shown.length && <tr><td colSpan={8} className="px-4 py-8 text-zinc-500">No hay contratos.</td></tr>}</tbody></table></div>
    </section>
  </main></div>;
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return <div className={`rounded-2xl border bg-white p-4 shadow-sm ${warn ? "border-amber-300" : "border-zinc-200"}`}><p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900">{value}</p></div>;
}
