import type { SupabaseClient } from "@supabase/supabase-js";
import { EMAIL_PREFIX, escapeHtml } from "@/lib/email";
import type { CycleStep } from "./sync-cycle";

// Resumen de las sincronizaciones y el importador (David, 2026-10-26: «resumen diario a las 9:00»; 2026-10-29: cada hora
// durante unos días, hasta que todo esté estable, y «mucho más detalle»). Cuenta lo de las últimas `hours` horas (24 en
// el diario): vueltas con el tiempo de cada paso, catálogo frente a la tienda, precio y stock con los mayores cambios y
// los que van y vuelven, agotados, importador con descartes por motivo, cola de revisión, gasto de IA y avisos. El
// detalle lo agrupa la base (mhd_sync_report, mhd_catalog_overview). Lo pendiente de montar (altas y bajas, marcas
// nuevas, colecciones y redirecciones) se añadirá aquí cuando exista.
type Cell = string | { text: string; href: string };
type Section = { title: string; warn?: boolean; lines: string[]; table?: { head: string[]; rows: Cell[][] }; link?: { text: string; href: string } };
type Product = { codigo: string; title: string | null; product_id: string | null };
type Report = {
  prices: { total: number; up: number; down: number; big: number; top: (Product & { antes: number; ahora: number; pct: number })[]; flips: (Product & { n: number; path: string })[] };
  stock: { total: number; out: number; back: number; out_list: (Product & { antes: number })[] };
  importer: { by_status: Record<string, number>; reasons: { status: string; reason: string; n: number; codigos: string[] }[]; open_jobs: { id: string; title: string; status: string; paused_reason: string | null; total: number; done: number; errors: number }[] };
  ai_cost: { period: number; today: number; month: number };
  review: { pending: number; reasons: { reason: string; n: number }[] };
};
type Overview = { read_at: string | null; in_listing: number; not_in_store: number; active_missing: number; active: number; draft: number; archived: number };

const UTILS = "https://utils.electronicavicente.com";
const integer = new Intl.NumberFormat("es-ES");
const dollars = new Intl.NumberFormat("es-ES", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const euros = (value: number) => `${new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 }).format(value)} €`;
const madridTime = (iso: string) => new Date(iso).toLocaleTimeString("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit" });
const seconds = (from?: string, to?: string) => (from && to ? Math.round((new Date(to).getTime() - new Date(from).getTime()) / 1000) : null);
const duration = (secs: number | null) => (secs === null ? "—" : secs < 60 ? `${secs} s` : `${Math.floor(secs / 60)} min ${secs % 60} s`);
const shopifyLink = (item: Product): Cell => {
  const text = item.title ?? item.codigo;
  const id = item.product_id?.split("/").pop();
  return id ? { text, href: `https://admin.shopify.com/store/electronica-vicente/products/${id}` } : text;
};
const STATUS: Record<string, string> = { terminada: "terminada", fallida: "FALLIDA", parada: "parada", atascada: "ATASCADA", iniciando: "empezando", leyendo: "leyendo MHD", procesando: "procesando" };

