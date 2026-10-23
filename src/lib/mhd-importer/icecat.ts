// Pieza del importador: resume la respuesta de Icecat en lo que usan el analista y el procesador, y monta el
// metacampo `custom.icecat` (ficha técnica y vídeos) con el mismo formato que la importación de Icecat actual.
// Funciones puras (sin red). Ver docs/IMPORTADOR_PRODUCTOS_MHD.md.

export type IcecatDocument = { type: string; description: string; url: string; language: string; contentType: string; sizeBytes: number | null };
export type IcecatVideo = { url: string; language: string; description: string; contentType: string };
export type IcecatSummary = {
  icecatId: number | null; title: string | null; brand: string | null; category: string | null; series: string | null;
  shortSummary: string | null; longSummary: string | null; bulletPoints: string[];
  specifications: Record<string, Record<string, string>>;
  gallery: { url: string; width: number | null; height: number | null; type: string | null; isMain: boolean }[];
  // Documentos en el idioma de la tienda o sin idioma (la etiqueta y la ficha UE son documentos oficiales y a veces
  // vienen sin idioma). Los vídeos de YouTube, solo en el idioma de la tienda (decidido 2026-10-23).
  documents: IcecatDocument[]; youtubeIds: string[]; videos: IcecatVideo[];
  energyLabel: { url: string; contentType: string } | null; eprelId: string | null;
};

const record = (value: unknown) => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {});
const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null);
const num = (value: unknown) => { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : null; };

// Las mismas reglas que la importación de Icecat actual (supabase/functions/sync-catalog-imports): secciones y
// características que no se muestran y nombres que se corrigen.
const HIDDEN_SECTIONS = new Set(["Datos logísticos", "Características del proveedor", "Detalles técnicos", "Aprobaciones reguladoras"]);
const HIDDEN_FEATURES = new Set(["País de origen"]);
const REPLACEMENTS: [string, string][] = [["Empaquetado", "Contenido y dimensiones de la caja"], ["Control de energía", "Eficiencia energética"], ["Contenido y dimensiones", "Características del embalaje"], ["Características de Administración", "Otras Prestaciones"], ["Anaquel de almacenaje", "Estante de Almacenaje"], ["Multi beverage", "Bebida Múltiple"], ["Piernas", "Patas"]];

export function youtubeVideoId(url: string) {
  return url.match(/^https?:\/\/(?:www\.|m\.)?(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/))([A-Za-z0-9_-]{11})/)?.[1] ?? null;
}

export function summarizeIcecat(payload: Record<string, unknown> | null, language = "ES"): IcecatSummary | null {
  const data = record(record(payload).data);
  if (!Object.keys(data).length) return null;
  const lang = language.toUpperCase();
  const info = record(data.GeneralInfo); const summary = record(info.SummaryDescription);
  const specifications: IcecatSummary["specifications"] = {};
  for (const groupValue of Array.isArray(data.FeaturesGroups) ? data.FeaturesGroups : []) {
    const group = record(groupValue); const groupName = text(record(record(group.FeatureGroup).Name).Value);
    if (!groupName || HIDDEN_SECTIONS.has(groupName)) continue;
    for (const featureValue of Array.isArray(group.Features) ? group.Features : []) {
      const feature = record(featureValue); const name = text(record(record(feature.Feature).Name).Value); const value = text(feature.PresentationValue);
      if (name && value && !HIDDEN_FEATURES.has(name)) (specifications[groupName] ??= {})[name] = value;
    }
  }
  const documents: IcecatDocument[] = []; const youtubeIds = new Set<string>(); const videos: IcecatVideo[] = [];
  let energyLabel: IcecatSummary["energyLabel"] = null; let eprelId: string | null = null;
  for (const itemValue of Array.isArray(data.Multimedia) ? data.Multimedia : []) {
    const item = record(itemValue); const url = text(item.URL);
    if (!url) continue;
    const itemLang = (text(item.Language) ?? "").toUpperCase(); const contentType = text(item.ContentType) ?? "";
    const type = text(item.Type) ?? "";
    if (type === "EU Energy Label") {
      if (num(item.EprelId)) eprelId ??= String(num(item.EprelId));
      energyLabel ??= { url, contentType };
    }
    const youtubeId = youtubeVideoId(url);
    if (youtubeId) { if (itemLang === lang) youtubeIds.add(youtubeId); continue; }
    if (contentType.startsWith("video/") || item.IsVideo === 1 || item.IsVideo === "1") {
      if (!itemLang || itemLang === lang) videos.push({ url, language: itemLang, description: text(item.Description) ?? "", contentType });
      continue;
    }
    if (contentType === "application/pdf" && (!itemLang || itemLang === lang)) documents.push({ type, description: text(item.Description) ?? "", url, language: itemLang, contentType, sizeBytes: num(item.Size) });
  }
  const bullets = record(info.GeneratedBulletPoints).Values;
  return {
    icecatId: num(info.IcecatId), title: text(record(record(info.TitleInfo).GeneratedLocalTitle).Value) ?? text(info.Title), brand: text(info.Brand),
    category: text(record(record(info.Category).Name).Value), series: text(record(info.ProductFamily).Value),
    shortSummary: text(summary.ShortSummaryDescription), longSummary: text(summary.LongSummaryDescription),
    bulletPoints: Array.isArray(bullets) ? bullets.filter((item): item is string => typeof item === "string") : [],
    specifications,
    gallery: (Array.isArray(data.Gallery) ? data.Gallery : []).map((value) => { const pic = record(value); return { url: text(pic.Pic) ?? "", width: num(pic.PicWidth), height: num(pic.PicHeight), type: text(pic.Type), isMain: pic.IsMain === "Y" }; }).filter((pic) => pic.url),
    documents, youtubeIds: [...youtubeIds], videos, energyLabel, eprelId,
  };
}

