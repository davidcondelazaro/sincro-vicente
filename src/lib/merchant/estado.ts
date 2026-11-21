import type { SupabaseClient } from "@supabase/supabase-js";
import { ajustesMerchant } from "./trabajador";

// Estado del envío a Google Merchant Center: para la pantalla «Google Merchant» y el resumen diario.
export const ATASCADO_INTENTOS = 6; // ~8 horas reintentando
const PAISES = ["ES", "PT"] as const;

const contar = async (consulta: PromiseLike<{ count: number | null }>) => (await consulta).count ?? 0;

export async function estadoMerchant(db: SupabaseClient) {
  const ajustes = await ajustesMerchant(db);
  const porPais = await Promise.all(PAISES.map(async (pais) => {
    const enviado = () => db.from("merchant_enviado").select("*", { count: "exact", head: true }).eq("pais", pais);
    const [enMerchant, conPortes, sinPorte, regionalPorQuitar] = await Promise.all([
      contar(db.from("merchant_ofertas").select("*", { count: "exact", head: true }).eq("pais", pais)),
      contar(enviado().not("huella", "is", null).is("borrado_at", null)),
      contar(enviado().is("huella", null).is("borrado_at", null)),
      contar(enviado().is("borrado_at", null).not("regional_at", "is", null)), // `out_of_stock` regional aún sin quitar
    ]);
    return { pais, enMerchant, conPortes, sinPorte, regionalPorQuitar };
  }));
  const [{ count: enCola }, { data: atascados, count: nAtascados }, { data: eventos }] = await Promise.all([
    db.from("merchant_cola").select("*", { count: "exact", head: true }),
    db.from("merchant_cola").select("codigo,motivo,intentos,ultimo_error,siguiente_at", { count: "exact" }).gte("intentos", ATASCADO_INTENTOS).order("intentos", { ascending: false }).limit(50),
    db.from("mhd_sync_events").select("kind,detail,created_at").eq("sync", "merchant").order("created_at", { ascending: false }).limit(200),
  ]);
  const lista = eventos ?? [];
  return {
    ajustes: { activo: ajustes.activo, soloCodigos: ajustes.soloCodigos, fuentes: ajustes.fuentes },
    porPais,
    cola: { total: enCola ?? 0, atascados: nAtascados ?? 0, listaAtascados: atascados ?? [] },
    conciliacion: lista.find((item) => item.kind === "conciliacion") ?? null,
    avisos: lista.find((item) => item.kind === "avisos") ?? null,
    vueltas: lista.filter((item) => item.kind === "vuelta" || item.kind === "error").slice(0, 20),
  };
}

// Apartado del resumen diario. Solo sale cuando el envío está encendido.
export async function seccionResumen(db: SupabaseClient, since: string) {
  const estado = await estadoMerchant(db);
  if (!estado.ajustes.activo) return null;
  const vueltas = estado.vueltas.filter((item) => item.created_at >= since);
  const suma = (campo: string) => vueltas.reduce((total, item) => total + Number((item.detail as Record<string, number>)[campo] ?? 0), 0);
  const errores = vueltas.flatMap((item) => ((item.detail as { errores?: string[] }).errores ?? []));
  const avisos = ((estado.avisos?.detail as { avisos?: { codigo: string; total: number; importante: boolean }[] } | undefined)?.avisos ?? []).filter((item) => item.importante);
  const sinPorte = estado.porPais.reduce((total, item) => total + item.sinPorte, 0);
  const atrasadas = (estado.avisos?.detail as { atrasadas?: { total: number; ejemplos: string[] } } | undefined)?.atrasadas;
  const conciliada = estado.conciliacion && estado.conciliacion.created_at >= since;
  const mal = avisos.length > 0 || (atrasadas?.total ?? 0) > 0 || estado.cola.atascados > 0 || !conciliada;
  return {
    id: "google-merchant", title: "Google Merchant", warn: mal || sinPorte > 0 || errores.length > 0,
    kpis: [{ id: "merchant-avisos", label: "Google Merchant: avisos de portes y disponibilidad", value: avisos.reduce((total, item) => total + item.total, 0), sub: `${estado.cola.atascados} atascados en la cola · ${sinPorte} sin porte`, tone: mal ? "bad" : sinPorte || errores.length ? "warn" : "ok" }],
    lines: [
      ...estado.porPais.map((item) => `${item.pais}: ${item.enMerchant} ofertas en Merchant Center, ${item.conPortes} con portes${item.sinPorte ? `, ${item.sinPorte} sin porte conocido` : ""}${item.regionalPorQuitar ? `, ${item.regionalPorQuitar} con el agotado regional aún por quitar` : ""}.`),
      `En el periodo: ${suma("enviados")} portes mandados, ${suma("regionales")} agotados regionales quitados, ${suma("borrados")} quitados, ${suma("reenvios")} reenviados porque Google no los reflejaba.`,
      conciliada ? `Conciliación: ${new Date(estado.conciliacion!.created_at).toLocaleTimeString("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit" })}.` : "La conciliación de anoche no se hizo.",
      ...(estado.ajustes.soloCodigos.length ? [`En prueba: solo ${estado.ajustes.soloCodigos.length} productos.`] : []),
      ...(atrasadas?.total ? [`Mandados hace más de una hora y aún con aviso en Google: ${atrasadas.total} (${atrasadas.ejemplos.join(", ")}).`] : []),
      ...avisos.map((item) => `Aviso de Google: ${item.codigo} en ${item.total} ofertas.`),
      ...estado.cola.listaAtascados.slice(0, 10).map((item) => `Reintentando ${item.codigo} (${item.intentos} intentos): ${item.ultimo_error ?? item.motivo}`),
      ...errores.slice(0, 5).map((item) => `Error: ${item}`),
    ],
    link: { text: "Abrir Google Merchant", href: "https://utils.electronicavicente.com/google-merchant" },
  };
}
