// Archivos de cada prueba del importador (fotos tratadas, etiqueta energética, vídeos): desde el 2026-10-26 van al
// almacenamiento de Supabase (cubo privado «importador», carpeta pruebas/<prueba>/) y la tabla mhd_importer_media solo
// guarda la ruta. Antes iban en la propia tabla (columna `bytes`): ~1,3 MB por producto, que con el catálogo entero
// serían decenas de GB en la base. Las filas antiguas con `bytes` se siguen leyendo.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MediaFile } from "./processor";

export const MEDIA_BUCKET = "importador";
const pathFor = (runId: string, file: Pick<MediaFile, "role" | "position" | "filename">) => `pruebas/${runId}/${file.role}-${file.position}-${file.filename}`;

export async function saveRunMedia(db: SupabaseClient, runId: string, media: MediaFile[]) {
  if (!media.length) return;
  for (const file of media) {
    // Un segundo intento (2026-10-26): en el masivo, Supabase devolvía de vez en cuando «fetch failed» y el producto
    // entero se repetía por un archivo.
    let { error } = await db.storage.from(MEDIA_BUCKET).upload(pathFor(runId, file), file.bytes, { contentType: file.contentType, upsert: true });
    if (error) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      ({ error } = await db.storage.from(MEDIA_BUCKET).upload(pathFor(runId, file), file.bytes, { contentType: file.contentType, upsert: true }));
    }
    if (error) throw new Error(`No se pudo guardar ${file.filename}: ${error.message}`);
  }
  const { error } = await db.from("mhd_importer_media").insert(media.map((file) => ({ run_id: runId, role: file.role, position: file.position, filename: file.filename, content_type: file.contentType, width: file.width, height: file.height, storage_path: pathFor(runId, file), meta: file.meta })));
  if (error) throw new Error(`No se pudo apuntar los archivos de la prueba: ${error.message}`);
}

// Limpieza (David, 2026-10-26): al reprocesar un producto se borran los archivos de sus pruebas anteriores (almacenamiento
// y filas de mhd_importer_media) y solo quedan los de la última. Las pruebas en sí (textos, avisos, coste) se conservan.
// Sin esto, cada reprocesado del catálogo sumaría ~27 GB. Devuelve cuántos archivos ha borrado.
export async function pruneOlderRunMedia(db: SupabaseClient, codigo: string, keepRunId: string) {
  const { data: runs, error } = await db.from("mhd_importer_product_runs").select("id").eq("codigo", codigo).neq("id", keepRunId);
  if (error) throw error;
  if (!runs.length) return 0;
  let removed = 0;
  // De 50 en 50: con más, la dirección de la consulta es demasiado larga («URI too long»).
  for (let i = 0; i < runs.length; i += 50) {
    const ids = runs.slice(i, i + 50).map((run) => run.id as string);
    const { data: media, error: mediaError } = await db.from("mhd_importer_media").select("id,storage_path").in("run_id", ids);
    if (mediaError) throw mediaError;
    if (!media.length) continue;
    const paths = media.map((row) => row.storage_path as string | null).filter((path): path is string => Boolean(path));
    for (let j = 0; j < paths.length; j += 1000) {
      const { error: storageError } = await db.storage.from(MEDIA_BUCKET).remove(paths.slice(j, j + 1000));
      if (storageError) throw new Error(`No se pudieron borrar archivos antiguos de ${codigo}: ${storageError.message}`);
    }
    for (let j = 0; j < media.length; j += 50) {
      const { error: deleteError } = await db.from("mhd_importer_media").delete().in("id", media.slice(j, j + 50).map((row) => row.id as string));
      if (deleteError) throw deleteError;
    }
    removed += media.length;
  }
  return removed;
}

// Contenido de un archivo: del almacenamiento o, en las filas antiguas, de la propia tabla (bytea en hexadecimal).
// Descargas del almacén a la vez por trabajador (subida masiva, 2026-10-27): cada producto pedía todas sus fotos y
// vídeos de golpe y, con 8 productos en paralelo, el almacén de Supabase se quedaba sin conexiones («Too many
// connections issued to the database»). Se limitan y, si aun así contesta eso, se reintenta con espera.
const MAX_DOWNLOADS = 6;
let downloading = 0; const waiting: (() => void)[] = [];
async function withDownloadSlot<T>(task: () => Promise<T>) {
  if (downloading >= MAX_DOWNLOADS) await new Promise<void>((resolve) => waiting.push(resolve));
  downloading += 1;
  try { return await task(); } finally { downloading -= 1; waiting.shift()?.(); }
}

export async function mediaBytes(db: SupabaseClient, row: { storage_path?: string | null; bytes?: string | null }): Promise<Uint8Array> {
  if (row.storage_path) {
    const path = row.storage_path;
    for (let attempt = 1; ; attempt += 1) {
      const result = await withDownloadSlot(async (): Promise<{ bytes: Uint8Array; error: null } | { bytes: null; error: string }> => {
        const { data, error } = await db.storage.from(MEDIA_BUCKET).download(path);
        return error || !data ? { bytes: null, error: error?.message ?? "sin datos" } : { bytes: new Uint8Array(await data.arrayBuffer()), error: null };
      });
      if (result.bytes) return result.bytes;
      if (attempt >= 5 || !/too many connections|timeout|ECONNRESET|fetch failed/i.test(result.error)) throw new Error(`No se pudo leer ${path}: ${result.error}`);
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** (attempt - 1) + Math.random() * 500));
    }
  }
  const hex = String(row.bytes ?? "");
  return Uint8Array.from(Buffer.from(hex.startsWith("\\x") ? hex.slice(2) : hex, "hex"));
}