function renamed(name: string) { return REPLACEMENTS.reduce((current, [search, replacement]) => current.replaceAll(search, replacement), name); }

// Metacampo `custom.icecat`: ficha técnica (de Icecat o, si no lo tiene, de las características de MHD) y vídeos de
// YouTube ya comprobados. El tema pinta `specifications` y `documents.youtube_videos`. Los PDF ya no van aquí: son
// archivos propios en `custom.documentos`.
export function icecatMetafield(icecat: IcecatSummary | null, mhdFeatures: { nombre: string; valor: string }[], youtubeVideos: Record<string, string>[]) {
  const specifications: Record<string, Record<string, string>> = {};
  if (icecat && Object.keys(icecat.specifications).length) {
    for (const [group, features] of Object.entries(icecat.specifications)) specifications[renamed(group)] = Object.fromEntries(Object.entries(features).map(([name, value]) => [renamed(name), value]));
  } else if (mhdFeatures.length) {
    specifications["Características"] = Object.fromEntries(mhdFeatures.filter((item) => item.nombre && item.valor).map((item) => [item.nombre, item.valor]));
  }
  if (!Object.keys(specifications).length && !youtubeVideos.length) return null;
  return {
    _icecat_id: icecat?.icecatId ?? null, _source: icecat && Object.keys(icecat.specifications).length ? "icecat" : "mhd", _synced_at: new Date().toISOString(),
    bullet_points: icecat?.bulletPoints ?? [], specifications,
    ...(youtubeVideos.length ? { documents: { youtube_videos: youtubeVideos } } : {}),
  };
}

// Vídeos de YouTube que se pueden insertar (oEmbed responde 401/403 si no se permite insertarlo y 404 si ya no existe),
// con el mismo formato que guarda la importación de Icecat actual.
export async function embeddableYoutubeVideos(ids: string[]) {
  const videos: Record<string, string>[] = [];
  for (const id of ids) {
    const url = `https://www.youtube.com/watch?v=${id}`;
    const video: Record<string, string> = { id, url, embed_url: `https://www.youtube-nocookie.com/embed/${id}` };
    try {
      const response = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(5_000) });
      if ([401, 403, 404].includes(response.status)) continue;
      if (response.ok) {
        const oembed = record(await response.json());
        if (text(oembed.title)) video.title = text(oembed.title) as string;
        video.thumbnail_url = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
      }
    } catch { /* YouTube no disponible: se guarda igualmente */ }
    videos.push(video);
  }
  return videos;
}
