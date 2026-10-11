"use client";

import { useEffect, useState } from "react";
import { outcomeLabels, sentimentLabels, topicLabels } from "@/lib/chatbot-labels";

// Indicadores de las conversaciones del chatbot (/api/chatbot?view=stats → función admin_conversation_stats).
// Un solo color (el verde de la app) en todos los gráficos: cada barra lleva su nombre y su cifra, así que nada depende del color.
type Stats = {
  totals: { conversations: number; voice: number; identified: number; with_support: number; needs_review: number; user_messages: number; assistant_messages: number; input_tokens: number; output_tokens: number; avg_latency_ms: number | null; widget_errors: number; guard_events?: number; closed_conversations?: number; guard_without_conversation?: number };
  by_day: { day: string; conversations: number; voice: number }[];
  by_hour: Record<string, number>;
  by_weekday: Record<string, number>;
  sentiment: Record<string, number>;
  outcome: Record<string, number>;
  topic: Record<string, number>;
  top_products: { id: number; title: string | null; handle: string | null; count: number }[];
  top_tools: { name: string; count: number }[];
  guard_by_kind?: Record<string, number>;
  coupons?: { code: string; title: string; bot_allowed: boolean; conversations_offered: number; orders_with_code: number; orders_from_chat: number; revenue_from_chat: number }[];
  conversion?: { orders: number; revenue: number; assisted_orders: number; assisted_revenue: number; influenced_orders: number; influenced_revenue: number; avg_ticket_chat: number | null; avg_ticket_other: number | null; conversations_with_order: number; unpaid_chat_orders?: number; first_order_at: string | null; top_sold: { id: number; title: string | null; units: number }[] };
  quality?: Record<string, number>;
  issue_types?: Record<string, number>;
};

const ranges = [
  { key: "7", label: "Últimos 7 días" },
  { key: "30", label: "Últimos 30 días" },
  { key: "90", label: "Últimos 90 días" },
  { key: "all", label: "Todo" },
] as const;
const issueTypeLabels: Record<string, string> = { dato_erroneo: "Dato erróneo", dato_no_respaldado: "Dato no respaldado", no_entendio: "No entendió al cliente", herramienta: "Herramienta mal usada", regla_incumplida: "Regla incumplida", derivacion: "Derivación a una persona", tono: "Tono o extensión", otro: "Otro" };
const guardLabels: Record<string, string> = { ritmo: "Exceso de ritmo", repeticion: "Mensaje repetido", sin_sentido: "Mensaje sin sentido", moderacion: "Inapropiado (aviso)", cierre: "Conversación cerrada", bloqueado: "Escribió estando cerrada", autolesion: "Posible autolesión" };
const weekdays = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const number = (value: number) => value.toLocaleString("es-ES");
const percent = (part: number, total: number) => (total ? `${Math.round((part / total) * 100)} %` : "—");
const madridDay = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(date);

