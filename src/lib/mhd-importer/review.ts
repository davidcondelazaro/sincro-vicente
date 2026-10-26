// Pieza del importador: motivos para la cola de revisión a mano (regla de David del 2026-10-24, docs/FILTROS_DESDE_MHD.md
// §7.1 y §7.5). El producto se procesa igual; los motivos van en `review_reasons` del resultado y como avisos «Revisión:».
// Funciones puras, sin IA; la mediana de precios de la subfamilia la calcula el procesador.
import type { IcecatSummary } from "./icecat";

// Clase energética de Icecat: la general o la SDR de los televisores (la HDR no se compara con la letra de MHD).
export function icecatEnergyClass(icecat: IcecatSummary | null) {
  const entries = Object.values(icecat?.specifications ?? {}).flatMap((group) => Object.entries(group)).filter(([name]) => /clase de eficiencia energ/i.test(name) && !/hdr/i.test(name));
  return (entries.find(([name]) => /^clase de eficiencia energ[eé]tica(\s*\(sdr\))?$/i.test(name.trim())) ?? entries[0])?.[1] ?? null;
}
// «Nueva A», «A+++», «A-10%», « e » → «A», «A+++», «A», «E». Sin letra reconocible: null.
export const energyLetter = (value: string | null | undefined) => (value ?? "").toUpperCase().replace(/NUEVA|CLASE/g, "").trim().match(/^([A-G]\+{0,3})(?![A-Z])/)?.[1] ?? null;

export function energyClassReason(mhdLetter: string | null | undefined, icecat: IcecatSummary | null) {
  const a = energyLetter(mhdLetter); const raw = icecatEnergyClass(icecat); const b = energyLetter(raw);
  return a && b && a !== b ? `Clase energética distinta: MHD dice «${mhdLetter}» e Icecat «${raw}».` : null;
}

// Mediana de los precios con valor (la del medio por arriba, como en family.ts).
export function median(values: (number | null | undefined)[]) {
  const sorted = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
}
export const PRICE_FACTOR = 5;         // más de 5 veces o menos de la quinta parte de la mediana de la subfamilia
export const MIN_PRICES_FOR_MEDIAN = 3; // con menos precios en la subfamilia, la mediana no dice nada
const euros = (n: number) => `${n.toFixed(2).replace(".", ",")} €`;
export function priceReason(pvp: number | null | undefined, subfamilyMedian: number | null, subfamilyPrices = MIN_PRICES_FOR_MEDIAN) {
  const price = Number(pvp ?? 0);
  if (!Number.isFinite(price) || price <= 0) return "Sin precio o con precio 0.";
  if (!subfamilyMedian || subfamilyPrices < MIN_PRICES_FOR_MEDIAN) return null;
  if (price > subfamilyMedian * PRICE_FACTOR) return `Precio raro: ${euros(price)}, más de ${PRICE_FACTOR} veces la mediana de su subfamilia (${euros(subfamilyMedian)}).`;
  if (price < subfamilyMedian / PRICE_FACTOR) return `Precio raro: ${euros(price)}, menos de la quinta parte de la mediana de su subfamilia (${euros(subfamilyMedian)}).`;
  return null;
}
