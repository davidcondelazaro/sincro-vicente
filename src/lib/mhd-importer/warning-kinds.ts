// Tipos fijos de los avisos, decisiones y errores del importador (David, 2026-10-26): para resumir después del masivo
// qué ha fallado y qué dudas quedan, sin depender de leer texto libre. El registro de cada producto guarda el tipo en
// `data.tipo` y la pantalla «Procesos» los cuenta por tanda. `destino`: a quién le toca (MHD = va al informe para el
// proveedor; revisar = dudas para David; interno = nuestro). El primero que encaja gana: el orden importa.
export type WarningKind = { tipo: string; nombre: string; destino: "mhd" | "revisar" | "interno"; test: RegExp };

export const WARNING_KINDS: WarningKind[] = [
  { tipo: "sin_saldo", nombre: "Anthropic sin saldo", destino: "interno", test: /Sin saldo en Anthropic|credit balance/i },
  { tipo: "ficha_mhd", nombre: "MHD no devolvió la ficha", destino: "mhd", test: /MHD no devolvió la ficha|MHD ya no tiene el producto/ },
  { tipo: "foto_mhd_inexistente", nombre: "Foto de MHD que no existe en su servidor", destino: "mhd", test: /MHD no tiene esa foto/ },
  { tipo: "foto_no_descargada", nombre: "Foto que no se pudo descargar", destino: "interno", test: /No se pudo descargar .*\.(jpe?g|png|webp|gif)/i },
  { tipo: "descarte_sin_foto", nombre: "Descartado: sin foto", destino: "mhd", test: /Descartado: sin imagen/i },
  { tipo: "descarte_exclusion", nombre: "Descartado por exclusión (maqueta, unidad suelta…)", destino: "interno", test: /^Descartado/ },
  { tipo: "foto_pequena", nombre: "Foto pequeña", destino: "revisar", test: /foto pequeña|Foto pequeña|Demasiado pequeña|foto principal queda pequeña/i },
  { tipo: "foto_descartada", nombre: "Foto descartada al revisarla", destino: "interno", test: /^Foto (de MHD )?descartada/ },
  { tipo: "fotos_icecat", nombre: "Fotos completadas o sustituidas con Icecat", destino: "interno", test: /Fotos de Icecat|sustituida por la misma de Icecat/ },
  { tipo: "icecat_otro_modelo", nombre: "Icecat de otro modelo", destino: "revisar", test: /^Icecat de otro modelo/ },
  { tipo: "icecat_sin_modelo", nombre: "Icecat no tiene nuestro modelo", destino: "interno", test: /Icecat no tiene nuestro modelo/ },
  { tipo: "icecat_por_modelo", nombre: "Icecat encontrado por marca y modelo", destino: "interno", test: /Icecat encontrado por marca y modelo/ },
  { tipo: "etiqueta_otro_modelo", nombre: "Etiqueta energética de otro modelo", destino: "mhd", test: /etiqueta de (MHD|Icecat) es de otro modelo/i },
  { tipo: "sin_etiqueta", nombre: "Clase energética sin etiqueta válida", destino: "mhd", test: /sin etiqueta válida|Etiqueta de baja calidad|^Etiqueta energética:/ },
  { tipo: "sin_eprel", nombre: "Sin código EPREL", destino: "interno", test: /Sin código EPREL/ },
  { tipo: "documento", nombre: "Documento no subido (PDF grande o con error)", destino: "interno", test: /\.pdf/i },
  { tipo: "video", nombre: "Vídeo no usado o con error", destino: "interno", test: /[Vv]ídeo/ },
  { tipo: "filtros_sin_dato", nombre: "Filtros sin dato en MHD ni Icecat", destino: "mhd", test: /^Filtros sin dato/ },
  { tipo: "modelo_corregido", nombre: "Modelo corregido (Icecat o limpieza)", destino: "mhd", test: /^Modelo:/ },
  { tipo: "marca_corregida", nombre: "Marca corregida", destino: "mhd", test: /^Marca:/ },
  { tipo: "elvi_rechazada", nombre: "Frase de Elvi rechazada", destino: "interno", test: /Frase de Elvi/ },
  { tipo: "ficha_bloqueada", nombre: "Ficha bloqueada por el revisor de datos", destino: "revisar", test: /Ficha bloqueada|afirmaciones sin respaldo/ },
  { tipo: "texto_validacion", nombre: "Texto con avisos de validación", destino: "interno", test: /^Validación del texto|^Intento \d+ rechazado/ },
  { tipo: "colocacion", nombre: "Sin colocación clara en la tienda", destino: "revisar", test: /hermana de la tienda|coincide por EAN con esta subfamilia|colección de marca/ },
  { tipo: "perfil_sin_revisar", nombre: "Perfil de la familia sin revisar", destino: "revisar", test: /perfil de la familia aún no está revisado/ },
  { tipo: "revision_energia", nombre: "Revisión: clase energética distinta", destino: "mhd", test: /Clase energética distinta/ },
  { tipo: "revision_cifras", nombre: "Revisión: MHD e Icecat no cuadran", destino: "mhd", test: /MHD dice «.*» e Icecat/ },
  { tipo: "revision_precio", nombre: "Revisión: precio raro", destino: "revisar", test: /Precio raro|Sin precio/ },
  { tipo: "revision", nombre: "Revisión: otros motivos", destino: "revisar", test: /^Revisión:|Va a revisión/ },
  { tipo: "shopify", nombre: "Error al subir a Shopify", destino: "interno", test: /Shopify|no se subió/i },
  { tipo: "otro", nombre: "Otros", destino: "interno", test: /[\s\S]*/ },
];

export function warningKind(message: string) {
  return (WARNING_KINDS.find((kind) => kind.test.test(message)) ?? WARNING_KINDS[WARNING_KINDS.length - 1]).tipo;
}
