"use client";
import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { AppSidebar } from "@/components/app-sidebar";
import { createClient } from "@/lib/supabase/client";

type Line = { id: string; sku: string | null; title: string; quantity: number; unit_price: string };
type ExportAttempt = { created_at: string; http_status: number | null; outcome: string; error_message: string | null; response_payload: { errors?: string[] } | null };
type MhdStatusPayload = { estado_cliente?: string | null; arr_estados?: { estado?: string; fecha?: number | string | null }[] };
type Order = { id: string; shopify_order_id: string; shopify_order_name: string; financial_status: string; fulfillment_status: string; email: string | null; order_note: string | null; discount_summary: string | null; shipping_country_code: string | null; shipping_province_name: string | null; subtotal_amount: string | null; discount_amount: string | null; shipping_amount: string | null; total_amount: string | null; currency_code: string | null; eligibility_status: string; eligibility_reason: string | null; source_updated_at: string; source_payload: { createdAt?: string; customer?: { displayName?: string | null } | null; shippingAddress?: { name?: string | null } | null }; exports: { mhd_order_id: number | null; mhd_transaction_id: string | null; mhd_status: string | null; mhd_status_payload: MhdStatusPayload | null; status: string; attempts: ExportAttempt[] | null }[] | null; lines: Line[] | null };

