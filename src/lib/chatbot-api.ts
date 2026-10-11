import { createClient } from "@/lib/supabase/server";

// Utilidades de las rutas /api/chatbot/*: sesión de sincro-vicente y respuestas sin caché.

// Email del usuario con sesión iniciada, o null.
export async function sessionEmail(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims.sub) return null;
  return typeof data.claims.email === "string" ? data.claims.email : data.claims.sub;
}

export function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export function errorMessage(caught: unknown, fallback: string) {
  return caught instanceof Error ? caught.message : (caught as { message?: string })?.message ?? fallback;
}
