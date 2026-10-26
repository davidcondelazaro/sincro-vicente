# Sincronizaciones periódicas con MHD (diseño, 2026-10-26)

Diseño acordado con David para mantener la tienda al día una vez terminado el masivo del catálogo. Aún no está programado. Sustituye a las sincronizaciones preliminares (la de SQL Server de `ESTADO_SINCRONIZACION_SQL_SHOPIFY.md` y la importación diaria completa de `IMPORTACION_CATALOGO_MHD.md`).

## Qué se hace y cada cuánto

| Cada | Qué | Cómo se lee de MHD |
| --- | --- | --- |
| 30 min | Precio y stock directos a Shopify, sin IA | `/prices` y `/stocks` con `fecha_modificacion_precio` / `fecha_modificacion_stock` desde la última lectura (unos cientos por hora) |
| 1 hora | Altas: todo el proceso del importador (ficha de detalle, Icecat, IA, fotos, subida) | `/products` con `fecha_modificacion_producto` desde la última lectura; un código nuevo es un alta |
| 1 hora | Modificaciones, según su tipo (abajo) | El mismo `/products` filtrado; las huellas por partes (`IMPORTACION_FICHAS_MHD_Y_HUELLAS.md`) dicen qué ha cambiado |
| 1 hora | Bajas: archivar y redirigir | Listado completo de códigos (`/prices` entero, ~9 s) comparado con lo que tenemos |

Solo las altas y las modificaciones importantes piden el resto de datos (ficha de detalle, Icecat…). Todo lo demás sale de la lectura básica. Filtros por fecha comprobados en `API_MHD.md`.

## Decisiones

- **Altas:** se publican directamente en la tienda, sin borrador (David, 2026-10-26). La colocación se decide al subir, con el árbol nuevo de colecciones.
- **Bajas:** se **archivan** (no a borrador) y se crea su redirección a la colección de su familia en el árbol nuevo. Archivar las separa de los borradores pendientes, conserva su historial y se deshace si MHD vuelve a darlas de alta.
- **Bajas también para lo que entró con la sincronización antigua** (SQL Server / Pladisel): el «ERP» y MHD son lo mismo (David, 2026-10-26). Sustituye a la decisión de esa mañana de archivar solo lo creado por el importador. El 26-10 había 440 productos activos de esa vía cuyo EAN MHD ya había dado de baja; se cruzan por EAN o por código.
- **Seguros de las bajas** (una lectura incompleta de MHD parecería una baja masiva):
  - solo se da de baja lo que falta en **dos lecturas seguidas**;
  - **freno:** si de una vez desaparece más de un porcentaje pequeño del catálogo, no se archiva nada y se manda correo de fallo grave.
- **Histórico:** una tabla con todo lo ocurrido a cada producto (alta, baja, cambio, qué se hizo y con qué resultado), **sin caducidad**. El registro del importador (`mhd_importer_events`) se borra a los 60 días; este no.
- **Correos:**
  - inmediato **solo con fallos graves**: lectura de MHD fallida, freno de bajas, Anthropic sin saldo o con el tope de gasto alcanzado, Shopify rechazando la subida;
  - **resumen diario por la mañana** de las últimas 24 horas: altas, bajas y cambios; descartes con su motivo; lo que está en revisión; temas abiertos ya hablados.
  - sincro-vicente debe enviar correos; los del chatbot se usaban y han dejado de salir: revisar por qué al montarlo.
- **Freno general** del importador (`mhd_importer_brake_check`) también para las altas: si fallan 10 de los últimos 20, se pausa.

## Tipos de modificación (por decidir uno a uno)

Propuesta inicial:

| Cambio | Acción |
| --- | --- |
| Precio, stock | Directo cada 30 min |
| Fotos (huella de imágenes) | Rehacer solo las fotos |
| Título o descripción (huella de contenido) | ¿Rehacer los textos? |
| Familia o subfamilia | Recolocar en el árbol |
| Marca, EAN o modelo | A revisión: puede ser otro producto |
| Clase energética | Rehacer la etiqueta |
| Opciones de entrega | Actualizar el metacampo |

## Pendiente de decidir

- Hora del resumen diario y destinatarios.
- Servicio de correo.
- El porcentaje del freno de bajas.
