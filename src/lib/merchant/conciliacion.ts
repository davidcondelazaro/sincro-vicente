import type { SupabaseClient } from "@supabase/supabase-js";
import { sendAlert } from "@/lib/mhd-importer/alerts";
import { merchant, mensaje, type MerchantConfig } from "./api";
import { huella, PAISES, realDeMerchant, type Pais } from "./esperado";
import { ajustesMerchant } from "./trabajador";

// Conciliación diaria con Merchant Center (pg_cron, de madrugada). Lee la lista completa de ofertas de la cuenta, que es
// la verdad sobre lo publicado (la app de Shopify solo sube lo que está en el canal), con los portes, plazos y EPREL
// que Google aplica de verdad. Guarda la foto en merchant_ofertas, olvida lo que ya no está (y lo marca para volver a
// mandarlo si reaparece) y pone en la cola todos los productos: el trabajador manda lo que falte o no coincida y borra
// lo que haya pasado a borrador. Con esto no queda hueco aunque falle un aviso o una cola.

type Producto = { offerId: string; feedLabel: string; customAttributes?: { name: string; value?: string }[] } & Parameters<typeof realDeMerchant>[0];
const PAIS_DE = new Map(Object.entries(PAISES).map(([pais, datos]) => [datos.feedLabel, pais as Pais]));

export async function conciliar(deps: { db: SupabaseClient; merchant: MerchantConfig }) {
  const { db } = deps;
  const ajustes = await ajustesMerchant(db);
  if (!ajustes.activo) return { apagado: true };
  const inicio = new Date().toISOString();
  const { count: antes } = await db.from("merchant_ofertas").select("*", { count: "exact", head: true });
  const cuenta: Record<Pais, number> = { ES: 0, PT: 0 };
  let pageToken: string | undefined;
  do {
    const respuesta = await merchant<{ products?: Producto[]; nextPageToken?: string }>(deps.merchant, "GET", `products/v1/accounts/{cuenta}/products?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`);
    if (!respuesta.ok) {
      // Lista a medias: no se olvida nada, que sería borrar de más.
      await sendAlert(db, { key: "merchant:conciliacion", href: "/google-merchant", subject: "Google Merchant: la conciliación no pudo leer la lista", lines: [mensaje(respuesta)] });
      throw new Error(mensaje(respuesta));
    }
    const filas = (respuesta.body.products ?? []).flatMap((producto) => {
      const pais = PAIS_DE.get(producto.feedLabel);
      if (!pais) return [];
      cuenta[pais] += 1;
      const real = realDeMerchant(producto, pais);
      const codigo = producto.customAttributes?.find((item) => item.name === "sku")?.value ?? null;
      return [{ offer_id: producto.offerId, pais, codigo, real, huella_real: huella(real), visto_at: inicio }];
    });
    for (let i = 0; i < filas.length; i += 500) {
      const { error } = await db.from("merchant_ofertas").upsert(filas.slice(i, i + 500));
      if (error) throw new Error(error.message);
    }
    pageToken = respuesta.body.nextPageToken;
  } while (pageToken);

  // Freno: si la lista viene con menos de la mitad que la anterior, no se olvida nada.
  const vistas = cuenta.ES + cuenta.PT;
  let olvidadas = 0;
  if (antes && vistas < antes / 2) {
    await sendAlert(db, { key: "merchant:conciliacion-freno", href: "/google-merchant", subject: "Google Merchant: la lista de ofertas ha bajado a menos de la mitad", lines: [`Vistas ${vistas} de ${antes}. No se ha olvidado ninguna; revisa la app de Shopify.`] });
  } else {
    const { data: idas } = await db.from("merchant_ofertas").delete().lt("visto_at", inicio).select("offer_id,pais");
    olvidadas = idas?.length ?? 0;
    // Si vuelven, que se manden de nuevo los portes y el regional.
    for (const ida of idas ?? []) await db.from("merchant_enviado").update({ huella: null, regional_at: null }).eq("offer_id", ida.offer_id).eq("pais", ida.pais);
  }
  const { data: encolados } = await db.rpc("merchant_encolar_todo");
  const resumen = { ofertas: cuenta, olvidadas, encolados };
  await db.from("mhd_sync_events").insert({ sync: "merchant", kind: "conciliacion", detail: resumen });
  return resumen;
}

// Avisos de Google por la API de informes: cuántas ofertas tienen cada aviso, por país. Se guarda una foto al día para el
// resumen y la pantalla. Los de portes y regiones son los que importan aquí.
type Vista = { productView: { id: string; feedLabel?: string; itemIssues?: { type?: { code?: string }; severity?: { aggregatedSeverity?: string } }[] } };
export const AVISOS_IMPORTANTES = /shipping|region|certification|delivery/i;

export async function leerAvisos(deps: { db: SupabaseClient; merchant: MerchantConfig }) {
  const conteo: Record<string, Record<string, number>> = {};
  const ejemplos: Record<string, string[]> = {};
  let ofertas = 0;
  let pageToken: string | undefined;
  do {
    const respuesta = await merchant<{ results?: Vista[]; nextPageToken?: string }>(deps.merchant, "POST", "reports/v1/accounts/{cuenta}/reports:search", { query: "SELECT id, feed_label, item_issues FROM product_view", pageSize: 1000, ...(pageToken ? { pageToken } : {}) });
    if (!respuesta.ok) throw new Error(mensaje(respuesta));
    for (const { productView: vista } of respuesta.body.results ?? []) {
      const pais = PAIS_DE.get(vista.feedLabel ?? "") ?? "otro";
      ofertas += 1;
      for (const aviso of vista.itemIssues ?? []) {
        const codigo = `${aviso.type?.code ?? "?"} (${aviso.severity?.aggregatedSeverity ?? "?"})`;
        conteo[codigo] ??= {}; conteo[codigo][pais] = (conteo[codigo][pais] ?? 0) + 1;
        ejemplos[codigo] ??= []; if (ejemplos[codigo].length < 5) ejemplos[codigo].push(vista.id);
      }
    }
    pageToken = respuesta.body.nextPageToken;
  } while (pageToken);
  const avisos = Object.entries(conteo).map(([codigo, porPais]) => ({ codigo, porPais, total: Object.values(porPais).reduce((a, b) => a + b, 0), ejemplos: ejemplos[codigo], importante: AVISOS_IMPORTANTES.test(codigo) })).sort((a, b) => b.total - a.total);
  const detalle = { ofertas, avisos };
  await deps.db.from("mhd_sync_events").insert({ sync: "merchant", kind: "avisos", detail: detalle });
  return detalle;
}
