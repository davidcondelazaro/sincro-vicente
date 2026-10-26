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
    const { error } = await db.storage.from(MEDIA_BUCKET).upload(pathFor(runId, file), file.bytes, { contentType: file.contentType, upsert: true });
    if (error) throw new Error(`No se pudo guardar ${file.filename}: ${error.message}`);
  }
  const { error } = await db.from("mhd_importer_media").insert(media.map((file) => ({ run_id: runId, role: file.role, position: file.position, filename: file.filename, content_type: file.contentType, width: file.width, height: file.height, storage_path: pathFor(runId, file), meta: file.meta })));
  if (error) throw error;
}

// Contenido de un archivo: del almacenamiento o, en las filas antiguas, de la propia tabla (bytea en hexadecimal).
export async function mediaBytes(db: SupabaseClient, row: { storage_path?: string | null; bytes?: string | null }): Promise<Uint8Array> {
  if (row.storage_path) {
    const { data, error } = await db.storage.from(MEDIA_BUCKET).download(row.storage_path);
    if (error || !data) throw new Error(`No se pudo leer ${row.storage_path}: ${error?.message ?? "sin datos"}`);
    return new Uint8Array(await data.arrayBuffer());
  }
  const hex = String(row.bytes ?? "");
  return Uint8Array.from(Buffer.from(hex.startsWith("\\x") ? hex.slice(2) : hex, "hex"));
}
