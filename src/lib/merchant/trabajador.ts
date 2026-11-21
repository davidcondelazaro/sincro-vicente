import type { SupabaseClient } from "@supabase/supabase-js";
import { sendAlert } from "@/lib/mhd-importer/alerts";
import { shopifyGraphql, type ShopifyConfig } from "@/lib/mhd-importer/store-filters";
import { merchant, mensaje, type MerchantConfig } from "./api";
import { entradaProducto, esperado, huella, nombreProducto, offerId, PAISES, realDeMerchant, type Esperado, type Opciones, type Pais, type ProductoTienda } from "./esperado";

// Trabajador de la cola de Merchant Center (merchant_cola). Lo llama pg_cron cada 10 minutos. Por cada producto:
// 1. Lee de Shopify lo que de verdad hay (estado, portes del metacampo, textos de disponibilidad, stock y EPREL).
// 2. Por cada país, comprueba que la oferta ya está en Merchant Center. Si aún no está, el producto vuelve a la cola
//    con esperas crecientes (15 min, 30 min… hasta un día): nunca se manda nada a una oferta que no existe.
// 3. Manda a la fuente complementaria del país solo si cambia algo, o si Merchant Center no refleja lo mandado.
// 4. Quita el inventario regional `out_of_stock` (Canarias, Ceuta, Melilla / Azores, Madeira) que se mandaba hasta el 21-11:
//    Google rechazaba la oferta en todo el país porque la web dice «en stock» (out_of_stock_regional_availability_mismatch).
//    Las islas se excluyen en Google Ads por ubicación, como Baleares.
// 5. Si el producto ya no está activo, quita lo mandado de la complementaria.
// Freno: con muchos errores seguidos de la API se para, suelta lo cogido y avisa.

export const TRABAJADOR = { lote: 100, concurrencia: 32, presupuestoMs: 240_000, frenoErrores: 25, margenProcesoHoras: 3 };
const PAIS_LISTA = Object.keys(PAISES) as Pais[];

export type AjustesMerchant = { activo: boolean; soloCodigos: string[]; fuentes: Partial<Record<Pais, string>> };

export async function ajustesMerchant(db: SupabaseClient): Promise<AjustesMerchant> {
  const { data } = await db.from("store_settings").select("key,value").in("key", ["merchant_activo", "merchant_solo_codigos", "merchant_fuentes"]);
  const valor = (key: string) => data?.find((row) => row.key === key)?.value;
  return { activo: valor("merchant_activo") === true, soloCodigos: (valor("merchant_solo_codigos") as string[] | undefined) ?? [], fuentes: (valor("merchant_fuentes") as AjustesMerchant["fuentes"] | undefined) ?? {} };
}

type Cola = { codigo: string; motivo: string; intentos: number };
type Enviado = { offer_id: string; pais: Pais; codigo: string; huella: string | null; enviado_at: string | null; regional_at: string | null; borrado_at: string | null; reenvios: number };
type Oferta = { offer_id: string; pais: Pais; huella_real: string | null; visto_at: string };
type Nodo = { id: string; status: string; oe: { value: string } | null; dc: { value: string } | null; ds: { value: string } | null; ep: { value: string } | null; variants: { nodes: { id: string; sku: string | null; inventoryQuantity: number | null }[] } };

const json = (valor: string | undefined | null): Opciones => { if (!valor) return null; try { return JSON.parse(valor); } catch { return null; } };
const espera = (intentos: number) => new Date(Date.now() + Math.min(15 * 2 ** intentos, 24 * 60) * 60_000).toISOString();

async function enParalelo<T>(lista: T[], n: number, tarea: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, lista.length) }, async () => { while (i < lista.length) await tarea(lista[i++]); }));
}