export function ChatbotStats() {
  const [range, setRange] = useState<(typeof ranges)[number]["key"]>("30");
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({ view: "stats" });
    if (range !== "all") params.set("from", madridDay(new Date(Date.now() - (Number(range) - 1) * 86_400_000)));
    let cancelled = false;
    fetch(`/api/chatbot?${params}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "No se pudieron leer las estadísticas.");
        if (!cancelled) { setStats(body.stats); setError(null); }
      })
      .catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "No se pudieron leer las estadísticas."); });
    return () => { cancelled = true; };
  }, [range]);

  const t = stats?.totals;
  return <div className="flex flex-col gap-6">
    <div className="flex flex-wrap gap-2">{ranges.map((item) => <button key={item.key} type="button" onClick={() => setRange(item.key)} aria-pressed={range === item.key} className={`cursor-pointer rounded-lg px-3 py-1.5 text-sm font-medium ${range === item.key ? "bg-emerald-700 text-white" : "border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50"}`}>{item.label}</button>)}</div>
    {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    {!stats || !t ? !error && <p className="text-sm text-zinc-500">Calculando…</p> : <>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Conversaciones" value={number(t.conversations)} note={`${number(t.user_messages)} mensajes de clientes · ${t.conversations ? (t.user_messages / t.conversations).toFixed(1).replace(".", ",") : "0"} por conversación`} />
        <Tile label="Con voz" value={percent(t.voice, t.conversations)} note={`${number(t.voice)} conversaciones`} />
        <Tile label="Cliente identificado" value={percent(t.identified, t.conversations)} note={`${number(t.identified)} con sesión iniciada`} />
        <Tile label="A revisar" value={number(t.needs_review)} note={`${percent(t.needs_review, t.conversations)} del total`} />
        <Tile label="Con petición de soporte" value={number(t.with_support)} note={percent(t.with_support, t.conversations)} />
        <Tile label="Tiempo medio de respuesta" value={t.avg_latency_ms ? `${(t.avg_latency_ms / 1000).toFixed(1).replace(".", ",")} s` : "—"} note="Desde que escribe hasta que termina la respuesta" />
        <Tile label="Tokens" value={compact(t.input_tokens + t.output_tokens)} note={`${compact(t.input_tokens)} de entrada · ${compact(t.output_tokens)} de salida`} />
        <Tile label="Errores del widget" value={number(t.widget_errors)} note="En el periodo" />
      </section>

      {stats.conversion && <Conversion c={stats.conversion} conversations={t.conversations} />}
      {(stats.coupons?.length ?? 0) > 0 && <Coupons coupons={stats.coupons!} />}

      <Panel title="Conversaciones por día"><DayChart days={fillDays(stats.by_day, range)} /></Panel>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title="Sentimiento del cliente"><Bars items={entries(stats.sentiment, sentimentLabels)} total={t.conversations} /></Panel>
        <Panel title="Resultado"><Bars items={entries(stats.outcome, outcomeLabels)} total={t.conversations} /></Panel>
        <Panel title="Motivo"><Bars items={entries(stats.topic, topicLabels)} total={t.conversations} /></Panel>
      </div>
      <p className="-mt-3 text-xs text-zinc-500">Sentimiento, resultado y motivo los estima un modelo de IA al terminar cada conversación: sirven para ver tendencias, no como nota exacta de cada una.</p>

      <h2 className="mt-2 text-xl font-semibold text-zinc-900">Calidad de las respuestas</h2>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Valoración de la revisión"><Bars items={entries(stats.quality ?? {}, { bien: "Bien", mejorable: "Mejorable", mal: "Mal", sin_revisar: "Sin revisar todavía" })} total={t.conversations} /></Panel>
        <Panel title="Tipos de fallo encontrados"><Bars items={entries(stats.issue_types ?? {}, issueTypeLabels)} /></Panel>
      </div>
      <p className="-mt-3 text-xs text-zinc-500">Revisión automática de cada conversación terminada. Las propuestas de mejora están en Chatbot IA → Mejoras.</p>

      <h2 className="mt-2 text-xl font-semibold text-zinc-900">Protección del chat</h2>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Mensajes frenados" value={number(t.guard_events ?? 0)} note="No llegaron al modelo ni gastaron en OpenAI" />
        <Tile label="Conversaciones cerradas" value={number(t.closed_conversations ?? 0)} note="Por mensajes inapropiados repetidos" />
        <Tile label="Sin conversación" value={number(t.guard_without_conversation ?? 0)} note="Frenados antes de abrirla (ritmo o IP bloqueada)" />
      </section>
      <Panel title="Por tipo"><Bars items={entries(stats.guard_by_kind ?? {}, guardLabels)} total={t.guard_events ?? 0} /></Panel>

      <h2 className="mt-2 text-xl font-semibold text-zinc-900">Actividad</h2>
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Mensajes de clientes por hora (hora de Madrid)"><HourChart byHour={stats.by_hour} /></Panel>
        <Panel title="Mensajes de clientes por día de la semana"><Bars items={weekdays.map((name, index) => ({ key: String(index + 1), label: name, value: stats.by_weekday[String(index + 1)] ?? 0 }))} total={t.user_messages} keepOrder /></Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Productos que más muestra el chatbot">{stats.top_products.length ? <ol className="flex flex-col gap-2 text-sm">{stats.top_products.map((product, index) => <li key={product.id} className="flex items-baseline gap-3"><span className="w-5 shrink-0 text-right tabular-nums text-zinc-400">{index + 1}</span><span className="min-w-0 flex-1 truncate text-zinc-800" title={product.title ?? String(product.id)}>{product.title ?? `Producto ${product.id}`}</span><span className="tabular-nums text-zinc-600">{number(product.count)}</span></li>)}</ol> : <Empty />}</Panel>
        <Panel title="Herramientas que más usa el chatbot"><Bars items={stats.top_tools.map((tool) => ({ key: tool.name, label: tool.name.replaceAll("_", " "), value: tool.count }))} keepOrder /></Panel>
      </div>
      <p className="text-xs text-zinc-500">Pendiente: coste en euros del consumo de OpenAI.</p>
    </>}
  </div>;
}

const euro = (value: number | null | undefined) => (value === null || value === undefined ? "—" : new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value));

// Ventas atribuidas al chat: pedidos con la marca de la conversación (asistidos) o en los que el cliente con sesión
// compró en los 7 días siguientes un producto que el bot le mostró (influidos).
function Conversion({ c, conversations }: { c: NonNullable<Stats["conversion"]>; conversations: number }) {
  const attributedOrders = c.assisted_orders + c.influenced_orders;
  const attributedRevenue = c.assisted_revenue + c.influenced_revenue;
  return <>
    <h2 className="mt-2 text-xl font-semibold text-zinc-900">Ventas atribuidas al chat</h2>
    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile label="Pedidos atribuidos" value={number(attributedOrders)} note={`${number(c.assisted_orders)} asistidos · ${number(c.influenced_orders)} influidos · de ${number(c.orders)} pedidos`} />
      <Tile label="Ingresos atribuidos" value={euro(attributedRevenue)} note={`${percent(attributedRevenue, c.revenue)} de ${euro(c.revenue)} en el periodo`} />
      <Tile label="Conversión del chat" value={percent(c.conversations_with_order, conversations)} note={`${number(c.conversations_with_order)} conversaciones con pedido`} />
      <Tile label="Ticket medio" value={euro(c.avg_ticket_chat)} note={`Con chat · sin chat: ${euro(c.avg_ticket_other)}`} />
    </section>
    {(c.unpaid_chat_orders ?? 0) > 0 && <p className="-mt-3 text-sm text-amber-800">{number(c.unpaid_chat_orders ?? 0)} {c.unpaid_chat_orders === 1 ? "pedido del chat pendiente de pago: contará" : "pedidos del chat pendientes de pago: contarán"} cuando se pague.</p>}
    {c.top_sold.length > 0 && <Panel title="Productos recomendados por el chat que se vendieron"><ol className="flex flex-col gap-2 text-sm">{c.top_sold.map((product, index) => <li key={product.id} className="flex items-baseline gap-3"><span className="w-5 shrink-0 text-right tabular-nums text-zinc-400">{index + 1}</span><span className="min-w-0 flex-1 truncate text-zinc-800">{product.title ?? `Producto ${product.id}`}</span><span className="tabular-nums text-zinc-600">{number(product.units)} uds.</span></li>)}</ol></Panel>}
    <p className="-mt-3 text-xs text-zinc-500"><strong className="font-medium text-zinc-600">Asistido:</strong> el pedido se hizo con un carrito en el que se usó el chat. <strong className="font-medium text-zinc-600">Influido:</strong> el cliente, con sesión iniciada, compró en los 7 días siguientes un producto que el chat le mostró. Solo cuentan los pedidos pagados (total o parcialmente), descontando lo reembolsado. Se mide desde el 11/10/2026; los pedidos anteriores no llevan la marca. Quien usa el chat ya suele tener más intención de compra: el ticket o la conversión más altos no significan que el chat los cause.</p>
  </>;
}

// Cupones: conversaciones en que el bot escribió el código y pedidos pagados que lo usaron.
function Coupons({ coupons }: { coupons: NonNullable<Stats["coupons"]> }) {
  const leaked = coupons.filter((c) => !c.bot_allowed && c.conversations_offered > 0);
  return <Panel title="Cupones">
    <div className="overflow-x-auto"><table className="w-full text-sm">
      <thead className="text-left text-xs text-zinc-500"><tr><th className="py-1.5 pr-4 font-medium">Código</th><th className="py-1.5 pr-4 font-medium">Lo da el chat</th><th className="py-1.5 pr-4 text-right font-medium">Ofrecido en</th><th className="py-1.5 pr-4 text-right font-medium">Pedidos con el código</th><th className="py-1.5 pr-4 text-right font-medium">De ellos, tras ofrecerlo el chat</th><th className="py-1.5 text-right font-medium">Ingresos</th></tr></thead>
      <tbody className="divide-y divide-zinc-100">{coupons.map((c) => <tr key={c.code}>
        <td className="py-2 pr-4 font-mono font-medium text-zinc-900">{c.code}</td>
        <td className="py-2 pr-4 text-zinc-600">{c.bot_allowed ? "Sí" : "No"}</td>
        <td className="py-2 pr-4 text-right tabular-nums text-zinc-800">{number(c.conversations_offered)} conv.</td>
        <td className="py-2 pr-4 text-right tabular-nums text-zinc-800">{number(c.orders_with_code)}</td>
        <td className="py-2 pr-4 text-right tabular-nums text-zinc-800">{number(c.orders_from_chat)}</td>
        <td className="py-2 text-right tabular-nums text-zinc-800">{euro(c.revenue_from_chat)}</td>
      </tr>)}</tbody>
    </table></div>
    {leaked.length > 0 && <p className="mt-3 text-sm text-red-700">⚠ El chat mencionó {leaked.map((c) => c.code).join(", ")} sin tenerlo permitido: revisa esas conversaciones.</p>}
    <p className="mt-3 text-xs text-zinc-500">«Ofrecido» = el chat escribió el código en una conversación del periodo. «Tras ofrecerlo el chat» = pedido pagado con el código, atribuido a una conversación en la que el chat lo ofreció.</p>
  </Panel>;
}

function Tile({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm"><p className="text-sm text-zinc-500">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums text-zinc-950">{value}</p><p className="mt-1 text-xs text-zinc-500">{note}</p></div>;
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm"><h2 className="mb-4 text-base font-semibold text-zinc-900">{title}</h2>{children}</section>;
}

function Empty() {
  return <p className="text-sm text-zinc-500">Sin datos en el periodo.</p>;
}

// Barras horizontales con nombre y cifra; de mayor a menor salvo keepOrder.
function Bars({ items, total, keepOrder }: { items: { key: string; label: string; value: number }[]; total?: number; keepOrder?: boolean }) {
  const list = keepOrder ? items : [...items].sort((a, b) => b.value - a.value);
  const max = Math.max(1, ...list.map((item) => item.value));
  if (!list.some((item) => item.value)) return <Empty />;
  return <ul className="flex flex-col gap-2.5">{list.map((item) => <li key={item.key} className="text-sm">
    <div className="flex items-baseline justify-between gap-3"><span className="text-zinc-700">{item.label}</span><span className="tabular-nums text-zinc-600">{number(item.value)}{total ? <span className="ml-1.5 text-zinc-400">{percent(item.value, total)}</span> : null}</span></div>
    <div className="mt-1 h-2 rounded-full bg-zinc-100"><div className="h-2 rounded-full bg-emerald-600" style={{ width: `${(item.value / max) * 100}%` }} /></div>
  </li>)}</ul>;
}

function DayChart({ days }: { days: { day: string; conversations: number; voice: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...days.map((day) => day.conversations));
  if (!days.some((day) => day.conversations)) return <Empty />;
  const shown = hover !== null ? days[hover] : null;
  const label = (day: string) => new Intl.DateTimeFormat("es-ES", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));
  return <div>
    <p className="h-5 text-sm text-zinc-600">{shown ? <><span className="font-medium text-zinc-900">{label(shown.day)}</span> · {number(shown.conversations)} conversaciones{shown.voice ? ` (${number(shown.voice)} con voz)` : ""}</> : <span className="text-zinc-400">Pasa por encima de una barra para ver el día.</span>}</p>
    <div className="mt-3 flex h-40 items-end gap-0.5 border-b border-zinc-200" onMouseLeave={() => setHover(null)}>
      {days.map((day, index) => <div key={day.day} onMouseEnter={() => setHover(index)} className="flex h-full min-w-0 flex-1 cursor-default items-end" aria-label={`${label(day.day)}: ${day.conversations} conversaciones`}>
        <div className={`w-full rounded-t ${hover === index ? "bg-emerald-800" : "bg-emerald-600"}`} style={{ height: day.conversations ? `${Math.max(3, (day.conversations / max) * 100)}%` : 0 }} />
      </div>)}
    </div>
    <div className="mt-1 flex justify-between text-xs text-zinc-400"><span>{label(days[0].day)}</span><span>Máximo: {number(max)} al día</span><span>{label(days[days.length - 1].day)}</span></div>
  </div>;
}

function HourChart({ byHour }: { byHour: Record<string, number> }) {
  const hours = Array.from({ length: 24 }, (_, hour) => byHour[String(hour)] ?? 0);
  const max = Math.max(1, ...hours);
  const [hover, setHover] = useState<number | null>(null);
  if (!hours.some(Boolean)) return <Empty />;
  return <div>
    <p className="h-5 text-sm text-zinc-600">{hover !== null ? <><span className="font-medium text-zinc-900">{hover}:00–{hover + 1}:00</span> · {number(hours[hover])} mensajes</> : <span className="text-zinc-400">Pasa por encima de una barra para ver la hora.</span>}</p>
    <div className="mt-3 flex h-32 items-end gap-0.5 border-b border-zinc-200" onMouseLeave={() => setHover(null)}>
      {hours.map((value, hour) => <div key={hour} onMouseEnter={() => setHover(hour)} className="flex h-full flex-1 items-end"><div className={`w-full rounded-t ${hover === hour ? "bg-emerald-800" : "bg-emerald-600"}`} style={{ height: value ? `${Math.max(3, (value / max) * 100)}%` : 0 }} /></div>)}
    </div>
    <div className="mt-1 flex justify-between text-xs text-zinc-400"><span>0 h</span><span>6 h</span><span>12 h</span><span>18 h</span><span>23 h</span></div>
  </div>;
}

function entries(counts: Record<string, number>, labels: Record<string, string>) {
  return Object.entries(counts).map(([key, value]) => ({ key, label: labels[key] ?? (key === "sin_analizar" ? "Sin analizar" : key), value }));
}

// Rellena con ceros los días sin conversaciones para que el eje sea continuo.
function fillDays(days: Stats["by_day"], range: string) {
  if (!days.length) return [];
  const byDay = new Map(days.map((day) => [day.day, day]));
  const first = range === "all" ? days[0].day : madridDay(new Date(Date.now() - (Number(range) - 1) * 86_400_000));
  const last = madridDay(new Date());
  const result: Stats["by_day"] = [];
  for (let cursor = new Date(`${first}T12:00:00Z`); cursor.toISOString().slice(0, 10) <= last; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const day = cursor.toISOString().slice(0, 10);
    result.push(byDay.get(day) ?? { day, conversations: 0, voice: 0 });
  }
  return result;
}

function compact(value: number) {
  return new Intl.NumberFormat("es-ES", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}
