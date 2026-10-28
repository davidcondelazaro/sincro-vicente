# Sincronizaciones periódicas con MHD (diseño, 2026-10-26)

Diseño acordado con David para mantener la tienda al día una vez terminado el masivo del catálogo. Aún no está programado. Sustituye a las sincronizaciones preliminares (la de SQL Server de `ESTADO_SINCRONIZACION_SQL_SHOPIFY.md` y la importación diaria completa de `IMPORTACION_CATALOGO_MHD.md`).

## Qué se hace y cada cuánto

**Se lee siempre todo y la comparación la hacemos nosotros** (David, 2026-10-26: «no quiero que dependamos de que nos digan que se ha modificado»). No se usan los filtros por fecha. Cada producto guarda sus huellas (precio, stock, contenido, fotos y entrega); se calculan las nuevas y se actúa sobre las que cambian. Si una lectura falla, la siguiente lo recoge todo.

| Cada | Lectura de MHD (medida el 2026-10-26) | Qué se hace |
| --- | --- | --- |
| 30 min | `/prices` y `/stocks` completos: ~11 s y 3,7 MB; ~12 s y 2,3 MB | Precio y stock directos a Shopify, sin IA. Los códigos sirven además para ver altas y bajas. |
| 1 hora | `/products` completo: 30.961 productos, ~24-33 s, 125 MB | Altas (códigos nuevos: todo el proceso del importador), bajas (códigos que faltan en dos lecturas seguidas: archivar y redirigir), opciones de entrega y modificaciones según su tipo (abajo). |

El listado no permite pedir menos campos (probados 9 nombres de parámetro) y trae las dos descripciones largas: 2,7 de los 4 KB de media por producto; la ficha de detalle solo añade características (0,27 KB) y galería (0,31 KB). Lo que se descarga (~3,3 GB al día) no se guarda: cada producto tiene una sola fila con su última versión (todo el catálogo de MHD ocupa ~370 MB) y el histórico solo apunta los cambios.

Solo las altas y las modificaciones importantes piden la ficha de detalle (una petición por producto: con todo el catálogo, ~44 min), Icecat e IA. Peticiones a MHD enviadas el 2026-10-26 (fichas por lotes, gzip, elegir campos, bajas explícitas, qué cambia cada fecha…): si llegan, se simplifica. **Fichas por lotes: MHD dice que no** (2026-10-27, porque afecta a su sistema de producción), así que la ficha de detalle se sigue pidiendo de una en una y solo para altas y cambios.

## Decisiones

- **Altas:** se publican directamente en la tienda, sin borrador (David, 2026-10-26). La colocación se decide al subir, con el árbol nuevo de colecciones.
- **Bajas:** se **archivan** (no a borrador) y se crea su redirección a la colección de su familia en el árbol nuevo. Archivar las separa de los borradores pendientes, conserva su historial y se deshace si MHD vuelve a darlas de alta.
- **Vuelta de un archivado** (David, 2026-10-27): si MHD vuelve a traer un producto que estaba archivado, se **reactiva** (activo, o borrador si tiene revisión pendiente o «Avisar a MHD»), conserva su URL y se **quita su redirección**: la de `/products/<handle>` se borra en Shopify y se descarta en la base de redirecciones. Ojo con las redirecciones cada vez que algo se reactive. Hecho en la subida (`shopify-draft.ts`, `releaseProductRedirects`).
- **Bajas también para lo que entró con la sincronización antigua** (SQL Server / Pladisel): el «ERP» y MHD son lo mismo (David, 2026-10-26). Sustituye a la decisión de esa mañana de archivar solo lo creado por el importador. El 26-10 había 440 productos activos de esa vía cuyo EAN MHD ya había dado de baja; se cruzan por EAN o por código.
- **Seguros de las bajas** (una lectura incompleta de MHD parecería una baja masiva):
  - solo se da de baja lo que falta en **dos lecturas seguidas**;
  - **freno:** si de una vez desaparece más de un porcentaje pequeño del catálogo, no se archiva nada y se manda correo de fallo grave.
- **Histórico:** una tabla con todo lo ocurrido a cada producto (alta, baja, cambio, qué se hizo y con qué resultado), **sin caducidad**. El registro del importador (`mhd_importer_events`) se borra a los 60 días; este no.
- **Correos:**
  - inmediato **solo con fallos graves**, también a david@aligeria.com: lectura de MHD fallida, freno de bajas, Anthropic sin saldo o con el tope de gasto alcanzado, Shopify rechazando la subida;
  - **resumen diario a las 9:00 (hora de España) a david@aligeria.com** (David, 2026-10-26), de las últimas 24 horas: altas, bajas y cambios; descartes con su motivo; lo que está en revisión; temas abiertos ya hablados.
  - **Servicio: Resend**, el mismo que usa chatbot-vicente para las incidencias desde el 2026-10-11 (ver su `docs/gestion-sincro-vicente.md`). Hace falta `RESEND_API_KEY` en el entorno de sincro-vicente en Vercel (la pone David) y un remitente del dominio verificado. David dice que los correos del chatbot han dejado de salir: revisarlo al montarlo, porque comparten servicio.
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
| Opciones de entrega | **Se actualizan solas, siempre** (David, 2026-10-26: «esta parte es importantísima»): portes, subida, instalación y retirada del viejo, con sus precios, al metacampo `custom.opciones_entrega`, sin IA. Se detectan en cada lectura del listado (cada hora), que trae los siete campos de portes y servicios. Hoy van dentro de la huella «precio» (`mhd_hash_parts`): conviene separarlos en una huella propia. Sale en el resumen diario. Si un servicio desaparece o su precio sube mucho, aviso en el resumen. |

## Lo que cada subida avisa a la estructura de la tienda (acuerdo con la sesión del árbol, 2026-10-28)

David: «siempre hay que pensar en el importador para que todo lo nuevo vaya fino». La estructura (colecciones, menús, marcas, tema) no se crea sola con los productos:

- **Proveedores sin colección de marca:** el informe de cada subida los lista; con ellos se lanza `theme-enterprise-vicente/tools/shopify/marcas_nuevas.py`, que crea solo las que faltan.
- **Variantes nuevas de proveedor** (p. ej. «POLK AUDIO» frente a «polk»): el informe lista las que no estén en `theme-enterprise-vicente/snippets/marca-handle.liquid`, que traduce cada variante a su marca. El proveedor de los productos no se cambia (movería las colecciones de marca).
- **Familia nueva** (en `store_collections` o como destino nuevo en `store_icecat_category_map`): su colección de Shopify se crea con `tools/shopify/arbol_colecciones.py` (sesión del árbol).
- **Después de cambiar metacampos del árbol en bloque**, volver a guardar sin cambios la regla de las colecciones afectadas: Shopify no las recalcula solo.

## Pendiente de decidir

- El porcentaje del freno de bajas.
