import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

const publicPaths = new Set(["/login", "/set-password", "/auth/logout", "/auth/confirm"]);

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
