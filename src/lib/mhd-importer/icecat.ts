// Pieza del importador: resume la respuesta de Icecat en lo que usan el analista y el procesador.
// Función pura (sin red). Ver docs/IMPORTADOR_PRODUCTOS_MHD.md.

export type IcecatDocument = { type: string; description: string; url: string; language: string; sizeBytes: number | null };
export type IcecatSummary = {
  icecatId: number | null; title: string | null; brand: string | null; category: string | null; series: string | null;
  shortSummary: string | null; longSummary: string | null; bulletPoints: string[];
  specifications: Record<string, Record<string, string>>;
  gallery: { url: string; width: number | null; height: number | null; type: string | null; isMain: boolean }[];
  documents: IcecatDocument[]; youtubeIds: string[];
};

const record = (value: unknown) => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});
const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
const num = (value: unknown) => { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : null; };

// Secciones que no aportan a la ficha (las mismas que oculta la importación de Icecat actual).
const hiddenSections = new Set(["Peso y dimensiones del embalaje", "Empaquetado", "Datos logísticos", "Características del proveedor", "Detalles técnicos", "Aprobaciones reguladoras"]);

export function youtubeVideoId(url: string) {
  return url.match(/^https?:\/\/(?:www\.|m\.)?(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/))([A-Za-z0-9_-]{11})/)?.[1] ?? null;
}

export function summarizeIcecat(payload: Record<string, unknown> | null, language = "ES"): IcecatSummary | null {
  const data = record(record(payload).data);
  if (!Object.keys(data).length) return null;
  const info = record(data.GeneralInfo); const summary = record(info.SummaryDescription);
  const specifications: IcecatSummary["specifications"] = {};
  for (const groupValue of Array.isArray(data.FeaturesGroups) ? data.FeaturesGroups : []) {
    const group = record(groupValue); const groupName = text(record(record(group.FeatureGroup).Name).Value);
    if (!groupName || hiddenSections.has(groupName)) continue;
    for (const featureValue of Array.isArray(group.Features) ? group.Features : []) {
      const feature = record(featureValue); const name = text(record(record(feature.Feature).Name).Value); const value = text(feature.PresentationValue);
      if (name && value) (specifications[groupName] ??= {})[name] = value;
    }
  }
  const documents: IcecatDocument[] = []; const youtubeIds = new Set<string>();
  for (const itemValue of Array.isArray(data.Multimedia) ? data.Multimedia : []) {
    const item = record(itemValue); const url = text(item.URL);
    if (!url) continue;
    const youtubeId = youtubeVideoId(url);
    if (youtubeId) { youtubeIds.add(youtubeId); continue; }
    // Solo PDF y solo en el idioma de la tienda (decidido 2026-10-23).
    if (text(item.ContentType) === "application/pdf" && (text(item.Language) ?? "").toUpperCase() === language.toUpperCase()) {
      documents.push({ type: text(item.Type) ?? "pdf", description: text(item.Description) ?? "", url, language: text(item.Language) ?? language, sizeBytes: num(item.Size) });
    }
  }
  const bullets = record(info.GeneratedBulletPoints).Values;
  return {
    icecatId: num(info.IcecatId), title: text(record(record(info.TitleInfo).GeneratedLocalTitle).Value) ?? text(info.Title), brand: text(info.Brand),
    category: text(record(record(info.Category).Name).Value), series: text(record(info.ProductFamily).Value),
    shortSummary: text(summary.ShortSummaryDescription), longSummary: text(summary.LongSummaryDescription),
    bulletPoints: Array.isArray(bullets) ? bullets.filter((item): item is string => typeof item === "string") : [],
    specifications,
    gallery: (Array.isArray(data.Gallery) ? data.Gallery : []).map((value) => { const pic = record(value); return { url: text(pic.Pic) ?? "", width: num(pic.PicWidth), height: num(pic.PicHeight), type: text(pic.Type), isMain: pic.IsMain === "Y" }; }).filter((pic) => pic.url),
    documents, youtubeIds: [...youtubeIds],
  };
}
