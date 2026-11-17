import type { SupabaseClient } from "@supabase/supabase-js";
import { EMAIL_PREFIX, escapeHtml } from "@/lib/email";
import { extraSections, type Cell, type Kpi, type Section, type Tone } from "./daily-report-extra";
import type { CycleStep } from "./sync-cycle";

// Resumen de las sincronizaciones y el importador (David, 2026-10-26: «resumen diario a las 9:00»; 2026-10-29: cada hora
// durante unos días, hasta que todo esté estable, y «mucho más detalle»). Cuenta lo de las últimas `hours` horas (24 en
// el diario): vueltas con el tiempo de cada paso, catálogo frente a la tienda, precio y stock con los mayores cambios y
// los que van y vuelven, agotados, importador con descartes por motivo, cola de revisión, gasto de IA y avisos. El
// detalle lo agrupa la base (mhd_sync_report, mhd_catalog_overview). Desde el 2026-11-17, además, los procesos con su
// vigilante de silencio, lo que deja el importador, portes, proveedor, relaciones, Garantía3, tarifas de servicios y
// marcas y familias nuevas (daily-report-extra.ts). Pendiente: las bajas definitivas, que aún no existen.
type Product = { codigo: string; title: string | null; product_id: string | null };
type Report = {
  prices: { total: number; up: number; down: number; big: number; top: (Product & { antes: number; ahora: number; pct: number })[]; flips: (Product & { n: number; path: string })[] };
  stock: { total: number; out: number; back: number; out_list: (Product & { antes: number })[] };
  importer: { by_status: Record<string, number>; reasons: { status: string; reason: string; n: number; codigos: string[] }[]; open_jobs: { id: string; title: string; status: string; paused_reason: string | null; total: number; done: number; errors: number }[] };
  ai_cost: { period: number; today: number; month: number };
  review: { pending: number; reasons: { reason: string; n: number }[] };
};
type Absences = { days: number; out: number; out_selling: number; out_list: Product[]; back: number; back_list: Product[]; open: number; due: number; near: number; due_list: (Product & { missing_since: string })[]; skipped_by_read: number };
type CollectionChange = { handle: string; origen: string; destino: string | null };
type CollectionsRun = { mode?: string; failed?: string; braked?: boolean; errors?: string[]; inMenu?: string[]; unpublish?: CollectionChange[]; publish?: CollectionChange[] };
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
const VIDEO_CAP = /more than [\d.,]+ videos in an? (hour|week)/i;
const STATUS: Record<string, string> = { terminada: "terminada", fallida: "FALLIDA", parada: "parada", atascada: "ATASCADA", iniciando: "empezando", leyendo: "leyendo MHD", procesando: "procesando" };

