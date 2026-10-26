# Sincronizaciones periódicas con MHD (diseño, 2026-10-26)

Diseño acordado con David para mantener la tienda al día una vez terminado el masivo del catálogo. Aún no está programado. Sustituye a las sincronizaciones preliminares (la de SQL Server de `ESTADO_SINCRONIZACION_SQL_SHOPIFY.md` y la importación diaria completa de `IMPORTACION_CATALOGO_MHD.md`).

## Qué se hace y cada cuánto

| Cada | Qué | Cómo se lee de MHD |
| --- | --- | --- |
| 30 min | Precio y stock directos a Shopify, sin IA | `/prices` y `/stocks` con `fecha_modificacion_precio` / `fecha_modificacion_stock` desde la última lectura (unos cientos por hora) |
| 1 hora | Altas: todo el proceso del importador (ficha de detalle, Icecat, IA, fotos, subida) | `/products` con `fecha_modificacion_producto` desde la última lectura; un código nuevo es un alta |
| 1 hora | Modificaciones, según su tipo (abajo) | El mismo `/products` filtrado; las huellas por partes (`IMPORTACION_FICHAS_MHD_Y_HUELLAS.md`) dicen qué ha cambiado |
| 1 hora | Bajas: archivar y redirigir; opciones de entrega | Listado completo de `/products` (33 s, 125 MB): códigos que faltan y huellas de portes y servicios |
| 1 día | Repaso completo de precio y stock | `/prices` y `/stocks` enteros (~9 s cada uno), por si un cambio se escapó al filtro por fecha |

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
  - inmediato **solo con fallos graves**, también a david@aligeria.com: lectura de MHD fallida, freno de bajas, Anthropic sin saldo o con el tope de gasto alcanzado, Shopify rechazando la subida;
  - **resumen diario a las 9:00 (hora de España) a david@aligeria.com** (David, 2026-10-26), de las últimas 24 horas: altas, bajas y cambios; descartes con su motivo; lo que está en revisión; temas abiertos ya hablados.
  - sincro-vicente debe enviar correos; los del chatbot se usaban y han dejado de salir: revisar por qué al montarlo.
- **Freno general** del importador (`mhd_importer_brake_check`) también para las altas: si fallan 10 de los últimos 20, se pausa.

## Tipos de modificación (por decidir uno a uno)

Propuesta inicial:

| Cambio | Acción |
| --- | --- |
| Precio, stock | Directo cada 30 min |
| Fotos (huella de imágenes) | Se rehace la galería entera con las reglas del alta (MHD, completar con Icecat si hay 3 o menos, sin repetidas, revisar y tratar) y se compara con la publicada foto a foto. Si sale igual, no se toca. Si cambia: se suben solo las nuevas, se quitan las que sobran y se reordena (`productReorderMedia`, sin volver a subir). Las fotos que se reconocen como la misma (huella del archivo o huella visual, aunque MHD la haya vuelto a comprimir) conservan su archivo en Shopify y la clasificación que ya tenían: solo se clasifican con IA las nuevas. Las que dejan de usarse se **borran también de Archivos de Shopify** (David, 2026-10-26, como el importador antiguo de SQL), solo si las subió el importador. Hace falta guardar por producto cada foto publicada: id del archivo en Shopify, huella, huella visual, tipo y posición. |
| Título o descripción (huella de contenido) | Se vuelve a pedir la ficha de detalle y se comparan las características y los datos clave (medidas, capacidad, clase energética, modelo…) con los usados al redactar. **Si cambió algún dato, se rehacen los textos con la IA; si solo cambió la redacción de MHD, no**, y queda en el histórico y en el resumen diario (David, 2026-10-26: un cambio de texto puede esconder un cambio de datos). |
| Familia o subfamilia | **Se recoloca solo en el árbol nuevo** (David, 2026-10-26): metacampos de apartado, grupo y familia, colecciones y migas de pan. Se recalculan también los filtros (`filtro.*`), que dependen de la familia. La dirección del producto no cambia, así que no hace falta redirección. |
| Marca, EAN o modelo | **A revisión, sin tocar nada** (David, 2026-10-26): puede ser otro producto con el mismo código. Sale en el resumen diario. |
| Clase energética | **Todo lo que depende de ella** (David, 2026-10-26): la etiqueta energética (`custom.etiqueta_energetica`), la ficha de información del producto de la UE y el enlace a EPREL (`custom.documentos`, `custom.eprel`), el filtro de eficiencia y la etiqueta «Energética». Como es un dato clave, también se rehacen los textos (regla de los cambios de datos). Si la etiqueta nueva no casa con el modelo, a revisión. |
| Opciones de entrega | **Se actualizan solas, siempre** (David, 2026-10-26: «esta parte es importantísima»): portes, subida, instalación y retirada del viejo, con sus precios, al metacampo `custom.opciones_entrega`, sin IA. Hoy esos campos van dentro de la huella «precio» (`mhd_hash_parts`), pero `/prices` no los devuelve. Se detectan **cada hora con el listado completo de `/products`** (medido el 2026-10-26: 30.961 productos en 4 páginas de 9.999, **33 s y 125 MB**; trae los siete campos de portes y servicios), sin depender de qué fecha cambie MHD. Conviene separarlos en una huella propia. Sale en el resumen diario. Si un servicio desaparece o su precio sube mucho, aviso en el resumen. |

## Pendiente de decidir

- Servicio de correo.
- El porcentaje del freno de bajas.
