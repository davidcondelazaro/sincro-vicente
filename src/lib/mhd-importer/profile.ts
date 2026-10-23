// Perfil de una familia de MHD: las reglas que fija el analista y que aplica el procesador. Las reglas de filtros son
// deterministas (las aplica el código, sin IA): fuente → método → valor con el formato exacto de la tienda.
// Las fuentes se escriben «mhd:<nombre de la característica>» o «icecat:<sección>|<característica>».

export type ValueRule = {
  sources: string[];               // por orden de preferencia
  method: "numero_exacto" | "tramos" | "tabla" | "contiene" | "texto";
  format: string;                  // numero_exacto: plantilla con {n} («{n} kg»); el resto: explicación breve
  ranges: { from: string; to: string; value: string }[];             // tramos: [from, to) en la unidad de la fuente; "" = sin límite
  table: { source: string; value: string }[];                          // tabla / contiene: valor (o fragmento) de origen → valor de la tienda
};
// `label`: en filtro.mas_especificaciones, el «Dato» de «Dato valor»; en filtro.caracteristicas, el nombre de la
// característica (y ahí decide la primera fuente con dato; un valor vacío en la tabla o el tramo = no se pone).
// `subfamilies`: códigos de subfamilia de MHD a los que se aplica la regla (vacío = toda la familia). `min` y `max`:
// números válidos en la unidad de la fuente (vacío = sin límite); fuera de ese rango la fuente se ignora y se pasa a
// la siguiente (p. ej. «1,45W» de MHD en una freidora de 1450 W, o «500L» en una picadora).
export type FilterRule = ValueRule & { metafield: string; label: string; note: string; subfamilies?: string[]; min?: string; max?: string };
export type FamilyProfile = {
  product: { singular: string; plural: string; distinctions: { name: string; sources: string[]; how_to_name: string }[] };
  title: { template: string; key_data: { name: string; sources: string[]; format: string }[]; examples: string[]; avoid: string[] };
  meta_title: { template: string; examples: string[] };
  filters: FilterRule[];
  descriptions: { short: string; long: string; highlight: string[]; avoid: string[] };
  subfamily_exceptions: { subfamily: string; changes: string }[];
  questions: string[];             // dudas que debe decidir David
};

const str = { type: "string" };
const strings = { type: "array", items: str };
const obj = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
// El esquema es lo bastante simple para que la API lo compile (sin enum de metacampos ni tipos opcionales): el código
// comprueba después que cada metacampo existe.
export function familyProfileSchema() {
  return obj({
    product: obj({ singular: str, plural: str, distinctions: { type: "array", items: obj({ name: str, sources: strings, how_to_name: str }) } }),
    title: obj({ template: str, key_data: { type: "array", items: obj({ name: str, sources: strings, format: str }) }, examples: strings, avoid: strings }),
    meta_title: obj({ template: str, examples: strings }),
    filters: { type: "array", items: obj({
      metafield: str, label: str, sources: strings, method: { type: "string", enum: ["numero_exacto", "tramos", "tabla", "contiene", "texto"] }, format: str,
      ranges: { type: "array", items: obj({ from: str, to: str, value: str }) }, table: { type: "array", items: obj({ source: str, value: str }) }, note: str,
      subfamilies: strings, min: str, max: str,
    }) },
    descriptions: obj({ short: str, long: str, highlight: strings, avoid: strings }),
    subfamily_exceptions: { type: "array", items: obj({ subfamily: str, changes: str }) },
    questions: strings,
  });
}