export async function buildDailyReport(db: SupabaseClient, now = new Date(), hours = 24) {
  const since = new Date(now.getTime() - hours * 3_600_000).toISOString();
  const period = hours === 1 ? "la última hora" : `las últimas ${hours} horas`;
  const [cyclesResult, reportResult, overviewResult, alertsResult] = await Promise.all([
    db.from("mhd_sync_cycles").select("id,trigger,status,started_at,finished_at,steps,error").gte("started_at", since).order("started_at"),
    db.rpc("mhd_sync_report", { p_since: since }),
    db.rpc("mhd_catalog_overview"),
    db.from("mhd_sync_events").select("detail,created_at").eq("sync", "avisos").eq("kind", "correo").gte("created_at", since).order("created_at"),
  ]);
  const report = reportResult.data as Report | null;
  const overview = overviewResult.data as Overview | null;
  const sections: Section[] = [];

  // Vueltas: cada una con el tiempo y las cifras de sus pasos.
  const cycles = (cyclesResult.data ?? []) as { id: string; trigger: string; status: string; started_at: string; finished_at: string | null; steps: CycleStep[]; error: string | null }[];
  const bad = cycles.filter((cycle) => ["fallida", "atascada"].includes(cycle.status));
  const finished = cycles.filter((cycle) => cycle.status === "terminada");
  const average = finished.length ? Math.round(finished.reduce((total, cycle) => total + (seconds(cycle.started_at, cycle.finished_at ?? undefined) ?? 0), 0) / finished.length) : null;
  const lastChecks = [...cycles].reverse().map((cycle) => cycle.steps.find((item) => item.name === "conexiones")).find(Boolean);
  const services = (lastChecks?.counts?.services ?? []) as { name: string; ok: boolean; ms: number; error?: string }[];
  sections.push({
    title: "Vueltas de sincronización", warn: bad.length > 0 || cycles.length === 0,
    lines: cycles.length ? [
      `${cycles.length} vueltas en ${period}: ${finished.length} terminadas${bad.length ? `, ${bad.length} con problemas` : ""}. Duración media: ${duration(average)}.`,
      ...(services.length ? [`Conexiones (última comprobación): ${services.map((item) => `${item.name} ${item.ok ? `${(item.ms / 1000).toLocaleString("es-ES", { maximumFractionDigits: 1 })} s` : `SIN CONEXIÓN (${item.error})`}`).join(" · ")}.`] : []),
      ...bad.map((cycle) => `${madridTime(cycle.started_at)} · ${STATUS[cycle.status]}: ${cycle.error ?? "sin motivo"}`),
    ] : [`Ninguna vuelta en ${period}. ¿Está parada la tarea programada?`],
    table: cycles.length ? { head: ["Hora", "Estado", "Total", "Lectura MHD", "Productos leídos", "Precio y stock", "Precios", "Stock"], rows: cycles.map((cycle) => {
      const read = cycle.steps.find((item) => item.name === "lectura"); const sync = cycle.steps.find((item) => item.name === "precio-stock");
      return [madridTime(cycle.started_at), STATUS[cycle.status] ?? cycle.status, duration(seconds(cycle.started_at, cycle.finished_at ?? undefined)), duration(seconds(read?.started_at, read?.finished_at)),
        read?.counts?.products ? integer.format(Number(read.counts.products)) : "—", duration(seconds(sync?.started_at, sync?.finished_at)),
        sync?.counts ? integer.format(Number(sync.counts.pricesSent ?? 0)) : "—", sync?.counts ? integer.format(Number(sync.counts.stockSent ?? 0)) : "—"];
    }) } : undefined,
    link: { text: "Ver las lecturas en utils", href: `${UTILS}/importar-datos-mhd` },
  });

  if (overview) sections.push({
    title: "Catálogo: MHD frente a la tienda",
    lines: [
      `Listado de MHD${overview.read_at ? ` (leído a las ${madridTime(overview.read_at)})` : ""}: ${integer.format(overview.in_listing)} productos.`,
      `En la tienda: ${integer.format(overview.active)} activos, ${integer.format(overview.draft)} borradores y ${integer.format(overview.archived)} archivados.`,
      `En MHD y aún no en la tienda: ${integer.format(overview.not_in_store)} (incluye los que se dejaron fuera a propósito; las altas automáticas llegan en la fase 2).`,
      `Activos en la tienda que ya no vienen en el listado de MHD: ${integer.format(overview.active_missing)} (bajas candidatas, todavía sin tratar).`,
    ],
  });

  if (report) {
    const { prices, stock } = report;
    sections.push({
      title: "Precio y stock enviados a Shopify", warn: prices.big > 0 || prices.flips.length > 0,
      lines: [
        `Precios: ${integer.format(prices.total)} cambios (${integer.format(prices.up)} suben y ${integer.format(prices.down)} bajan)${prices.big ? `; ${prices.big} cambian más de un 30 %` : ""}.`,
        `Stock: ${integer.format(stock.total)} cambios; ${integer.format(stock.out)} se agotan y ${integer.format(stock.back)} vuelven a tener existencias.`,
        ...(prices.flips.length ? [`Precios que cambian varias veces (van y vuelven): ${prices.flips.map((item) => `${item.title ?? item.codigo} (${item.path} €)`).join(" · ")}.`] : []),
        ...(stock.out_list.length ? [`Agotados: ${stock.out_list.map((item) => item.title ?? item.codigo).join(" · ")}.`] : []),
      ],
      table: prices.top.length ? { head: ["Producto", "Código", "Antes", "Ahora", "Cambio"], rows: prices.top.map((item) => [shopifyLink(item), item.codigo, euros(item.antes), euros(item.ahora), `${item.pct > 0 ? "+" : ""}${item.pct} %${Math.abs(item.pct) > 30 ? " ⚠" : ""}`]) } : undefined,
    });

    const byStatus = report.importer.by_status; const processed = Object.values(byStatus).reduce((total, value) => total + value, 0);
    sections.push({
      title: "Importador de productos", warn: (byStatus.error ?? 0) > 0 || report.importer.open_jobs.some((job) => job.paused_reason),
      lines: [
        processed ? `${integer.format(processed)} productos en ${period}: ${integer.format(byStatus.ok ?? 0)} bien, ${integer.format(byStatus.descartado ?? 0)} descartados y ${integer.format(byStatus.error ?? 0)} con error.` : `Ningún producto procesado en ${period}.`,
        ...report.importer.open_jobs.map((job) => `Trabajo abierto «${job.title}»: ${integer.format(job.done)} de ${integer.format(job.total)}${job.errors ? `, ${job.errors} errores` : ""}${job.paused_reason ? ` · PAUSADO: ${job.paused_reason}` : ""}.`),
        `Gasto de IA: ${dollars.format(report.ai_cost.period)} en ${period}, ${dollars.format(report.ai_cost.today)} hoy y ${dollars.format(report.ai_cost.month)} este mes.`,
      ],
      table: report.importer.reasons.length ? { head: ["Resultado", "Motivo", "Productos", "Ejemplos"], rows: report.importer.reasons.map((item) => [item.status, item.reason, integer.format(item.n), item.codigos.join(", ")]) } : undefined,
      link: { text: "Ver los procesos en utils", href: `${UTILS}/importador-productos` },
    });

    sections.push({
      title: "Cola de revisión", warn: report.review.pending > 0,
      lines: [`${integer.format(report.review.pending)} productos esperando revisión (suben en borrador hasta revisarlos).`],
      table: report.review.reasons.length ? { head: ["Motivo más repetido", "Productos"], rows: report.review.reasons.map((item) => [item.reason, integer.format(item.n)]) } : undefined,
      link: { text: "Revisar en utils", href: `${UTILS}/importador-productos` },
    });
  } else sections.push({ title: "Detalle no disponible", warn: true, lines: [`No se pudo leer el detalle: ${reportResult.error?.message ?? "sin motivo"}`] });

  const sent = alertsResult.data ?? [];
  if (sent.length) sections.push({ title: "Avisos enviados", warn: true, lines: sent.map((item) => {
    const detail = item.detail as { subject?: string; sent?: boolean; lines?: string[] };
    return `${madridTime(item.created_at)} · ${detail.subject}${detail.lines?.length ? `: ${detail.lines.filter(Boolean).slice(1, 2).join(" ")}` : ""}${detail.sent ? "" : " (no se pudo enviar)"}`;
  }) });

  const problems = sections.filter((section) => section.warn).length;
  const day = now.toLocaleDateString("es-ES", { timeZone: "Europe/Madrid", weekday: "long", day: "numeric", month: "long" });
  const subject = `${EMAIL_PREFIX} Resumen ${hours === 24 ? `del ${day}` : `de ${madridTime(since)} a ${madridTime(now.toISOString())}`} · ${problems ? `${problems} ${problems === 1 ? "punto que mirar" : "puntos que mirar"}` : "todo en orden"}`;
  return { subject, text: toText(sections), html: toHtml(sections, subject), sections };
}

