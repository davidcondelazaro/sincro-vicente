import type { SupabaseClient } from "@supabase/supabase-js";
import type { CycleStep } from "./sync-cycle";

// Secciones del resumen añadidas el 2026-11-17 (David: «¿qué se me puede escapar de todos los procesos nuevos?»).
// - Procesos: cada proceso con cuándo dio señales por última vez y cada cuánto debería darlas. Si calla, sale en rojo.
//   Los pasos de la vuelta salen solos (los nuevos también): cuántas veces fueron bien, se saltaron o fallaron, y por qué.
// - Lo que el importador deja en Shopify (activos, borradores, actualizados, textos, vídeos), portes, proveedor,
//   relaciones, tarifas de servicios, Garantía3, y marcas, familias y subfamilias nuevas o que no pueden entrar.
export type Cell = string | { text: string; href: string };
// Indicador de la rejilla de arriba (correo y página Resumen): cifra, una línea de detalle y color. `prev` es la cifra del
// informe anterior guardado, para comparar.
export type Tone = "ok" | "warn" | "bad" | "neutral";
export type Kpi = { id: string; label: string; value: number; text?: string; sub?: string; tone: Tone; prev?: number | null };
export type Section = { id?: string; title: string; warn?: boolean; lines: string[]; table?: { head: string[]; rows: Cell[][] }; link?: { text: string; href: string }; kpis?: Kpi[] };
type Cycle = { started_at: string; steps: CycleStep[] };
type Novelties = {
  marcas: { name: string; productos: number; en_tienda: number }[];
  familias: { code: string; name: string; productos: number; con_reglas: boolean }[];
  subfamilias: { code: string; name: string; productos: number; colocada: boolean }[];
  bloqueadas: { familia: string; subfamilia: string; code: string; motivo: string; productos: number }[];
};

