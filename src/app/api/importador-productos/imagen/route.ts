import { energyLabelPng } from "@/lib/mhd-importer/images";
import { importerSession } from "@/lib/mhd-importer/server";
import { fetchMhdMedia } from "@/lib/mhd-importer/sources";

// Muestra en la web las fotos y etiquetas de MHD, que solo se sirven con cabeceras de navegador y Referer.
// Solo deja pasar los dos orígenes de MHD. ?label=1 convierte la etiqueta SVG a PNG (como se subiría a Shopify).

export const runtime = "nodejs";
const ALLOWED = ["cdn.mihogardigital.es", "s3-eu-west-1.amazonaws.com", "www.mihogardigital.es"];

export async function GET(request: Request) {
  if (!(await importerSession())) return new Response("Necesitas iniciar sesión.", { status: 401 });
  const params = new URL(request.url).searchParams; const url = params.get("url") ?? "";
  let host = ""; try { host = new URL(url).hostname; } catch { /* URL no válida */ }
  if (!ALLOWED.includes(host)) return new Response("Origen no permitido.", { status: 400 });
  try {
    if (params.get("label")) { const png = await energyLabelPng(url); return new Response(Buffer.from(png.bytes), { headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=3600" } }); }
    const media = await fetchMhdMedia(url);
    return new Response(Buffer.from(media.bytes), { headers: { "Content-Type": media.contentType, "Cache-Control": "private, max-age=3600" } });
  } catch (caught) {
    return new Response(caught instanceof Error ? caught.message : "No se pudo leer la imagen.", { status: 502 });
  }
}