const cellText = (cell: Cell) => (typeof cell === "string" ? cell : cell.text);
function toText(sections: Section[]) {
  return sections.map((section) => [
    `${section.warn ? "⚠ " : ""}${section.title.toUpperCase()}`,
    ...section.lines.map((line) => `- ${line}`),
    ...(section.table ? ["", section.table.head.join(" | "), ...section.table.rows.map((row) => row.map(cellText).join(" | "))] : []),
    ...(section.link ? [`${section.link.text}: ${section.link.href}`] : []),
  ].join("\n")).join("\n\n") + `\n\n${UTILS}`;
}

function toHtml(sections: Section[], subject: string) {
  const cell = (value: Cell) => (typeof value === "string" ? escapeHtml(value) : `<a href="${value.href}" style="color:#047857">${escapeHtml(value.text)}</a>`);
  const td = "padding:4px 8px;border-bottom:1px solid #e4e4e7;vertical-align:top";
  const body = sections.map((section) => `
    <h3 style="margin:24px 0 6px;font-size:16px;color:${section.warn ? "#b45309" : "#18181b"}">${section.warn ? "⚠ " : ""}${escapeHtml(section.title)}</h3>
    <ul style="margin:0;padding-left:18px">${section.lines.map((line) => `<li style="margin:2px 0">${escapeHtml(line)}</li>`).join("")}</ul>
    ${section.table ? `<table style="border-collapse:collapse;margin-top:8px;font-size:13px"><thead><tr>${section.table.head.map((head) => `<th style="${td};text-align:left;background:#f4f4f5">${escapeHtml(head)}</th>`).join("")}</tr></thead><tbody>${section.table.rows.map((row) => `<tr>${row.map((value) => `<td style="${td}">${cell(value)}</td>`).join("")}</tr>`).join("")}</tbody></table>` : ""}
    ${section.link ? `<p style="margin:6px 0 0"><a href="${section.link.href}" style="color:#047857">${escapeHtml(section.link.text)} →</a></p>` : ""}`).join("");
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:14px;color:#27272a;max-width:900px">
    <p style="margin:0 0 4px;font-size:12px;color:#71717a">${escapeHtml(subject)}</p>${body}
    <p style="margin:28px 0 0;font-size:12px;color:#71717a"><a href="${UTILS}" style="color:#047857">Abrir utils</a> · Correo automático de las sincronizaciones con MHD.</p></div>`;
}