export async function buildDailyReport(db: SupabaseClient, now = new Date(), hours = 24) {
  const since = new Date(now.getTime() - hours * 3_600_000).toISOString();
  const period = hours === 1 ? "la última hora" : `las últimas ${hours} horas`;
  const [cyclesResult, reportResult, overviewResult, alertsResult, absencesResult, altasResult, collectionsResult] = await Promise.all([
    db.from("mhd_sync_cycles").select("id,trigger,status,started_at,finished_at,steps,error").gte("started_at", since).order("started_at"),
    db.rpc("mhd_sync_report", { p_since: since }),
    db.rpc("mhd_catalog_overview"),
    db.from("mhd_sync_events").select("detail,created_at").eq("sync", "avisos").eq("kind", "correo").gte("created_at", since).order("created_at"),
    db.rpc("mhd_absence_report", { p_since: since }),
    db.from("mhd_sync_events").select("detail").eq("sync", "altas").eq("kind", "encolado").gte("created_at", since).limit(5000),
    db.from("mhd_sync_events").select("kind,detail").eq("sync", "colecciones").gte("created_at", since).order("created_at").limit(500),
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
    id: "vueltas", title: "Vueltas de sincronización", warn: bad.length > 0 || cycles.length === 0,
    kpis: [{ id: "vueltas", label: "Vueltas terminadas", value: finished.length, text: `${finished.length} de ${cycles.length}`, sub: `Duración media ${duration(average)}`, tone: !cycles.length || bad.length ? "bad" : "ok" }],
    lines: cycles.length ? [
      `${cycles.length} vueltas en ${period}: ${finished.length} terminadas${bad.length ? `, ${bad.length} con problemas` : ""}. Duración media: ${duration(average)}.`,
      ...(services.length ? [`Conexiones (última comprobación): ${services.map((item) => `${item.name} ${item.ok ? `${(item.ms / 1000).toLocaleString("es-ES", { maximumFractionDigits: 1 })} s` : `SIN CONEXIÓN (${item.error})`}`).join(" · ")}.`] : []),
      ...bad.map((cycle) => `${madridTime(cycle.started_at)} · ${STATUS[cycle.status]}: ${cycle.error ?? "sin motivo"}`),
    ] : [`Ninguna vuelta en ${period}. ¿Está parada la tarea programada?`],
    table: cycles.length ? { head: ["Hora", "Estado", "Total", "Lectura MHD", "Productos leídos", "Precio y stock", "Precios", "Stock", "Agotados / vuelven"], rows: cycles.map((cycle) => {
      const read = cycle.steps.find((item) => item.name === "lectura"); const sync = cycle.steps.find((item) => item.name === "precio-stock"); const gone = cycle.steps.find((item) => item.name === "agotados");
      return [madridTime(cycle.started_at), STATUS[cycle.status] ?? cycle.status, duration(seconds(cycle.started_at, cycle.finished_at ?? undefined)), duration(seconds(read?.started_at, read?.finished_at)),
        read?.counts?.products ? integer.format(Number(read.counts.products)) : "—", duration(seconds(sync?.started_at, sync?.finished_at)),
        sync?.counts ? integer.format(Number(sync.counts.pricesSent ?? 0)) : "—", sync?.counts ? integer.format(Number(sync.counts.stockSent ?? 0)) : "—",
        gone?.counts ? `${integer.format(Number(gone.counts.applied ?? 0))} / ${integer.format(Number(gone.counts.returned ?? 0))}${gone.counts.braked ? " (freno)" : ""}` : "—"];
    }) } : undefined,
    link: { text: "Ver las lecturas en utils", href: `${UTILS}/importar-datos-mhd` },
  });

  if (overview) sections.push({
    id: "catalogo", title: "Catálogo: MHD frente a la tienda",
    kpis: [{ id: "tienda-activos", label: "Productos activos", value: overview.active, sub: `${integer.format(overview.draft)} borradores · ${integer.format(overview.in_listing)} en MHD`, tone: "neutral" }],
    lines: [
      `Listado de MHD${overview.read_at ? ` (leído a las ${madridTime(overview.read_at)})` : ""}: ${integer.format(overview.in_listing)} productos.`,
      `En la tienda: ${integer.format(overview.active)} activos, ${integer.format(overview.draft)} borradores y ${integer.format(overview.archived)} archivados.`,
      `En MHD y aún no en la tienda: ${integer.format(overview.not_in_store)} (incluye los que se dejaron fuera a propósito; las altas automáticas llegan en la fase 2).`,
      `Activos en la tienda que ya no vienen en el listado de MHD: ${integer.format(overview.active_missing)} (los trata «Agotados en MHD»: stock 0 y, a los días fijados, baja).`,
    ],
  });

  if (report) {
    const { prices, stock } = report;
    sections.push({
      id: "precio-stock", title: "Precio y stock enviados a Shopify", warn: prices.big > 0 || prices.flips.length > 0,
      kpis: [
        { id: "precios", label: "Precios cambiados", value: prices.total, sub: `${integer.format(prices.up)} suben · ${integer.format(prices.down)} bajan${prices.big ? ` · ${prices.big} más de un 30 %` : ""}`, tone: prices.big ? "warn" : "neutral" },
        { id: "stock", label: "Stock cambiado", value: stock.total, sub: `${integer.format(stock.out)} se agotan · ${integer.format(stock.back)} vuelven`, tone: "neutral" },
      ],
      lines: [
        `Precios: ${integer.format(prices.total)} cambios (${integer.format(prices.up)} suben y ${integer.format(prices.down)} bajan)${prices.big ? `; ${prices.big} cambian más de un 30 %` : ""}.`,
        `Stock: ${integer.format(stock.total)} cambios; ${integer.format(stock.out)} se agotan y ${integer.format(stock.back)} vuelven a tener existencias.`,
        ...(prices.flips.length ? [`Precios que cambian varias veces (van y vuelven): ${prices.flips.map((item) => `${item.title ?? item.codigo} (${item.path} €)`).join(" · ")}.`] : []),
        ...(stock.out_list.length ? [`Agotados: ${stock.out_list.map((item) => item.title ?? item.codigo).join(" · ")}.`] : []),
      ],
      table: prices.top.length ? { head: ["Producto", "Código", "Antes", "Ahora", "Cambio"], rows: prices.top.map((item) => [shopifyLink(item), item.codigo, euros(item.antes), euros(item.ahora), `${item.pct > 0 ? "+" : ""}${item.pct} %${Math.abs(item.pct) > 30 ? " ⚠" : ""}`]) } : undefined,
    });

    // Agotados en MHD (2026-10-29): lo que MHD deja de traer pasa a stock 0 y se repone al volver; baja solo a los N días.
    const absences = absencesResult.data as Absences | null;
    if (absences) sections.push({
      id: "agotados", title: "Agotados en MHD", warn: absences.due > 0,
      kpis: [{ id: "agotados", label: "Agotados en MHD", value: absences.open, sub: `${integer.format(absences.out)} nuevos · ${integer.format(absences.back)} vuelven${absences.due ? ` · ${absences.due} para baja` : ""}`, tone: absences.due ? "warn" : "neutral" }],
      lines: [
        `En ${period}: ${integer.format(absences.out)} se agotan (MHD deja de traerlos; stock 0${absences.out_selling ? `, ${absences.out_selling} dejan de venderse sin stock` : ""}) y ${integer.format(absences.back)} vuelven.`,
        `Siguen agotados: ${integer.format(absences.open)}. ${absences.due ? `${integer.format(absences.due)} llevan más de ${absences.days} días: pendientes de baja (archivar y redirigir).` : `Ninguno pasa de ${absences.days} días.`}${absences.near ? ` ${integer.format(absences.near)} llegan a los ${absences.days} días en menos de 5.` : ""}`,
        ...(absences.skipped_by_read ? [`La lectura de MHD se saltó ${absences.skipped_by_read} productos que siguen existiendo: no se tocaron.`] : []),
        ...(absences.back_list.length ? [`Vuelven: ${absences.back_list.map((item) => item.title ?? item.codigo).join(" · ")}.`] : []),
      ],
      table: absences.due_list.length ? { head: ["Pendiente de baja", "Código", "Agotado desde"], rows: absences.due_list.map((item) => [shopifyLink(item), item.codigo, new Date(item.missing_since).toLocaleDateString("es-ES", { timeZone: "Europe/Madrid" })]) }
        : absences.out_list.length ? { head: ["Agotados en este periodo (los últimos)", "Código"], rows: absences.out_list.map((item) => [shopifyLink(item), item.codigo]) } : undefined,
    });

    const byStatus = report.importer.by_status; const processed = Object.values(byStatus).reduce((total, value) => total + value, 0);
    const altasQueued = (altasResult.data ?? []).length;
    // El tope de vídeos de Shopify no es un fallo del producto (desde el 17-11 la tanda se pausa sola): fuera de los errores.
    const capped = report.importer.reasons.filter((item) => item.status === "error" && VIDEO_CAP.test(item.reason)).reduce((total, item) => total + item.n, 0);
    const realErrors = Math.max(0, (byStatus.error ?? 0) - capped);
    sections.push({
      id: "importador", title: "Importador de productos", warn: realErrors > 0 || report.importer.open_jobs.some((job) => job.paused_reason),
      kpis: [
        { id: "altas-mhd", label: "Altas nuevas de MHD", value: altasQueued, sub: `${integer.format(processed)} procesados · ${integer.format(byStatus.descartado ?? 0)} descartados`, tone: "neutral" },
        { id: "errores-importador", label: "Errores del importador", value: realErrors, sub: [realErrors ? report.importer.reasons.find((item) => item.status === "error" && !VIDEO_CAP.test(item.reason))?.reason.slice(0, 70) : "Sin errores", capped ? `${integer.format(capped)} aplazados por el tope de vídeos` : "", report.importer.open_jobs.some((job) => job.paused_reason) ? "hay tandas en pausa" : ""].filter(Boolean).join(" · "), tone: realErrors ? "warn" : "ok" },
        { id: "gasto-ia", label: "Gasto de IA", value: Math.round(report.ai_cost.period * 100) / 100, text: dollars.format(report.ai_cost.period), sub: `${dollars.format(report.ai_cost.month)} este mes`, tone: "neutral" },
      ],
      lines: [
        ...(() => { const altas = altasResult.data ?? []; const photos = altas.filter((row) => (row.detail as { motivo?: string }).motivo === "fotos nuevas").length; return altas.length ? [`Altas encoladas solas en ${period}: ${integer.format(altas.length)} (${integer.format(altas.length - photos)} nuevas de MHD${photos ? ` y ${integer.format(photos)} que antes no tenían fotos` : ""}).`] : [`Ninguna alta nueva de MHD en ${period}.`]; })(),
        processed ? `${integer.format(processed)} productos en ${period}: ${integer.format(byStatus.ok ?? 0)} bien, ${integer.format(byStatus.descartado ?? 0)} descartados y ${integer.format(byStatus.error ?? 0)} con error.` : `Ningún producto procesado en ${period}.`,
        ...report.importer.open_jobs.map((job) => `Trabajo abierto «${job.title}»: ${integer.format(job.done)} de ${integer.format(job.total)}${job.errors ? `, ${job.errors} errores` : ""}${job.paused_reason ? ` · PAUSADO: ${job.paused_reason}` : ""}.`),
        `Gasto de IA: ${dollars.format(report.ai_cost.period)} en ${period}, ${dollars.format(report.ai_cost.today)} hoy y ${dollars.format(report.ai_cost.month)} este mes.`,
      ],
      table: report.importer.reasons.length ? { head: ["Resultado", "Motivo", "Productos", "Ejemplos"], rows: report.importer.reasons.map((item) => [item.status, item.reason, integer.format(item.n), item.codigos.join(", ")]) } : undefined,
      link: { text: "Ver los procesos en utils", href: `${UTILS}/importador-productos` },
    });

    sections.push({
      id: "revision", title: "Cola de revisión", warn: report.review.pending > 0,
      kpis: [{ id: "revision", label: "Esperando revisión", value: report.review.pending, sub: "Suben en borrador hasta revisarlos", tone: report.review.pending ? "warn" : "ok" }],
      lines: [`${integer.format(report.review.pending)} productos esperando revisión (suben en borrador hasta revisarlos).`],
      table: report.review.reasons.length ? { head: ["Motivo más repetido", "Productos"], rows: report.review.reasons.map((item) => [item.reason, integer.format(item.n)]) } : undefined,
      link: { text: "Revisar en utils", href: `${UTILS}/importador-productos` },
    });
  } else sections.push({ title: "Detalle no disponible", warn: true, lines: [`No se pudo leer el detalle: ${reportResult.error?.message ?? "sin motivo"}`] });

  // Colecciones vacías (empty-collections.ts): lo hecho, con su origen y destino, y lo que dice la última comprobación.
  const collectionRuns = cycles.flatMap((cycle) => cycle.steps.filter((item) => item.name === "colecciones-vacias" && (item.counts?.mode || item.counts?.failed)));
  const lastRun = collectionRuns.at(-1)?.counts as CollectionsRun | undefined;
  const done = (collectionsResult.data ?? []) as { kind: string; detail: { handle: string; origen: string; destino: string | null } }[];
  const simulated = lastRun?.mode === "simulación";
  const pending = simulated ? [...(lastRun.unpublish ?? []).map((item) => ({ kind: "despublicaría", detail: item })), ...(lastRun.publish ?? []).map((item) => ({ kind: "publicaría", detail: item }))] : [];
  const collectionErrors = collectionRuns.flatMap((item) => [...((item.counts as CollectionsRun).errors ?? []), ...((item.counts as CollectionsRun).failed ? [String((item.counts as CollectionsRun).failed)] : [])]);
  if (lastRun || done.length) sections.push({
    id: "colecciones", kpis: [{ id: "colecciones", label: "Colecciones", value: done.length, sub: `${done.filter((item) => item.kind === "despublicada").length} despublicadas · ${done.filter((item) => item.kind === "republicada").length} publicadas${simulated ? " · en simulación" : ""}`, tone: lastRun?.braked || collectionErrors.length ? "bad" : lastRun?.inMenu?.length ? "warn" : "neutral" }],
    title: "Colecciones y redirecciones", warn: done.length > 0 || Boolean(lastRun?.inMenu?.length) || Boolean(lastRun?.braked) || collectionErrors.length > 0,
    lines: [
      `En ${period}: ${done.filter((item) => item.kind === "despublicada").length} despublicadas y ${done.filter((item) => item.kind === "republicada").length} publicadas otra vez.`,
      ...(simulated ? ["Están en simulación: no se ha tocado nada, abajo sale lo que haría."] : []),
      ...(lastRun?.inMenu?.length ? [`Sin productos activos pero en un menú, no se tocan: ${lastRun.inMenu.join(", ")}.`] : []),
      ...(lastRun?.braked ? ["Freno: demasiadas colecciones vacías de golpe, no se ha despublicado ninguna."] : []),
      ...collectionErrors.map((item) => `Error: ${item}`),
    ],
    table: done.length || pending.length ? { head: ["Cambio", "Colección", "Origen", "Destino"], rows: [...done, ...pending].map((item) => [item.kind, item.detail.handle, item.detail.origen, item.detail.destino ?? "—"]) } : undefined,
  });

  // Procesos (vigilante de silencio) arriba del todo; el resto de lo añadido el 17-11, antes de los avisos.
  const [processes, ...extra] = await extraSections(db, now, since, period, cycles);
  sections.unshift(processes);
  sections.push(...extra);

  const sent = alertsResult.data ?? [];
  if (sent.length) sections.push({ id: "avisos", title: "Avisos enviados", warn: true, kpis: [{ id: "avisos", label: "Avisos enviados", value: sent.length, sub: "Fallos graves y frenos al momento", tone: "warn" }], lines: sent.map((item) => {
    const detail = item.detail as { subject?: string; sent?: boolean; lines?: string[] };
    return `${madridTime(item.created_at)} · ${detail.subject}${detail.lines?.length ? `: ${detail.lines.filter(Boolean).slice(1, 2).join(" ")}` : ""}${detail.sent ? "" : " (no se pudo enviar)"}`;
  }) });

  // Indicadores, en el orden de las secciones, con la cifra del informe anterior guardado (mhd_daily_reports).
  const { data: previous } = await db.from("mhd_daily_reports").select("kpis").eq("period_hours", hours).lt("period_end", new Date(now.getTime() - hours * 3_600_000 * 0.8).toISOString()).order("period_end", { ascending: false }).limit(1).maybeSingle();
  const before = new Map(((previous?.kpis ?? []) as Kpi[]).map((item) => [item.id, item.value]));
  const kpis = sections.flatMap((section) => (section.kpis ?? []).map((item) => ({ ...item, section: section.id, prev: before.get(item.id) ?? null })));

  const problems = sections.filter((section) => section.warn).length;
  const day = now.toLocaleDateString("es-ES", { timeZone: "Europe/Madrid", weekday: "long", day: "numeric", month: "long" });
  const subject = `${EMAIL_PREFIX} Resumen ${hours === 24 ? `del ${day}` : `de ${madridTime(since)} a ${madridTime(now.toISOString())}`} · ${problems ? `${problems} ${problems === 1 ? "punto que mirar" : "puntos que mirar"}` : "todo en orden"}`;
  return { subject, text: toText(sections, kpis), html: toHtml(sections, subject, kpis), sections: sections.map((section) => ({ ...section, kpis: undefined })), kpis, since, until: now.toISOString(), hours };
}

