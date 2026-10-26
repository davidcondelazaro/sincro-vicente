import { importerSession } from "@/lib/mhd-importer/server";
import { fetchMhdMedia } from "@/lib/mhd-importer/sources";
import { mediaBytes } from "@/lib/mhd-importer/media-store";

// Muestra en la web las fotos de una prueba: ?media=<id> sirve un archivo ya tratado (foto o etiqueta, guardado en
// mhd_importer_media); ?url= sirve el original de MHD, que solo se entrega con cabeceras de navegador y Referer.

export const runtime = "nodejs";
const ALLOWED = ["cdn.mihogardigital.es", "s3-eu-west-1.amazonaws.com", "www.mihogardigital.es"];

export async function GET(request: Request) {
  const session = await importerSession();
  if (!session) return new Response("Necesitas iniciar sesión.", { status: 401 });
  const params = new URL(request.url).searchParams;
  const mediaId = params.get("media");
  if (mediaId) {
    const { data, error } = await session.db.from("mhd_importer_media").select("content_type,bytes,storage_path").eq("id", mediaId).maybeSingle();
    if (error || !data) return new Response("No existe.", { status: 404 });
    return new Response(Buffer.from(await mediaBytes(session.db, data)), { headers: { "Content-Type": data.content_type, "Cache-Control": "private, max-age=3600" } });
  }
  const url = params.get("url") ?? "";
  let host = ""; try { host = new URL(url).hostname; } catch { /* URL no válida */ }
  if (!ALLOWED.includes(host)) return new Response("Origen no permitido.", { status: 400 });
  try {
    const media = await fetchMhdMedia(url);
    return new Response(Buffer.from(media.bytes), { headers: { "Content-Type": media.contentType, "Cache-Control": "private, max-age=3600" } });
  } catch (caught) {
    return new Response(caught instanceof Error ? caught.message : "No se pudo leer la imagen.", { status: 502 });
  }
}
