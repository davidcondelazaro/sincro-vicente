import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

// /api/shopify/portes: la llama Shopify en el pago (servicio de portes), sin sesión. El trabajador del importador lo
// llaman el vigilante de pg_cron y él mismo, sin sesión (solo procesa lo que ya está en la cola). La sincronización de
// precio y stock, la vuelta encadenada y el resumen diario los llaman pg_cron y la base sin sesión, pero las rutas exigen
// la clave de las lecturas de MHD
// (x-mhd-import-token).
const publicPaths = new Set(["/login", "/set-password", "/auth/logout", "/auth/confirm", "/api/shopify/portes", "/api/importador-productos/trabajos/trabajador", "/api/sincronizaciones/precio-stock", "/api/sincronizaciones/vuelta", "/api/informes/diario"]);

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const { response, signedIn } = await updateSession(request);
  if (publicPaths.has(pathname)) {
    if (signedIn && pathname === "/login") return NextResponse.redirect(new URL("/", request.url));
    return response;
  }
  if (signedIn) return response;
  const url = new URL("/login", request.url);
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
