// Pieza del importador: el analista. Con el resumen y la muestra de una familia de MHD y el vocabulario de filtros de
// la tienda, un modelo grande propone el perfil de la familia (ver profile.ts). Lo revisa David antes de usarlo.
import Anthropic from "@anthropic-ai/sdk";
import { ANALYST_MODEL, costUsd } from "./ai";
import type { FamilySummary, SampleProduct } from "./family";
import { familyProfileSchema, type FamilyProfile } from "./profile";
import type { FilterVocabulary } from "./store-filters";

const SYSTEM = `Eres el analista del catálogo de Electrónica Vicente, una tienda online española de electrodomésticos y electrónica (Shopify). La tienda va a importar casi todo su catálogo del mayorista MHD. Tu trabajo es fijar, para UNA familia de productos de MHD, las reglas que después aplicará un proceso automático a cada producto de esa familia. No redactas productos: escribes reglas.

Fuentes permitidas: solo los datos de MHD (listado y ficha con características) y de Icecat. Nunca uses tu propio conocimiento para afirmar datos de un producto; las reglas solo pueden apoyarse en campos que aparecen en esas fuentes.

Reglas de la tienda que el perfil debe respetar:
- Título del producto: tipo + marca + modelo + 2-3 datos clave de la familia, unos 70 caracteres como máximo. Marca escrita como la escribe la marca (Bosch, LG, AEG, Hisense…), el resto en minúscula normal, modelo tal cual. Sin « | », sin repeticiones, sin compatibilidades ni códigos internos. El color solo si es lo que distingue al producto. Ejemplo de estilo: «Lavadora Bosch WAN24272ES 8 kg 1200 rpm clase A».
- Meta título (SEO, distinto del título): unos 60 caracteres, con lo que la gente busca delante.
- Los filtros son metacampos de Shopify. Las colecciones y landings comparan el texto literal, así que los valores deben coincidir letra por letra con los que ya usa la tienda (te doy el vocabulario actual con recuentos). Prefiere siempre un valor existente; si hace falta uno nuevo, imita el formato de los existentes: unidad separada por espacio («8 kg», «1400 rpm»), primera letra en mayúscula y el resto en minúscula. Algunos filtros usan tramos heredados («Más de 10 kg», «De 185 cm a 199 cm»): si la tienda usa tramos para esta familia, define los tramos.
- No existe ningún filtro nuevo: solo puedes usar los metacampos de la lista. No incluyas reglas para metacampos que no apliquen a la familia.
- filtro.caracteristicas: funciones que el producto TIENE, sin cifras, solo en positivo («Autodosificador», «Fondo reducido», «Grill»). Si la respuesta es sí/no y es «sí», va aquí; si es «no», no se pone nada.
- filtro.mas_especificaciones: datos con cifra que no tienen filtro propio, siempre «Dato valor» («Nivel sonoro de 44 dB a 50 dB»). Va en «filters» con metafield «filtro.mas_especificaciones», el «Dato» en «label» y el «valor» en la regla (p. ej. label «Nivel sonoro», tramo «de 44 dB a 50 dB»). Usa tramos para que los valores se repitan entre productos; no crees un valor por producto. En el resto de filtros, «label» va vacío.
- features.eficiencia_energ_tica: la etiqueta actual (escala A-G) se escribe «Nueva A», «Nueva B»…
- MHD no siempre trae los mismos nombres de característica ni el mismo formato («6Kg», «80db»): las reglas deben cubrir las variantes que veas en la muestra, y usar Icecat como segunda fuente.

Métodos de las reglas de valor (las aplica código, sin IA):
- numero_exacto: se extrae el número de la fuente y se escribe con «format», que lleva {n} (p. ej. «{n} kg»). Decimales con coma.
- subfamilies: si una regla solo vale para unas subfamilias, pon sus códigos de MHD (p. ej. ["C1010"]); vacío = toda la familia. min y max: números válidos en la unidad de la fuente (vacío = sin límite); fuera de ese rango la fuente se ignora y se pasa a la siguiente (sirve para descartar errores de MHD como «500L» en una picadora).
- tramos: se extrae el número (en la unidad de la fuente: si la fuente está en mm y el tramo en cm, escribe los límites en mm) y se busca el tramo con from <= n < to. Los límites van como texto con punto decimal («10», «84.5»); vacío = sin límite.
- tabla: el valor de la fuente se busca en «table» (sin distinguir mayúsculas ni tildes); si no está, se prueba la siguiente fuente.
- contiene: como tabla, pero basta con que el valor de la fuente contenga el texto de la fila («inverter» → «Inverter»).
- texto: el valor de la fuente se copia tal cual (úsalo poco).
Las fuentes se escriben «mhd:<nombre exacto de la característica>» o «icecat:<sección>|<característica>», exactamente como aparecen en la muestra.
Las características (filtro.caracteristicas) van también en «filters», una regla por característica, con metafield «filtro.caracteristicas» y su nombre en «label». Usan tabla, contiene o tramos, con una diferencia: decide la PRIMERA fuente de la lista que tenga dato (las demás no se miran), y un valor vacío en la fila o el tramo significa «no se pone». Ejemplos: «Programable» con tabla {«Si» → «Programable»}; «Inverter» con contiene {«inverter» → «Inverter»} y MHD antes que Icecat; «Fondo reducido» con tramos sobre la profundidad {"" a "50" → «Fondo reducido»; "50" a "" → ""}.
Todo lo que pongas en una regla lo ejecuta código: no escribas condiciones que los métodos no puedan expresar. Si una condición no se puede expresar, simplifícala y explícala en «questions». Las notas («note») son solo para la persona que revisa.

Decisiones ya tomadas por la tienda (no las preguntes otra vez):
- Marcas: siglas en mayúsculas (AEG, LG, HP); el resto como lo escribe la marca en texto corrido (Samsung, Hyundai, Balay, De'Longhi); el código usa la grafía de Icecat.
- Simplificar: pocos valores por filtro, tramos abiertos en los extremos («Más de 10 kg») y redondeo a los valores que ya usa la tienda. Un valor nuevo en un filtro que no sea caracteristicas o mas_especificaciones necesita aprobación: propónlo en «questions».
- Características: solo las que ayudan a elegir; no las que tienen casi todos los productos de la familia.
- Más especificaciones: solo datos que la gente compara (consumo, ruido…), no datos técnicos poco conocidos.
- Medidas (alto, ancho, fondo): solo si las medidas cambian de verdad en la familia y la tienda ya las usa en ella.
- Umbrales de características según lo habitual en el sector (p. ej. lavadora de fondo reducido = hasta 50 cm).
- Respaldo de la descripción (decidido): para cada característica de filtro.caracteristicas, añade además una segunda regla con la fuente «texto:descripcion» (descripción de MHD y resumen de Icecat), el método contiene y una lista cerrada de nombres, también los comerciales de cada marca (p. ej. Vapor: «vapor», «ironAssist», «SteamCare»), para cuando el dato no venga como característica.

En «questions» deja las dudas que tenga que decidir una persona (p. ej. un valor nuevo para un filtro, o si un dato merece estar en el título). Escribe todo en español.`;