export function MhdOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]); const [email, setEmail] = useState<string | null>(null); const [loading, setLoading] = useState(true); const [syncing, setSyncing] = useState(false); const [syncingMhd, setSyncingMhd] = useState(false); const [error, setError] = useState<string | null>(null); const [trace, setTrace] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { data: orderData, error: orderError } = await supabase
      .from("shopify_mhd_orders")
      .select("*, lines:shopify_mhd_order_lines(id,sku,title,quantity,unit_price)")
      .order("source_updated_at", { ascending: false }).limit(100);
    if (orderError) { setError("No se pudieron cargar los pedidos guardados."); setLoading(false); return; }
    const orderIds = (orderData ?? []).map((order) => order.id);
    if (!orderIds.length) { setOrders([]); setLoading(false); return; }
    const { data: exportData, error: exportError } = await supabase
      .from("mhd_order_exports")
      .select("id,order_id,mhd_order_id,mhd_transaction_id,mhd_status,mhd_status_payload,status")
      .in("order_id", orderIds);
    if (exportError) { setError("No se pudo cargar el estado de exportación MHD."); setLoading(false); return; }
    const exportIds = (exportData ?? []).map((item) => item.id);
    const { data: attemptData, error: attemptError } = exportIds.length
      ? await supabase.from("mhd_order_export_attempts").select("export_id,created_at,http_status,outcome,error_message,response_payload").in("export_id", exportIds)
      : { data: [], error: null };
    if (attemptError) { setError("No se pudo cargar el detalle de MHD."); setLoading(false); return; }
    const attemptsByExport = new Map<string, ExportAttempt[]>();
    for (const attempt of attemptData ?? []) {
      const list = attemptsByExport.get(attempt.export_id) ?? [];
      list.push(attempt as ExportAttempt); attemptsByExport.set(attempt.export_id, list);
    }
    const exportsByOrder = new Map<string, Order["exports"]>();
    for (const item of exportData ?? []) exportsByOrder.set(item.order_id, [{ ...item, attempts: attemptsByExport.get(item.id) ?? [] }]);
    setOrders((orderData ?? []).map((order) => ({ ...order, exports: exportsByOrder.get(order.id) ?? [] })) as Order[]);
    setLoading(false);
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); createClient().auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null)); }, 0); return () => window.clearTimeout(timer); }, [load]);
  async function sync() { setSyncing(true); setError(null); setTrace(null); try { const response = await fetch("/api/mhd-orders/sync", { method: "POST" }); const body = await response.json() as { createdCount?: number; updatedCount?: number; error?: string; trace?: string }; if (!response.ok) throw Object.assign(new Error(body.error ?? `HTTP ${response.status}`), { trace: body.trace }); const created = body.createdCount ?? 0; const updated = body.updatedCount ?? 0; setTrace(created ? `${created} ${created === 1 ? "pedido nuevo importado" : "pedidos nuevos importados"} desde Shopify.` : updated ? `${updated} ${updated === 1 ? "pedido actualizado" : "pedidos actualizados"} desde Shopify.` : "No se han actualizado pedidos."); await load(); } catch (caught) { const detail = caught instanceof Error ? caught : new Error("No se pudieron actualizar los pedidos."); setError(detail.message); setTrace("trace" in detail && typeof detail.trace === "string" ? detail.trace : null); } finally { setSyncing(false); } }
  async function syncMhdStatuses() { setSyncingMhd(true); setError(null); setTrace(null); try { const response = await fetch("/api/mhd-orders/statuses", { method: "POST" }); const body = await response.json() as { checkedCount?: number; errors?: string[]; error?: string }; if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`); const checked = body.checkedCount ?? 0; const suffix = body.errors?.length ? ` ${body.errors.join(" ")}` : ""; if (body.errors?.length) setError(`Se consultaron ${checked} pedido(s) en MHD, con ${body.errors.length} incidencia(s).`); setTrace(`${checked} pedido(s) actualizado(s) desde MHD.${suffix}`); await load(); } catch (caught) { setError(caught instanceof Error ? caught.message : "No se pudieron actualizar los estados de MHD."); } finally { setSyncingMhd(false); } }
  return <div className="min-h-screen bg-zinc-50 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]"><AppSidebar active="orders" userEmail={email} /><main className="mx-auto w-full max-w-6xl px-6 pb-24 pt-28 sm:px-10 lg:mx-0 lg:py-16"><header><h1 className="text-4xl font-semibold tracking-tight text-zinc-950">Pedidos MHD</h1><p className="mt-3 max-w-3xl text-zinc-600">Actualiza pedidos desde Shopify, revisa su elegibilidad y conserva la trazabilidad de su futura exportación a MHD.</p></header><section className="mt-7 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-lg font-semibold">Pedidos de Shopify</h2><p className="mt-1 text-sm text-zinc-600">Se guardan los últimos 100 pedidos actualizados, incluidos los no exportables.</p></div><div className="flex flex-wrap gap-2"><button type="button" disabled={syncing} onClick={() => void sync()} className="h-11 cursor-pointer rounded-lg bg-emerald-700 px-5 font-medium text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60">{syncing ? "Actualizando…" : "Actualizar desde Shopify"}</button><button type="button" disabled={syncingMhd} onClick={() => void syncMhdStatuses()} className="h-11 cursor-pointer rounded-lg border border-emerald-700 px-5 font-medium text-emerald-800 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60">{syncingMhd ? "Consultando MHD…" : "Actualizar desde MHD"}</button></div></div>{error && <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"><p>{error}</p>{trace && <p className="mt-1 text-red-700/80">{trace}</p>}</div>}{!error && trace && <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{trace}</p>}<div className="mt-5 grid gap-4 lg:grid-cols-2">{loading ? <p className="rounded-xl border border-zinc-200 p-4 text-zinc-500">Cargando pedidos…</p> : orders.length ? orders.map((order) => <OrderCard key={order.id} order={order} />) : <p className="rounded-xl border border-zinc-200 p-4 text-zinc-500">Todavía no hay pedidos guardados.</p>}</div></section></main></div>;
}
function OrderCard({ order }: { order: Order }) {
  const [showOrderDetail, setShowOrderDetail] = useState(false);
  const [showMhdDetail, setShowMhdDetail] = useState(false);
  const exported = order.exports?.[0];
  const latestAttempt = exported?.attempts?.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
  const lines = order.lines ?? [];
  const customer = order.source_payload.shippingAddress?.name ?? order.source_payload.customer?.displayName ?? order.email ?? "Cliente sin nombre";
  const destination = [order.shipping_country_code, order.shipping_province_name].filter(Boolean).join(" · ");
  const ready = order.eligibility_status === "eligible";
  const exportedLabel = exported?.mhd_order_id ? `Exportado a MHD · Pedido #${exported.mhd_order_id}` : null;
  const statusLabel = exportedLabel ?? (exported?.status === "failed" ? "Error al exportar a MHD" : exported?.status === "unknown" ? "Resultado de exportación pendiente de revisión" : ready ? "Listo para exportar a MHD" : order.eligibility_reason ?? "Pendiente");
  const statusColor = exported?.status === "failed" ? "text-red-700" : exported?.status === "unknown" ? "text-amber-700" : exportedLabel || ready ? "text-emerald-700" : "text-amber-700";
  const lineSubtotal = lines.reduce((total, line) => total + Number(line.unit_price) * line.quantity, 0).toFixed(2);
  const subtotal = order.subtotal_amount ?? lineSubtotal;

  return <article className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
    <div className="flex items-start justify-between gap-3">
      <div>
        <h3 className="flex items-center gap-1 font-semibold text-zinc-950"><a href={`https://admin.shopify.com/store/electronica-vicente/orders/${order.shopify_order_id.split("/").pop()}`} target="_blank" rel="noreferrer" aria-label="Abrir pedido en Shopify" title="Abrir pedido en Shopify" className="inline-flex size-6 shrink-0 items-center justify-center rounded hover:bg-zinc-100"><Image src="/shopify-logo-transparent.png" alt="" width={20} height={20} className="size-5 object-contain" /></a><a href={`https://admin.shopify.com/store/electronica-vicente/orders/${order.shopify_order_id.split("/").pop()}`} target="_blank" rel="noreferrer" className="hover:text-emerald-700 hover:underline">{order.shopify_order_name}</a><span className="font-normal text-zinc-500">· {customer}{destination ? ` (${destination})` : ""}</span></h3>
        <p className="mt-1 text-xs text-zinc-500">Creado {order.source_payload.createdAt ? date(order.source_payload.createdAt) : "—"} · Sincronizado desde Shopify {date(order.source_updated_at)} · <span className={`font-medium ${statusColor}`}>{statusLabel}</span></p>
      </div>
      <strong>{money(order.total_amount, order.currency_code)}</strong>
    </div>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap gap-2 text-sm">
        <span className="rounded-full bg-emerald-50 px-3 py-1 font-medium text-emerald-800">{financialLabel(order.financial_status)}</span>
        <span className="rounded-full bg-amber-50 px-3 py-1 font-medium text-amber-800">{fulfillmentLabel(order.fulfillment_status)}</span>
        <span className={`rounded-full px-3 py-1 font-medium ${exported?.mhd_order_id ? "bg-emerald-50 text-emerald-800" : exported?.status === "failed" ? "bg-red-50 text-red-800" : exported?.status === "unknown" ? "bg-amber-50 text-amber-800" : "bg-zinc-100 text-zinc-700"}`}>{exported?.mhd_order_id ? `MHD #${exported.mhd_order_id}${exported.mhd_status ? ` · ${exported.mhd_status}` : ""}` : exported?.status === "failed" ? "Error MHD" : exported?.status === "unknown" ? "Revisión MHD" : "Sin exportar"}</span>
      </div>
    </div>
    <div className="mt-4 border-t border-zinc-100 pt-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <button type="button" onClick={() => setShowOrderDetail((open) => !open)} className="cursor-pointer font-medium text-emerald-700">
          {showOrderDetail ? "▼" : "▶"} Ver detalle pedido
          {order.order_note && <span className="ml-1 inline-flex align-text-bottom" title="Este pedido tiene una nota de Shopify"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4"><path strokeLinecap="round" strokeLinejoin="round" d="M7 3h8l4 4v14H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" /><path strokeLinecap="round" d="M9 12h6M9 16h6M15 3v5h5" /></svg><span className="sr-only">Este pedido tiene una nota de Shopify</span></span>}
          {Number(order.discount_amount ?? 0) > 0 && <span className="ml-1 inline-flex align-text-bottom" title="Este pedido tiene descuentos aplicados"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="size-4"><circle cx="12" cy="12" r="8" /><path strokeLinecap="round" d="m9 15 6-6" /><circle cx="9" cy="9" r=".8" fill="currentColor" stroke="none" /><circle cx="15" cy="15" r=".8" fill="currentColor" stroke="none" /></svg><span className="sr-only">Este pedido tiene descuentos aplicados</span></span>}
        </button>
        {exported?.mhd_order_id && <button type="button" onClick={() => setShowMhdDetail((open) => !open)} className="cursor-pointer font-medium text-emerald-700">{showMhdDetail ? "▼" : "▶"} Ver estados de MHD</button>}
        {latestAttempt && latestAttempt.outcome !== "success" && <details className="text-sm"><summary className="cursor-pointer font-medium text-red-700">Ver errores</summary><div className="mt-3 max-w-2xl rounded-lg border border-red-200 bg-red-50 p-3 text-red-950"><p className="font-medium">Último intento · {date(latestAttempt.created_at)}{latestAttempt.http_status ? ` · HTTP ${latestAttempt.http_status}` : ""}</p>{latestAttempt.error_message && <p className="mt-1">{latestAttempt.error_message}</p>}{latestAttempt.response_payload?.errors?.length ? <ul className="mt-2 list-disc space-y-1 pl-5">{latestAttempt.response_payload.errors.map((error, index) => <li key={`${error}-${index}`}>{error}</li>)}</ul> : null}</div></details>}
      </div>
      {showOrderDetail && <div className="mt-3">
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg bg-zinc-50 p-3 text-zinc-700 min-[520px]:grid-cols-4">
          <div><dt className="text-xs text-zinc-500">Productos</dt><dd>{money(subtotal, order.currency_code)}</dd></div>
          <div><dt className="text-xs text-zinc-500">Descuentos aplicados</dt><dd>{order.discount_amount && Number(order.discount_amount) > 0 ? `−${money(order.discount_amount, order.currency_code)}` : money(order.discount_amount, order.currency_code)}</dd></div>
          <div><dt className="text-xs text-zinc-500">Gastos de envío</dt><dd>{money(order.shipping_amount, order.currency_code)}</dd></div>
          <div><dt className="text-xs text-zinc-500">Total cobrado</dt><dd className="font-medium">{money(order.total_amount, order.currency_code)}</dd></div>
        </dl>
        <ul className="mt-3 space-y-2 text-zinc-700">
          {lines.map((line) => <li key={line.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-lg bg-zinc-50 p-2 text-sm text-zinc-700"><span className="min-w-0"><span className="font-medium">{line.quantity} × {line.title}</span><span className="text-zinc-500"> · SKU: {line.sku ?? "sin SKU"}</span></span><span className="shrink-0 font-medium">{money(line.unit_price, order.currency_code)}</span></li>)}
        </ul>
        {order.discount_summary && <p className="mt-3 rounded-lg bg-violet-50 p-3 text-sm text-violet-950"><span className="font-medium">Promociones aplicadas: </span>{order.discount_summary}</p>}
        {order.order_note && <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"><span className="font-medium">Comentario del pedido: </span>{order.order_note}</p>}
      </div>}
      {showMhdDetail && exported?.mhd_order_id && <div className="mt-3 max-w-2xl space-y-3"><p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-950"><span className="font-medium">Pedido asignado por MHD: </span>#{exported.mhd_order_id}{exported.mhd_transaction_id ? ` · Transacción ${exported.mhd_transaction_id}` : ""}{exported.mhd_status ? ` · Estado ${exported.mhd_status}` : ""}</p>{exported.mhd_status_payload?.arr_estados?.length ? <section className="rounded-lg bg-zinc-50 p-3 text-sm text-zinc-800"><h4 className="font-semibold">Estados comunicados por MHD</h4><ol className="mt-2 space-y-1">{exported.mhd_status_payload.arr_estados.map((item, index) => <li key={`${item.estado ?? "estado"}-${item.fecha ?? index}`} className="flex flex-wrap justify-between gap-x-3"><span>{item.estado ?? "Estado sin literal"}</span><span className="text-zinc-500">{item.fecha != null ? date(mhdDate(item.fecha)) : "Fecha no disponible"}</span></li>)}</ol></section> : <p className="rounded-lg bg-zinc-50 p-3 text-zinc-600">Aún no se ha consultado el estado en MHD.</p>}</div>}
    </div>
  </article>;
}
function date(value: string) { return new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "short" }).format(new Date(value)); }
function mhdDate(value: number | string | null | undefined) { return typeof value === "number" ? new Date(value).toISOString() : value ?? ""; }
function financialLabel(value: string) { return ({ PAID: "Pagado", PENDING: "Pendiente de pago", PARTIALLY_PAID: "Parcialmente pagado", REFUNDED: "Reembolsado", PARTIALLY_REFUNDED: "Reembolsado parcialmente", VOIDED: "Anulado" } as Record<string, string>)[value] ?? value; }
function fulfillmentLabel(value: string) { return ({ UNFULFILLED: "Pendiente de envío", PARTIALLY_FULFILLED: "Enviado parcialmente", FULFILLED: "Enviado", RESTOCKED: "Reintegrado" } as Record<string, string>)[value] ?? value; }
function money(value: string | null, currency: string | null) { if (value == null || !currency) return "—"; try { return new Intl.NumberFormat("es-ES", { style: "currency", currency }).format(Number(value)); } catch { return `${value} ${currency}`; } }