const UTILS = "https://utils.electronicavicente.com";
const integer = new Intl.NumberFormat("es-ES");
const madrid = (iso: string) => new Date(iso).toLocaleString("es-ES", { timeZone: "Europe/Madrid", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
const ago = (iso: string | null | undefined, now: Date) => {
  if (!iso) return "nunca";
  const minutes = Math.round((now.getTime() - new Date(iso).getTime()) / 60_000);
  return minutes < 90 ? `hace ${minutes} min` : minutes < 48 * 60 ? `hace ${Math.round(minutes / 60)} h` : `hace ${Math.round(minutes / 1440)} días`;
};
const sum = <T,>(rows: T[], pick: (row: T) => unknown) => rows.reduce((total, row) => total + (Number(pick(row)) || 0), 0);
const shopifyLink = (title: string | null | undefined, productId: string | null | undefined, codigo: string): Cell => {
  const id = productId?.split("/").pop();
  return id ? { text: title ?? codigo, href: `https://admin.shopify.com/store/electronica-vicente/products/${id}` } : title ?? codigo;
};

// Procesos con su plazo: si pasan más horas que `maxHours` sin señales, algo se ha parado.
type Process = { name: string; maxHours: number; last: string | null; note?: string };

export async function extraSections(db: SupabaseClient, now: Date, since: string, period: string, cycles: Cycle[]) {
  const events = (sync: string) => db.from("mhd_sync_events").select("kind,codigo,detail,created_at").eq("sync", sync).gte("created_at", since).order("created_at").limit(5000);
  const lastEvent = (sync: string, kinds: string[]) => db.from("mhd_sync_events").select("created_at").eq("sync", sync).in("kind", kinds).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const [uploads, delivery, supplier, relations, warranties, lastCycle, lastRelations, lastWarranty, lastImporter, novelties, ignored] = await Promise.all([
    events("importador"), events("opciones-entrega"), events("proveedor"), events("relaciones"),
    db.from("garantia3_vueltas").select("inicio,fin,origen,resumen").gte("inicio", since).order("inicio"),
    db.from("mhd_sync_cycles").select("started_at").order("started_at", { ascending: false }).limit(1).maybeSingle(),
    lastEvent("relaciones", ["vuelta", "error"]),
    db.from("garantia3_vueltas").select("inicio").order("inicio", { ascending: false }).limit(1).maybeSingle(),
    db.from("mhd_importer_job_items").select("finished_at").not("finished_at", "is", null).order("finished_at", { ascending: false }).limit(1).maybeSingle(),
    db.rpc("mhd_report_novelties", { p_since: since }),
    db.from("store_settings").select("value").eq("key", "report_ignored_families").maybeSingle(),
  ]);
  const sections: Section[] = [];

  // Procesos: el vigilante de silencio y los pasos de la vuelta.
  const processes: Process[] = [
    { name: "Vuelta de sincronización (cada 30 min)", maxHours: 1.5, last: lastCycle.data?.started_at ?? null },
    { name: "Relaciones entre productos (cada noche, 4:45)", maxHours: 26, last: lastRelations.data?.created_at ?? null },
    { name: "Garantía3 (cada día, 9:00)", maxHours: 26, last: lastWarranty.data?.inicio ?? null },
    { name: "Importador (último producto terminado)", maxHours: 72, last: lastImporter.data?.finished_at ?? null, note: "solo trabaja cuando hay tandas" },
  ];
  const silent = processes.filter((item) => !item.last || now.getTime() - new Date(item.last).getTime() > item.maxHours * 3_600_000);
  const steps = new Map<string, { ok: number; saltado: number; error: number; last?: string }>();
  for (const cycle of cycles) for (const item of cycle.steps) {
    const entry = steps.get(item.name) ?? { ok: 0, saltado: 0, error: 0 };
    const status = item.status === "error" ? "error" : item.status === "saltado" ? "saltado" : "ok";
    entry[status] += 1;
    if (status !== "ok") entry.last = `${madrid(cycle.started_at)}: ${item.error ?? String(item.counts?.reason ?? (item.counts?.off ? "apagado en Configuración" : "sin motivo"))}`;
    steps.set(item.name, entry);
  }
  const failing = [...steps.values()].filter((item) => item.error > 0).length;
  const stepErrors = [...steps.values()].reduce((total, item) => total + item.error, 0);
  sections.push({
    id: "procesos", title: "Procesos", warn: silent.length > 0 || failing > 0,
    kpis: [
      { id: "procesos", label: "Procesos en marcha", value: processes.length - silent.length, text: `${processes.length - silent.length} de ${processes.length}`, sub: silent.length ? `Sin señales: ${silent.map((item) => item.name.split(" (")[0]).join(", ")}` : "Todos han dado señales a tiempo", tone: silent.length ? "bad" : "ok" },
      { id: "errores-vuelta", label: "Errores en la vuelta", value: stepErrors, sub: stepErrors ? `En ${failing} ${failing === 1 ? "paso" : "pasos"}` : "Ningún paso ha fallado", tone: stepErrors ? "bad" : "ok" },
    ],
    lines: [
      silent.length ? `Sin señales en su plazo: ${silent.map((item) => `${item.name}, ${ago(item.last, now)}${item.note ? ` (${item.note})` : ""}`).join(" · ")}.` : "Todos los procesos han dado señales en su plazo.",
      ...processes.filter((item) => !silent.includes(item)).map((item) => `${item.name}: ${ago(item.last, now)}.`),
    ],
    table: steps.size ? { head: ["Paso de la vuelta", "Bien", "Saltado", "Error", "Último aviso"], rows: [...steps].map(([name, item]) => [name, integer.format(item.ok), integer.format(item.saltado), item.error ? `${integer.format(item.error)} ⚠` : "0", item.last ?? "—"]) } : undefined,
    link: { text: "Ver las vueltas en utils", href: `${UTILS}/importar-datos-mhd` },
  });

  // Lo que el importador deja en Shopify (registrado desde el 2026-11-17).
  type Upload = { kind: string; codigo: string; detail: { status?: string; product_id?: string; title?: string; videos?: number; videosAplazados?: number; producto?: number; marca?: number } };
  const up = (uploads.data ?? []) as Upload[];
  const created = up.filter((item) => item.kind === "creado");
  const active = created.filter((item) => item.detail.status === "ACTIVE");
  const drafts = created.filter((item) => item.detail.status !== "ACTIVE");
  const updated = up.filter((item) => item.kind === "actualizado");
  const texts = up.filter((item) => item.kind === "textos");
  const videoRuns = up.filter((item) => item.kind === "videos");
  const videos = sum([...created, ...updated], (item) => item.detail.videos) + sum(videoRuns, (item) => (item.detail.producto ?? 0) + (item.detail.marca ?? 0));
  const deferred = sum([...created, ...updated], (item) => item.detail.videosAplazados);
  sections.push({
    id: "tienda", title: "Lo que el importador ha dejado en la tienda", warn: drafts.length > 0 || deferred > 0,
    kpis: [
      { id: "altas-tienda", label: "Altas en la tienda", value: created.length, sub: `${integer.format(active.length)} activas · ${integer.format(drafts.length)} en borrador`, tone: drafts.length ? "warn" : "neutral" },
      { id: "fichas-actualizadas", label: "Fichas actualizadas", value: updated.length + texts.length, sub: `${integer.format(updated.length)} enteras · ${integer.format(texts.length)} solo textos`, tone: "neutral" },
      { id: "videos", label: "Vídeos subidos", value: videos, sub: deferred ? `${integer.format(deferred)} aplazados por el tope de Shopify` : "Ninguno aplazado", tone: deferred ? "warn" : "neutral" },
    ],
    lines: [
      `Altas: ${integer.format(created.length)} (${integer.format(active.length)} activas y ${integer.format(drafts.length)} en borrador, esperando revisión).`,
      `Fichas actualizadas: ${integer.format(updated.length)} enteras y ${integer.format(texts.length)} solo textos.`,
      `Vídeos subidos: ${integer.format(videos)}${videoRuns.length ? ` (${integer.format(videoRuns.length)} productos en tandas «solo vídeos»)` : ""}.${deferred ? ` ${integer.format(deferred)} vídeos aplazados por el tope de Shopify: los pondrá una tanda «solo vídeos».` : ""}`,
    ],
    table: drafts.length ? { head: ["En borrador", "Código"], rows: drafts.slice(0, 30).map((item) => [shopifyLink(item.detail.title, item.detail.product_id, item.codigo), item.codigo]) } : undefined,
    link: { text: "Revisar en utils", href: `${UTILS}/importador-productos` },
  });

  // Portes y servicios (opciones de entrega).
  type Run = { kind: string; detail: Record<string, unknown> };
  const deliveryRuns = ((delivery.data ?? []) as Run[]).filter((item) => item.kind === "vuelta" || item.kind === "error");
  const deliveryBrakes = ((delivery.data ?? []) as Run[]).filter((item) => item.kind === "freno");
  const deliveryNotable = deliveryRuns.flatMap((item) => (item.detail.notable as string[] | undefined) ?? []);
  const deliveryErrors = deliveryRuns.flatMap((item) => (item.detail.errors as string[] | undefined) ?? []);
  sections.push({
    id: "portes", title: "Portes y servicios", warn: deliveryBrakes.length > 0 || deliveryErrors.length > 0,
    kpis: [{ id: "portes", label: "Portes y servicios", value: sum(deliveryRuns, (item) => item.detail.sent), sub: deliveryBrakes.length ? "Parado por el freno" : deliveryErrors.length ? `${deliveryErrors.length} errores` : `${integer.format(deliveryNotable.length)} cambios fuertes`, tone: deliveryBrakes.length || deliveryErrors.length ? "bad" : "neutral" }],
    lines: [
      `${integer.format(sum(deliveryRuns, (item) => item.detail.sent))} productos con portes o servicios actualizados en Shopify${deliveryNotable.length ? `; ${integer.format(deliveryNotable.length)} cambios fuertes (dato quitado o subida de más del 50 %)` : ""}.`,
      ...(deliveryBrakes.length ? [`Freno: ${String(deliveryBrakes.at(-1)!.detail.reason ?? "")}`] : []),
      ...deliveryErrors.slice(0, 5).map((item) => `Error: ${item}`),
    ],
    table: deliveryNotable.length ? { head: ["Cambios fuertes (los primeros)"], rows: deliveryNotable.slice(0, 15).map((item) => [item]) } : undefined,
  });

  // Proveedor de MHD.
  const supplierRuns = ((supplier.data ?? []) as Run[]).filter((item) => item.kind === "vuelta" || item.kind === "error");
  const supplierBrakes = ((supplier.data ?? []) as Run[]).filter((item) => item.kind === "freno");
  const switched = supplierRuns.flatMap((item) => (item.detail.switched as string[] | undefined) ?? []);
  const supplierErrors = supplierRuns.flatMap((item) => (item.detail.errors as string[] | undefined) ?? []);
  const supplierPending = Number(supplierRuns.at(-1)?.detail.pending ?? 0);
  sections.push({
    id: "proveedor", title: "Proveedor de MHD", warn: supplierBrakes.length > 0 || supplierErrors.length > 0,
    kpis: [{ id: "proveedor", label: "Proveedor actualizado", value: sum(supplierRuns, (item) => item.detail.sent), sub: supplierErrors.length ? `${supplierErrors.length} errores` : `${integer.format(switched.length)} cambian de proveedor${supplierBrakes.length ? " · freno" : ""}`, tone: supplierErrors.length ? "bad" : supplierBrakes.length ? "warn" : "neutral" }],
    lines: [
      `${integer.format(sum(supplierRuns, (item) => item.detail.sent))} productos con el proveedor actualizado; ${integer.format(switched.length)} cambian de proveedor (revisa si les afecta alguna regla).${supplierPending ? ` Pendientes para la próxima vuelta: ${integer.format(supplierPending)}.` : ""}`,
      ...(supplierBrakes.length ? [`Freno ${supplierBrakes.length} ${supplierBrakes.length === 1 ? "vez" : "veces"}: ${String(supplierBrakes.at(-1)!.detail.reason ?? "")} Se cambia en Configuración.`] : []),
      ...supplierErrors.slice(0, 5).map((item) => `Error: ${item}`),
    ],
  });

  // Relaciones entre productos (complementarios y similares).
  const relationRuns = ((relations.data ?? []) as Run[]).filter((item) => item.kind === "vuelta" || item.kind === "error" || item.kind === "freno");
  const lastRelation = relationRuns.at(-1);
  const relationErrors = relationRuns.flatMap((item) => (item.detail.errors as string[] | undefined) ?? []);
  sections.push({
    id: "relaciones", kpis: [{ id: "relaciones", label: "Relaciones cambiadas", value: Number(lastRelation?.detail.changes ?? 0), sub: !lastRelation ? "No se han calculado" : lastRelation.kind === "freno" ? "Parado por el freno" : lastRelation.detail.complementarios !== undefined ? `${integer.format(Number(lastRelation.detail.complementarios))} complementarios · ${integer.format(Number(lastRelation.detail.similares))} similares` : `${integer.format(Number(lastRelation.detail.sent ?? 0))} enviadas`, tone: !lastRelation || lastRelation.kind !== "vuelta" || relationErrors.length ? "bad" : "neutral" }],
    title: "Relaciones entre productos", warn: !lastRelation || lastRelation.kind !== "vuelta" || relationErrors.length > 0,
    lines: lastRelation ? [
      lastRelation.kind === "freno" ? `Freno: ${String(lastRelation.detail.reason ?? "")}` : `Calculadas para ${integer.format(Number(lastRelation.detail.calculated ?? 0))} productos; cambian ${integer.format(Number(lastRelation.detail.changes ?? 0))}${lastRelation.detail.complementarios !== undefined ? ` (${integer.format(Number(lastRelation.detail.complementarios))} en complementarios y ${integer.format(Number(lastRelation.detail.similares))} en similares)` : ""}, enviadas ${integer.format(Number(lastRelation.detail.sent ?? 0))}${Number(lastRelation.detail.manual) ? ` y ${integer.format(Number(lastRelation.detail.manual))} puestas a mano que no se tocan` : ""}.`,
      ...relationErrors.slice(0, 5).map((item) => `Error: ${item}`),
    ] : [`No se han calculado en ${period}.`],
  });

  // Garantía3.
  type WarrantyRun = { resumen: Record<string, unknown> | null; fin: string | null };
  const warrantyRuns = (warranties.data ?? []) as WarrantyRun[];
  const w = (key: string) => sum(warrantyRuns, (item) => item.resumen?.[key]);
  const warrantyFailures = warrantyRuns.flatMap((item) => (item.resumen?.fallos as unknown[] | undefined) ?? []).map((item) => (typeof item === "string" ? item : JSON.stringify(item)));
  const unfinished = warrantyRuns.filter((item) => !item.fin).length;
  const warrantyIssues = w("errores") + w("dudosas") + w("bloqueadas") + warrantyFailures.length + unfinished;
  sections.push({
    id: "garantia3", kpis: [{ id: "garantia3", label: "Contratos Garantía3", value: w("creadas"), sub: warrantyRuns.length ? `${integer.format(w("nuevas"))} vendidas · ${integer.format(warrantyIssues)} para mirar` : "Sin vueltas", tone: !warrantyRuns.length || w("errores") || warrantyFailures.length ? "bad" : warrantyIssues ? "warn" : "neutral" }],
    title: "Garantía3", warn: w("errores") > 0 || w("dudosas") > 0 || w("bloqueadas") > 0 || warrantyFailures.length > 0 || unfinished > 0,
    lines: warrantyRuns.length ? [
      `${warrantyRuns.length} ${warrantyRuns.length === 1 ? "vuelta" : "vueltas"}: ${integer.format(w("nuevas"))} garantías vendidas nuevas, ${integer.format(w("creadas"))} contratos dados de alta, ${integer.format(w("anulaciones"))} anulaciones.`,
      ...(w("dudosas") || w("bloqueadas") || w("errores") ? [`Para mirar: ${integer.format(w("dudosas"))} dudosas, ${integer.format(w("bloqueadas"))} bloqueadas y ${integer.format(w("errores"))} con error.`] : []),
      ...(unfinished ? [`${unfinished} ${unfinished === 1 ? "vuelta sin terminar" : "vueltas sin terminar"}.`] : []),
      ...warrantyFailures.slice(0, 5).map((item) => `Fallo: ${item}`),
    ] : [`Ninguna vuelta de Garantía3 en ${period}.`],
    link: { text: "Ver los contratos en utils", href: `${UTILS}/tienda/contratos-garantia3` },
  });

  // Tarifas de servicios: variantes de precio que faltan en Shopify (última comprobación).
  const tariffs = [...cycles].reverse().flatMap((cycle) => cycle.steps.filter((item) => item.name === "tarifas-servicios" && item.counts)).at(0)?.counts as { missing?: { service: string; sku: string; products: number }[]; products?: number } | undefined;
  if (tariffs) sections.push({
    id: "tarifas", kpis: tariffs.missing?.length ? [{ id: "tarifas", label: "Tarifas que faltan", value: tariffs.missing.length, sub: "Servicios que no se pueden cobrar", tone: "bad" }] : [],
    title: "Tarifas de servicios", warn: Boolean(tariffs.missing?.length),
    lines: [tariffs.missing?.length ? `Faltan ${tariffs.missing.length} tarifas en Shopify: hay productos con un precio de servicio que no se puede cobrar.` : `Todas las tarifas existen (${integer.format(tariffs.products ?? 0)} productos con servicios).`],
    table: tariffs.missing?.length ? { head: ["Servicio", "SKU que falta", "Productos"], rows: tariffs.missing.slice(0, 20).map((item) => [item.service, item.sku, integer.format(item.products)]) } : undefined,
  });

  // Redirecciones (2026-11-17): las que crean o quitan los procesos en Shopify (colecciones vacías y productos que
  // vuelven), las propuestas de la base sin revisar y si las colecciones siguen en simulación.
  const [redirectEvents, collectionEvents, proposed, loaded, applyCollections] = await Promise.all([
    db.from("mhd_sync_events").select("kind,detail").eq("sync", "redirecciones").gte("created_at", since).limit(2000),
    db.from("mhd_sync_events").select("kind,detail").eq("sync", "colecciones").in("kind", ["despublicada", "republicada"]).gte("created_at", since).limit(2000),
    db.from("store_redirects").select("id", { count: "exact", head: true }).eq("status", "propuesta"),
    db.from("store_redirects").select("id", { count: "exact", head: true }).eq("status", "cargada"),
    db.from("store_settings").select("value").eq("key", "empty_collections_apply").maybeSingle(),
  ]);
  type RedirectEvent = { kind: string; detail: { origen?: string; destino?: string | null; handle?: string; cuantas?: number } };
  const fromCollections = (collectionEvents.data ?? []) as RedirectEvent[];
  const removedProducts = ((redirectEvents.data ?? []) as RedirectEvent[]).filter((item) => item.kind === "quitada");
  const createdRedirects = fromCollections.filter((item) => item.kind === "despublicada").length;
  const removedRedirects = fromCollections.filter((item) => item.kind === "republicada").length + sum(removedProducts, (item) => item.detail.cuantas ?? 1);
  const pendingReview = proposed.count ?? 0;
  const simulating = applyCollections.data?.value !== true;
  sections.push({
    id: "redirecciones", title: "Redirecciones", warn: pendingReview > 0 || simulating,
    kpis: [{ id: "redirecciones", label: "Redirecciones", value: createdRedirects + removedRedirects, sub: [`${integer.format(createdRedirects)} creadas · ${integer.format(removedRedirects)} quitadas`, pendingReview ? `${pendingReview} por revisar` : "", simulating ? "colecciones en simulación" : ""].filter(Boolean).join(" · "), tone: pendingReview || simulating ? "warn" : "neutral" }],
    lines: [
      `En ${period}: ${integer.format(createdRedirects)} creadas en Shopify (colecciones que se quedan sin productos) y ${integer.format(removedRedirects)} quitadas (colecciones que los recuperan y productos que vuelven).`,
      `Base de redirecciones: ${integer.format(loaded.count ?? 0)} cargadas en Shopify${pendingReview ? `; ${integer.format(pendingReview)} propuestas sin revisar` : ""}.`,
      ...(simulating ? ["Colecciones vacías en simulación: todavía no crean ni quitan redirecciones, solo dicen lo que harían (ajuste empty_collections_apply)."] : []),
      "Bajas definitivas (archivar y redirigir productos): todavía no existen.",
    ],
    table: removedProducts.length ? { head: ["Quitada porque el producto vuelve", "Redirecciones"], rows: removedProducts.slice(0, 20).map((item) => [item.detail.origen ?? "—", integer.format(item.detail.cuantas ?? 1)]) } : undefined,
    link: { text: "Ver las redirecciones en utils", href: `${UTILS}/tienda/redirecciones` },
  });

  // Marcas, familias y subfamilias nuevas en MHD, y lo que no puede entrar en la tienda.
  const news = novelties.data as Novelties | null;
  if (news) {
    const ignoredList = Array.isArray(ignored.data?.value) ? (ignored.data!.value as string[]).join(", ") : "";
    const blockedProducts = sum(news.bloqueadas, (item) => item.productos);
    const newCount = news.marcas.length + news.familias.length + news.subfamilias.length;
    sections.push({
      id: "marcas", kpis: [
        { id: "marcas-familias", label: "Marcas y familias nuevas", value: newCount, sub: newCount ? `${news.marcas.length} marcas · ${news.familias.length} familias · ${news.subfamilias.length} subfamilias` : "Ninguna en el periodo", tone: newCount ? "warn" : "neutral" },
        { id: "no-pueden-entrar", label: "No pueden entrar en la tienda", value: blockedProducts, sub: news.bloqueadas.length ? `${news.bloqueadas.length} subfamilias sin reglas o sin sitio` : "Todo tiene reglas y sitio", tone: blockedProducts ? "warn" : "ok" },
      ],
      title: "Marcas y familias", warn: news.marcas.length + news.familias.length + news.subfamilias.length + news.bloqueadas.length > 0,
      lines: [
        news.marcas.length ? `Marcas nuevas en MHD: ${news.marcas.map((item) => `${item.name} (${item.productos} productos, ${item.en_tienda} en la tienda)`).join(" · ")}.` : `Ninguna marca nueva en MHD en ${period}.`,
        news.familias.length ? `Familias nuevas: ${news.familias.map((item) => `${item.name} (${item.productos} productos${item.con_reglas ? "" : ", SIN REGLAS"})`).join(" · ")}.` : `Ninguna familia nueva en ${period}.`,
        ...(news.subfamilias.length ? [`Subfamilias nuevas: ${news.subfamilias.map((item) => `${item.name} (${item.productos} productos${item.colocada ? "" : ", SIN SITIO EN LA TIENDA"})`).join(" · ")}.`] : []),
        news.bloqueadas.length ? `No pueden entrar en la tienda: ${integer.format(blockedProducts)} productos de ${news.bloqueadas.length} subfamilias (sin reglas o sin sitio en el árbol)${ignoredList ? `; no cuentan las familias que se dejan fuera a propósito (${ignoredList})` : ""}.` : "Todo lo que trae MHD tiene reglas y sitio en la tienda.",
      ],
      table: news.bloqueadas.length ? { head: ["Familia", "Subfamilia", "Motivo", "Productos"], rows: news.bloqueadas.slice(0, 20).map((item) => [item.familia, `${item.subfamilia} (${item.code})`, item.motivo, integer.format(item.productos)]) } : undefined,
      link: { text: "Reglas por familia en utils", href: `${UTILS}/reglas-por-familia` },
    });
  }
  return sections;
}