const strip = (html: string | null | undefined, max = 1500) => (html ?? "").replace(/<span[^>]*display:\s*none[^>]*>.*?<\/span>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

export function analystInput(summary: FamilySummary, sample: SampleProduct[], vocabulary: FilterVocabulary) {
  // Vocabulario: definiciones y valores de toda la tienda, más el detalle de los tipos de producto actuales que se
  // parecen a esta familia (p. ej. «Lavadoras Libre Instalación» para la familia Lavadoras).
  const stems = [summary.familyName, ...summary.subfamilies.map((item) => item.name)].flatMap((name) => name.toLowerCase().split(/[^a-záéíóúñü]+/)).filter((word) => word.length >= 5).map((word) => word.slice(0, 5));
  const relatedTypes = Object.fromEntries(Object.entries(vocabulary.byProductType).filter(([type]) => stems.some((stem) => type.toLowerCase().includes(stem))));
  return {
    familia: { codigo: summary.familyCode, nombre: summary.familyName, productos: summary.products, subfamilias: summary.subfamilies, marcas: summary.brands, precio: summary.price },
    caracteristicas_mhd: summary.mhdFeatures, caracteristicas_icecat: summary.icecatFeatures, categorias_icecat: summary.icecatCategories,
    muestra: sample.map(({ listing, detail, icecat }) => ({
      codigo: listing.codigo, titulo_mhd: listing.titulo, marca: listing.nombre_marca, modelo: listing.ref_proved, subfamilia: listing.nombre_subfamilia, pvp: listing.pvp,
      letra_eficiencia: listing.letra_eficiencia, descripcion_ampliada: listing.descripcion_ampliada, descripcion: strip((detail?.descripcion as string | undefined) ?? null),
      caracteristicas: detail?.caracteristicas ?? [],
      // Las especificaciones de Icecat ya van agregadas (con sus valores) en caracteristicas_icecat: aquí solo el contexto.
      icecat: icecat ? { titulo: icecat.title, categoria: icecat.category, serie: icecat.series, resumen: icecat.longSummary, destacados: icecat.bulletPoints } : null,
    })),
    filtros_tienda: vocabulary.definitions.map((definition) => ({ ...definition, valores: vocabulary.values[definition.key] ?? {} })),
    filtros_tipos_parecidos: relatedTypes,
  };
}

export async function runAnalyst(client: Anthropic, summary: FamilySummary, sample: SampleProduct[], vocabulary: FilterVocabulary) {
  const input = analystInput(summary, sample, vocabulary);
  const stream = client.beta.messages.stream({
    model: ANALYST_MODEL,
    max_tokens: 64000,
    // Si el modelo declina por seguridad, la API repite la petición con el modelo de reserva que corresponda.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: { type: "json_schema", schema: familyProfileSchema() } },
    system: SYSTEM,
    messages: [{ role: "user", content: `Datos de la familia, la muestra y los filtros de la tienda (JSON):\n\n${JSON.stringify(input)}\n\nDevuelve el perfil de la familia.` }],
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") throw new Error("El analista declinó la petición.");
  if (message.stop_reason === "max_tokens") throw new Error("La respuesta del analista se cortó (max_tokens).");
  const text = message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
  const profile = JSON.parse(text) as FamilyProfile;
  // El esquema no limita los metacampos: se quitan las reglas de metacampos que no existen en la tienda.
  const known = new Set(vocabulary.definitions.map((definition) => definition.key));
  const unknown = profile.filters.filter((rule) => !known.has(rule.metafield));
  profile.filters = profile.filters.filter((rule) => known.has(rule.metafield));
  if (unknown.length) profile.questions.push(`Se han quitado reglas para metacampos que no existen: ${unknown.map((rule) => rule.metafield).join(", ")}.`);
  return { profile, model: message.model, usage: message.usage, costUsd: costUsd(message.model, message.usage) };
}
