import { createClient } from "@/lib/supabase/server";

// Productos bloqueados (store_product_locks, 2026-10-29) con la sesión del usuario. GET: la lista con su título en la
// tienda. POST { codigo, reason }: bloquea (acepta código de MHD o EAN). DELETE { codigo }: desbloquea.
export const dynamic = "force-dynamic";

async function session() {
  const db = await createClient();
  const { data } = await db.auth.getUser();
  return data.user ? { db, email: data.user.email ?? null } : null;
}

export async function GET() {
  const auth = await session();
  if (!auth) return Response.json({ error: "Sin sesión" }, { status: 401 });
  const { data: locks, error } = await auth.db.from("store_product_locks").select("codigo,reason,locked_by,locked_at").order("locked_at", { ascending: false });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const codes = (locks ?? []).map((lock) => lock.codigo);
  const { data: variants } = codes.length ? await auth.db.from("shopify_variants").select("sku,product_id").in("sku", codes) : { data: [] };
  const ids = (variants ?? []).map((variant) => variant.product_id);
  const { data: products } = ids.length ? await auth.db.from("shopify_products").select("product_id,title,status").in("product_id", ids) : { data: [] };
  const bySku = new Map((variants ?? []).map((variant) => [variant.sku, (products ?? []).find((product) => product.product_id === variant.product_id)]));
  return Response.json({ locks: (locks ?? []).map((lock) => ({ ...lock, product: bySku.get(lock.codigo) ?? null })) });
}

export async function POST(request: Request) {
  const auth = await session();
  if (!auth) return Response.json({ error: "Sin sesión" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { codigo?: string; reason?: string };
  const input = body.codigo?.trim(); const reason = body.reason?.trim();
  if (!input || !reason) return Response.json({ error: "Indica el código (o EAN) y el motivo." }, { status: 400 });
  const { data: product } = await auth.db.from("mhd_catalog_products").select("codigo").or(`codigo.eq.${input.replace(/[^0-9A-Za-z-]/g, "")},codigo_ean.eq.${input.replace(/[^0-9A-Za-z-]/g, "")}`).limit(1).maybeSingle();
  const codigo = product?.codigo ?? input;
  const { error } = await auth.db.from("store_product_locks").insert({ codigo, reason, locked_by: auth.email });
  if (error) return Response.json({ error: error.code === "23505" ? "Ese producto ya está bloqueado." : error.message }, { status: 400 });
  return Response.json({ ok: true, codigo });
}

export async function DELETE(request: Request) {
  const auth = await session();
  if (!auth) return Response.json({ error: "Sin sesión" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { codigo?: string };
  if (!body.codigo) return Response.json({ error: "Falta el código." }, { status: 400 });
  const { error } = await auth.db.from("store_product_locks").delete().eq("codigo", body.codigo);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
