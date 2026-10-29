import type { SupabaseClient } from "@supabase/supabase-js";
import { escapeHtml } from "@/lib/email";

// Resumen de las sincronizaciones y el importador (David, 2026-10-26: «resumen diario a las 9:00»; 2026-10-29: cada hora
// durante unos días, hasta que todo esté estable). Cuenta lo de las últimas `hours` horas (24 en el diario): lecturas de MHD, precio y stock enviados a Shopify, productos procesados, cola de revisión y
// avisos. Lo pendiente de montar (altas y bajas del listado, marcas nuevas) se añadirá aquí cuando exista.
type Section = { title: string; lines: string[]; warn?: boolean };
const integer = new Intl.NumberFormat("es-ES");
const dollars = new Intl.NumberFormat("es-ES", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

export async function buildDailyReport(db: SupabaseClient, now = new Date(), hours = 24) {
  const since = new Date(now.getTime() - hours * 3_600_000).toISOString();
  const [reads, syncs, items, review, alerts] = await Promise.all([
    db.from("mhd_catalog_import_runs").select("status,kind,error_message,started_at").gte("started_at", since),
    db.from("mhd_sync_events").select("kind,detail").eq("sync", "precio-stock").in("kind", ["vuelta", "error", "freno"]).gte("created_at", since),
    db.from("mhd_importer_job_items").select("status,cost_usd").gte("finished_at", since),
    db.from("mhd_importer_review_queue").select("codigo", { count: "exact", head: true }).eq("pending", true),
    db.from("mhd_sync_events").select("detail,created_at").eq("sync", "avisos").eq("kind", "correo").gte("created_at", since).order("created_at"),
  ]);
  const sections: Section[] = [];

  const runs = reads.data ?? [];
  const failed = runs.filter((run) => run.status === "failed");
  sections.push({ title: "Lecturas de MHD", warn: failed.length > 0 || runs.length === 0, lines: runs.length
    ? [`${runs.length} lecturas: ${runs.length - failed.length} terminadas y ${failed.length} fallidas.`, ...failed.slice(0, 5).map((run) => `Fallida (${run.kind}): ${run.error_message ?? "sin motivo"}`)]
    : [`Ninguna lectura en ${hours === 1 ? "la última hora" : `las últimas ${hours} horas`}.`] });

  const events = syncs.data ?? [];
  const rounds = events.filter((item) => item.kind !== "freno");
  const sum = (key: string) => rounds.reduce((total, item) => total + Number((item.detail as Record<string, unknown>)[key] ?? 0), 0);
  const brakes = events.filter((item) => item.kind === "freno");
  const withErrors = events.filter((item) => item.kind === "error");
  sections.push({ title: "Precio y stock en Shopify", warn: brakes.length + withErrors.length > 0, lines: [
    `${rounds.length} vueltas: ${integer.format(sum("pricesSent"))} precios y ${integer.format(sum("stockSent"))} existencias cambiadas.`,
    ...(brakes.length ? [`${brakes.length} vueltas paradas por el freno. Última: ${(brakes.at(-1)!.detail as { reason?: string }).reason ?? "sin motivo"}`] : []),
    ...(withErrors.length ? [`${withErrors.length} vueltas con errores al enviar.`] : []),
  ] });

  const done = items.data ?? [];
  const count = (status: string) => done.filter((item) => item.status === status).length;
  const cost = done.reduce((total, item) => total + Number(item.cost_usd ?? 0), 0);
  sections.push({ title: "Importador de productos", warn: count("error") > 0, lines: done.length
    ? [`${integer.format(done.length)} productos: ${integer.format(count("ok"))} bien, ${integer.format(count("descartado"))} descartados y ${integer.format(count("error"))} con error. Coste de IA: ${dollars.format(cost)}.`]
    : ["Ningún producto procesado."] });

  sections.push({ title: "Cola de revisión", lines: [`${integer.format(review.count ?? 0)} productos esperando revisión.`] });

  const sent = alerts.data ?? [];
  if (sent.length) sections.push({ title: "Avisos del día", warn: true, lines: sent.map((item) => {
    const detail = item.detail as { subject?: string; sent?: boolean };
    return `${new Date(item.created_at).toLocaleTimeString("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit" })} · ${detail.subject}${detail.sent ? "" : " (no se pudo enviar)"}`;
  }) });

  const problems = sections.filter((section) => section.warn).length;
  const day = now.toLocaleDateString("es-ES", { timeZone: "Europe/Madrid", weekday: "long", day: "numeric", month: "long" });
  const hour = now.toLocaleTimeString("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit" });
  const subject = `[Utils] Resumen ${hours === 24 ? `del ${day}` : `de las ${hour} (${hours === 1 ? "última hora" : `últimas ${hours} horas`})`}${problems ? ` · ${problems} ${problems === 1 ? "punto que mirar" : "puntos que mirar"}` : " · todo en orden"}`;
  const text = sections.map((section) => [`${section.warn ? "⚠ " : ""}${section.title}`, ...section.lines.map((line) => `- ${line}`)].join("\n")).join("\n\n") + "\n\nhttps://utils.electronicavicente.com";
  const html = sections.map((section) => `<h3 style="margin:16px 0 4px">${section.warn ? "⚠ " : ""}${escapeHtml(section.title)}</h3><ul style="margin:0">${section.lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`).join("") + `<p><a href="https://utils.electronicavicente.com">Abrir utils</a></p>`;
  return { subject, text, html, sections };
}
