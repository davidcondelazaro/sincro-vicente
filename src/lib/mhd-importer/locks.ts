import type { SupabaseClient } from "@supabase/supabase-js";

// Productos bloqueados (store_product_locks, 2026-10-29): fichas arregladas a mano que el importador no vuelve a procesar
// ni a subir. Devuelve el motivo si el producto está bloqueado.
export async function productLock(db: SupabaseClient, codigo: string) {
  const { data, error } = await db.from("store_product_locks").select("reason").eq("codigo", codigo).maybeSingle();
  if (error) throw error;
  return data ? `Producto bloqueado a mano: ${data.reason}` : null;
}