async function leerTienda(db: SupabaseClient, shopify: ShopifyConfig, codigos: string[]) {
  const { data: ids } = await db.from("store_shopify_ids").select("codigo,product_id,variant_id").in("codigo", codigos);
  const porProducto = new Map((ids ?? []).map((row) => [row.product_id as string, row as { codigo: string; product_id: string; variant_id: string }]));
  const productos = new Map<string, ProductoTienda | null>(codigos.map((codigo) => [codigo, null]));
  if (!porProducto.size) return productos;
  const { nodes } = await shopifyGraphql<{ nodes: (Nodo | null)[] }>(shopify, `query($ids: [ID!]!) { nodes(ids: $ids) { ... on Product { id status
    oe: metafield(namespace: "custom", key: "opciones_entrega") { value } dc: metafield(namespace: "custom", key: "disponibilidad_con_stock") { value }
    ds: metafield(namespace: "custom", key: "disponibilidad_sin_stock") { value } ep: metafield(namespace: "custom", key: "eprel") { value }
    variants(first: 5) { nodes { id sku inventoryQuantity } } } } }`, { ids: [...porProducto.keys()] });
  const sinMetacampo: string[] = [];
  for (const nodo of nodes) {
    if (!nodo?.id) continue;
    const fila = porProducto.get(nodo.id)!;
    const variante = nodo.variants.nodes.find((item) => item.sku === fila.codigo) ?? nodo.variants.nodes[0];
    if (!variante) continue;
    const opciones = json(nodo.oe?.value);
    if (!opciones) sinMetacampo.push(fila.codigo);
    productos.set(fila.codigo, { productId: nodo.id, variantId: variante.id, codigo: fila.codigo, activo: nodo.status === "ACTIVE", opciones, opcionesMhd: null, conStock: nodo.dc?.value ?? null, sinStock: nodo.ds?.value ?? null, stock: variante.inventoryQuantity, eprel: nodo.ep?.value ?? null });
  }
  // Sin metacampo: el último porte conocido de MHD (David, 2026-11-17).
  if (sinMetacampo.length) {
    const claves = PAIS_LISTA.map((pais) => PAISES[pais].clavePorte);
    const { data } = await db.from("mhd_catalog_products").select(`codigo,${claves.map((clave) => `${clave}:source_payload->>${clave}`).join(",")}`).in("codigo", sinMetacampo);
    for (const fila of (data ?? []) as unknown as Record<string, string | null>[]) {
      const producto = productos.get(fila.codigo!);
      if (producto) producto.opcionesMhd = Object.fromEntries(claves.map((clave) => [clave, fila[clave]]));
    }
  }
  return productos;
}

