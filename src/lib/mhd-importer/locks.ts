import type { SupabaseClient } from "@supabase/supabase-js";
import { GARANTIA3_PRODUCTS } from "./warranty-types";

// Productos bloqueados (store_product_locks, 2026-10-29): fichas arregladas a mano que el importador no vuelve a procesar
// ni a subir. Devuelve el motivo si el producto está bloqueado.
// Las 22 garantías de Garantía3 están siempre bloqueadas (2026-11-17): se llevan a mano y, si el importador las tocara,
// les quitaría el reglamento y la descripción y les pondría el precio de la ficha en vez del de la tarifa.
export async function productLock(db: SupabaseClient, codigo: string) {
  if (GARANTIA3_PRODUCTS.has(String(codigo))) return "Garantía de Garantía3: se lleva a mano, el importador no la toca (docs/GARANTIAS_DESDE_MHD.md).";
  const { data, error } = await db.from("store_product_locks").select("reason").eq("codigo", codigo).maybeSingle();
  if (error) throw error;
  return data ? `Producto bloqueado a mano: ${data.reason}` : null;
}
