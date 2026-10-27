// Pieza del importador: motivos para la cola de revisión a mano (regla de David del 2026-10-24, docs/FILTROS_DESDE_MHD.md
// §7.1 y §7.5). El producto se procesa igual; los motivos van en `review_reasons` del resultado y como avisos «Revisión:».
// Funciones puras, sin IA.
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
// Precios (David, 2026-10-27): nos fiamos del precio de MHD. Ya no se manda a revisión el «precio raro» frente a la
// mediana de la subfamilia (en accesorios conviven cables de 4 € y conmutadores de 400 € y saltaba sin motivo); un
// producto con precio 0 o sin precio se descarta (rules.ts, discardReason).