export async function trabajarCola(deps: { db: SupabaseClient; shopify: ShopifyConfig; merchant: MerchantConfig }, opciones: { presupuestoMs?: number; maximo?: number } = {}) {
  const { db, shopify } = deps;
  const ajustes = await ajustesMerchant(db);
  if (!ajustes.activo) return { apagado: true };
  if (!ajustes.fuentes.ES || !ajustes.fuentes.PT) return { apagado: true, motivo: "Faltan las fuentes complementarias en merchant_fuentes" };
  const fin = Date.now() + (opciones.presupuestoMs ?? TRABAJADOR.presupuestoMs);
  const resumen = { productos: 0, enviados: 0, regionales: 0, borrados: 0, iguales: 0, reenvios: 0, sinPorte: 0, noEstan: 0, errores: [] as string[], frenado: false };
  let erroresSeguidos = 0;
  const fallo = (texto: string) => { resumen.errores.push(texto); erroresSeguidos += 1; };
  const bien = () => { erroresSeguidos = 0; };

  while (Date.now() < fin && !resumen.frenado && (!opciones.maximo || resumen.productos < opciones.maximo)) {
    const { data: cogidos, error } = await db.rpc("merchant_cola_coger", { p_limite: TRABAJADOR.lote });
    if (error) throw new Error(error.message);
    const cola = (cogidos ?? []) as Cola[];
    if (!cola.length) break;
    // En pruebas, solo los códigos elegidos; el resto sale de la cola (la conciliación los vuelve a meter).
    const fuera = ajustes.soloCodigos.length ? cola.filter((item) => !ajustes.soloCodigos.includes(item.codigo)) : [];
    if (fuera.length) await db.from("merchant_cola").delete().in("codigo", fuera.map((item) => item.codigo));
    const lote = cola.filter((item) => !fuera.includes(item));
    if (!lote.length) continue;
    const codigos = lote.map((item) => item.codigo);
    resumen.productos += lote.length;

    const [tienda, { data: enviados }, { data: ofertas }] = await Promise.all([
      leerTienda(db, shopify, codigos),
      db.from("merchant_enviado").select("offer_id,pais,codigo,huella,enviado_at,regional_at,borrado_at,reenvios").in("codigo", codigos),
      db.from("merchant_ofertas").select("offer_id,pais,huella_real,visto_at").in("codigo", codigos),
    ]);
    const clave = (oferta: string, pais: string) => `${pais}|${oferta}`;
    const enviado = new Map(((enviados ?? []) as Enviado[]).map((row) => [clave(row.offer_id, row.pais), row]));
    const enMerchant = new Map(((ofertas ?? []) as Oferta[]).map((row) => [clave(row.offer_id, row.pais), row]));
    const pendientes = new Map<string, string>(); // código → motivo para reintentar

    const trabajos = lote.flatMap((item) => PAIS_LISTA.map((pais) => ({ item, pais })));
    await enParalelo(trabajos, TRABAJADOR.concurrencia, async ({ item, pais }) => {
      if (resumen.frenado) { pendientes.set(item.codigo, "Freno por errores seguidos"); return; }
      if (erroresSeguidos >= TRABAJADOR.frenoErrores) { resumen.frenado = true; pendientes.set(item.codigo, "Freno por errores seguidos"); return; }
      const producto = tienda.get(item.codigo);
      const fuente = ajustes.fuentes[pais]!;
      // Lo ya mandado de este código, aunque el producto haya desaparecido de Shopify.
      const previos = [...enviado.values()].filter((row) => row.codigo === item.codigo && row.pais === pais && !row.borrado_at);

      if (!producto || !producto.activo) {
        for (const previo of previos) {
          const respuesta = await merchant(deps.merchant, "DELETE", `products/v1/accounts/{cuenta}/productInputs/${nombreProducto(pais, previo.offer_id)}?dataSource=${fuente}`);
          if (respuesta.ok || respuesta.status === 404) {
            bien(); resumen.borrados += 1;
            await db.from("merchant_enviado").update({ borrado_at: new Date().toISOString() }).eq("offer_id", previo.offer_id).eq("pais", pais);
          } else { fallo(`${item.codigo} ${pais} borrar: ${mensaje(respuesta)}`); pendientes.set(item.codigo, mensaje(respuesta)); }
        }
        return;
      }

      const oferta = offerId(producto.productId, producto.variantId);
      const nombre = nombreProducto(pais, oferta);
      let real = enMerchant.get(clave(oferta, pais));
      if (!real) {
        const respuesta = await merchant<Parameters<typeof realDeMerchant>[0]>(deps.merchant, "GET", `products/v1/accounts/{cuenta}/products/${nombre}`);
        if (respuesta.status === 404) { bien(); resumen.noEstan += 1; pendientes.set(item.codigo, `La oferta aún no está en Merchant Center (${pais})`); return; }
        if (!respuesta.ok) { fallo(`${item.codigo} ${pais} leer: ${mensaje(respuesta)}`); pendientes.set(item.codigo, mensaje(respuesta)); return; }
        bien();
        const datosReales = realDeMerchant(respuesta.body, pais);
        real = { offer_id: oferta, pais, huella_real: huella(datosReales), visto_at: new Date().toISOString() };
        await db.from("merchant_ofertas").upsert({ ...real, codigo: item.codigo, real: datosReales });
      }

      const datos: Esperado = esperado(producto, pais);
      const nueva = huella(datos);
      const previo = enviado.get(clave(oferta, pais));
      const ahora = new Date().toISOString();
      if (!nueva) {
        resumen.sinPorte += 1;
        await db.from("merchant_enviado").upsert({ offer_id: oferta, pais, codigo: item.codigo, datos, huella: null });
      } else {
        // Reenvío: lo mandado no se ve en Merchant Center pasado el margen de proceso.
        const noReflejado = previo?.huella === nueva && !previo.borrado_at && real.huella_real !== nueva && previo.enviado_at !== null
          && new Date(real.visto_at).getTime() - new Date(previo.enviado_at).getTime() > TRABAJADOR.margenProcesoHoras * 3_600_000;
        if (previo?.huella !== nueva || previo?.borrado_at || noReflejado) {
          const respuesta = await merchant(deps.merchant, "POST", `products/v1/accounts/{cuenta}/productInputs:insert?dataSource=${fuente}`, entradaProducto(oferta, pais, datos));
          if (!respuesta.ok) { fallo(`${item.codigo} ${pais} portes: ${mensaje(respuesta)}`); pendientes.set(item.codigo, mensaje(respuesta)); return; }
          bien(); resumen.enviados += 1; if (noReflejado) resumen.reenvios += 1;
          await db.from("merchant_enviado").upsert({ offer_id: oferta, pais, codigo: item.codigo, datos, huella: nueva, enviado_at: ahora, borrado_at: null, reenvios: (previo?.reenvios ?? 0) + (noReflejado ? 1 : 0) });
        } else resumen.iguales += 1;
      }

      // Zonas sin envío: se quita el `out_of_stock` regional que quede (David, 2026-11-21). Un 404 es que ya no estaba.
      if (previo?.regional_at) {
        const respuesta = await merchant(deps.merchant, "DELETE", `inventories/v1/accounts/{cuenta}/products/${nombre}/regionalInventories/${PAISES[pais].region}`);
        if (!respuesta.ok && respuesta.status !== 404) { fallo(`${item.codigo} ${pais} quitar regional: ${mensaje(respuesta)}`); pendientes.set(item.codigo, mensaje(respuesta)); return; }
        bien(); resumen.regionales += 1;
        await db.from("merchant_enviado").update({ regional_at: null }).eq("offer_id", oferta).eq("pais", pais);
      }
    });

    // Cola: lo hecho sale; lo pendiente vuelve con espera creciente.
    const hechos = lote.filter((item) => !pendientes.has(item.codigo)).map((item) => item.codigo);
    if (hechos.length) await db.from("merchant_cola").delete().in("codigo", hechos);
    for (const item of lote.filter((row) => pendientes.has(row.codigo))) {
      const freno = resumen.frenado;
      await db.from("merchant_cola").update({ en_curso_at: null, intentos: freno ? item.intentos : item.intentos + 1, siguiente_at: freno ? new Date(Date.now() + 30 * 60_000).toISOString() : espera(item.intentos), ultimo_error: pendientes.get(item.codigo)!.slice(0, 500) }).eq("codigo", item.codigo);
    }
  }

  if (resumen.frenado) {
    await db.from("merchant_cola").update({ en_curso_at: null }).not("en_curso_at", "is", null);
    await sendAlert(db, { key: "merchant:freno", quietMinutes: 6 * 60, href: "/google-merchant", subject: "Google Merchant: parado por errores seguidos", lines: [`${TRABAJADOR.frenoErrores} errores seguidos de la Merchant API. Se reintenta en 30 minutos.`, ...resumen.errores.slice(-5)] });
  }
  const detalle = { ...resumen, errores: resumen.errores.slice(0, 30) };
  if (resumen.productos) await db.from("mhd_sync_events").insert({ sync: "merchant", kind: resumen.errores.length ? "error" : "vuelta", detail: detalle });
  return detalle;
}