const cellText = (cell: Cell) => (typeof cell === "string" ? cell : cell.text);
const TONE: Record<Tone, { bar: string; text: string; mark: string }> = { ok: { bar: "#059669", text: "#065f46", mark: "" }, warn: { bar: "#d97706", text: "#92400e", mark: "⚠ " }, bad: { bar: "#dc2626", text: "#991b1b", mark: "✖ " }, neutral: { bar: "#a1a1aa", text: "#18181b", mark: "" } };
const kpiValue = (item: Kpi) => item.text ?? integer.format(item.value);
const kpiPrev = (item: Kpi) => (item.prev === null || item.prev === undefined || item.text?.includes(" de ") ? "" : item.prev === item.value ? "igual que el anterior" : `${item.value > item.prev ? "▲" : "▼"} ${integer.format(Math.abs(item.value - item.prev))} (antes ${integer.format(item.prev)})`);
type ReportKpi = Kpi & { section?: string };

function toText(sections: Section[], kpis: ReportKpi[]) {
  const grid = kpis.length ? `INDICADORES\n${kpis.map((item) => `- ${TONE[item.tone].mark}${item.label}: ${kpiValue(item)}${item.sub ? ` (${item.sub})` : ""}`).join("\n")}\nMás detalle: ${UTILS}/resumen\n\n` : "";
  return grid + sections.map((section) => [
    `${section.warn ? "⚠ " : ""}${section.title.toUpperCase()}`,
    ...section.lines.map((line) => `- ${line}`),
    ...(section.table ? ["", section.table.head.join(" | "), ...section.table.rows.map((row) => row.map(cellText).join(" | "))] : []),
    ...(section.link ? [`${section.link.text}: ${section.link.href}`] : []),
  ].join("\n")).join("\n\n") + `\n\n${UTILS}`;
}

