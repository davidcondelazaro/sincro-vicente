// Reglas de la automatización de pedidos sin red ni base de datos, para poder probarlas
// (docs/PEDIDOS_MHD_FASE_1.md › Automatización de pedidos).

export type Seguimiento = { carrier_name?: string | null; tracking_number?: string | null; carrier_url?: string | null };
export type DecisionEnvio =
  | { accion: "marcar"; company: string | null; number: string; url: string | null }
  | { accion: "revisar"; motivo: string }
  | { accion: "esperar" };

// Enviado (10), En tránsito (11) o Finalizado (12)
const ESTADOS_ENVIADOS = new Set([10, 11, 12]);
export function enviadoEnMhd(idEstado: number | null | undefined, estado: string | null | undefined) {
  return (idEstado != null && ESTADOS_ENVIADOS.has(idEstado)) || /^(enviado|en tr[aá]nsito|finalizado)$/i.test(estado?.trim() ?? "");
}

// Regla provisional (31-10-2026): un seguimiento, envío completo; dos o más, nada y aviso, hasta ver un caso real.
export function decidirEnvio(idEstado: number | null | undefined, estado: string | null | undefined, seguimiento: Seguimiento[]): DecisionEnvio {
  if (!enviadoEnMhd(idEstado, estado)) return { accion: "esperar" };
  const numeros = seguimiento.filter((item) => item.tracking_number?.trim());
  if (!numeros.length) return { accion: "revisar", motivo: `MHD lo da por «${estado ?? "enviado"}» sin número de seguimiento.` };
  if (numeros.length > 1) return { accion: "revisar", motivo: `MHD da ${numeros.length} seguimientos (${numeros.map((item) => item.tracking_number!.trim()).join(", ")}): puede ser un envío en partes.` };
  const [unico] = numeros;
  const url = unico.carrier_url?.trim() && /^https?:\/\//i.test(unico.carrier_url.trim()) ? unico.carrier_url.trim() : null;
  return { accion: "marcar", company: unico.carrier_name?.trim() || null, number: unico.tracking_number!.trim(), url };
}

// Exportación automática: solo pedidos listos, creados después del corte y con el margen cumplido desde el pago
// (en ese margen es cuando más se cancela o corrige, y en MHD ya no se puede).
export function listoParaExportarAuto(input: { elegible: boolean; creado: string | null; desde: string | null; margenMinutos: number; ahora: Date; estadoExportacion: string | null }) {
  if (!input.elegible || !input.creado || !input.desde) return false;
  if (input.estadoExportacion && !["ready", "failed"].includes(input.estadoExportacion)) return false;
  const creado = new Date(input.creado).getTime();
  return creado >= new Date(input.desde).getTime() && input.ahora.getTime() - creado >= input.margenMinutos * 60_000;
}

const madrid = (date: Date) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", weekday: "short", hour: "2-digit", hourCycle: "h23" }).formatToParts(date).map((part) => [part.type, part.value]));
  return { dia: parts.weekday as string, hora: Number(parts.hour) };
};
export const horaEnMadrid = (date: Date) => madrid(date).hora;
// Aviso de pedidos sin exportar: de lunes a viernes, de 9:00 a 20:00 (hora de Madrid)
export function enHorarioLaboral(date: Date) {
  const { dia, hora } = madrid(date);
  return !["Sat", "Sun"].includes(dia) && hora >= 9 && hora < 20;
}
