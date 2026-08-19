import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
function required(name: string) { const value = process.env[name]; if (!value) throw new Error(`Falta la variable ${name}.`); return value; }
export async function GET(request: Request) {
  const supabase = await createClient(); const { data } = await supabase.auth.getClaims();
  if (!data?.claims.sub) return Response.json({ error: "Necesitas iniciar sesión." }, { status: 401 });
  const url = new URL(request.url); const codigo = url.searchParams.get("codigo"); const response = await fetch(`${required("NEXT_PUBLIC_SUPABASE_URL")}/functions/v1/import-source-catalog`, { method: "POST", headers: { "Content-Type": "application/json", "x-catalog-ingest-token": required("CATALOG_INGEST_TOKEN") }, body: JSON.stringify(codigo ? { action: "mhd-product-detail", codigo } : { action: "mhd-view", entity: url.searchParams.get("entity") ?? "products", page: Number(url.searchParams.get("page") ?? 0), search: url.searchParams.get("search") ?? "" }), cache: "no-store" });
  return new Response(await response.text(), { status: response.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