function toHtml(sections: Section[], subject: string, kpis: ReportKpi[]) {
  // Rejilla de indicadores (tablas, para que se vea bien en cualquier correo): tres por fila, cada uno enlaza a su detalle.
  const tile = (item: ReportKpi) => `<td width="33%" style="padding:6px;vertical-align:top"><a href="${UTILS}/resumen${item.section ? `#${item.section}` : ""}" style="display:block;text-decoration:none;color:inherit;border:1px solid #e4e4e7;border-left:4px solid ${TONE[item.tone].bar};border-radius:8px;padding:10px 12px;background:#fff">
      <div style="font-size:12px;color:#71717a">${escapeHtml(item.label)}</div>
      <div style="font-size:24px;font-weight:600;line-height:1.3;color:${TONE[item.tone].text}">${escapeHtml(kpiValue(item))}</div>
      ${item.sub ? `<div style="font-size:12px;color:#52525b">${escapeHtml(item.sub)}</div>` : ""}
      ${kpiPrev(item) ? `<div style="font-size:11px;color:#a1a1aa;margin-top:2px">${escapeHtml(kpiPrev(item))}</div>` : ""}</a></td>`;
  const rows: ReportKpi[][] = [];
  for (let i = 0; i < kpis.length; i += 3) rows.push(kpis.slice(i, i + 3));
  const grid = kpis.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;margin:8px -6px 4px">${rows.map((row) => `<tr>${row.map(tile).join("")}${"<td></td>".repeat(3 - row.length)}</tr>`).join("")}</table>
    <p style="margin:4px 0 0"><a href="${UTILS}/resumen" style="color:#047857">Ver el resumen completo en utils →</a></p>` : "";
  const cell = (value: Cell) => (typeof value === "string" ? escapeHtml(value) : `<a href="${value.href}" style="color:#047857">${escapeHtml(value.text)}</a>`);
  const td = "padding:4px 8px;border-bottom:1px solid #e4e4e7;vertical-align:top";
  const body = sections.map((section) => `
    <h3${section.id ? ` id="${section.id}"` : ""} style="margin:24px 0 6px;font-size:16px;color:${section.warn ? "#b45309" : "#18181b"}">${section.warn ? "⚠ " : ""}${escapeHtml(section.title)}</h3>
    <ul style="margin:0;padding-left:18px">${section.lines.map((line) => `<li style="margin:2px 0">${escapeHtml(line)}</li>`).join("")}</ul>
    ${section.table ? `<table style="border-collapse:collapse;margin-top:8px;font-size:13px"><thead><tr>${section.table.head.map((head) => `<th style="${td};text-align:left;background:#f4f4f5">${escapeHtml(head)}</th>`).join("")}</tr></thead><tbody>${section.table.rows.map((row) => `<tr>${row.map((value) => `<td style="${td}">${cell(value)}</td>`).join("")}</tr>`).join("")}</tbody></table>` : ""}
    ${section.link ? `<p style="margin:6px 0 0"><a href="${section.link.href}" style="color:#047857">${escapeHtml(section.link.text)} →</a></p>` : ""}`).join("");
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;font-size:14px;color:#27272a;max-width:900px">
    <p style="margin:0 0 4px;font-size:12px;color:#71717a">${escapeHtml(subject)}</p>${grid}${body}
    <p style="margin:28px 0 0;font-size:12px;color:#71717a"><a href="${UTILS}" style="color:#047857">Abrir utils</a> · Correo automático de las sincronizaciones con MHD.</p></div>`;
}
