# Importador de productos MHD a Shopify: notas y pendientes

_Copiado de `theme-enterprise-vicente/docs/arbol-colecciones-mhd.md` (secciones «Importador de productos» e «Infraestructura de sincro-vicente», 2026-10-22). A partir de ahora se mantienen aquí._

## Importador de productos (proyecto `sincro-vicente`)

sincro-vicente ya lee de la API todo el catálogo de MHD a Supabase (tablas `mhd_catalog_*`, ver [IMPORTACION_CATALOGO_MHD.md](IMPORTACION_CATALOGO_MHD.md)) pero aún no escribe en Shopify. Muchas reglas se heredan del importador antiguo de SQL Server (validaciones previas, alta con precio y stock, archivado con redirección, imágenes por fecha de modificación); otras son nuevas.

- [ ] **Nueva interpretación de los datos de MHD** por producto: imágenes, filtros, etiqueta energética. David tiene claras las reglas de importación; falta escribirlas.
- [ ] **Descartes, siempre con su motivo en el informe** (decidido 2026-10-22):
    1. **Sin imagen:** se descarta. Es lo que más le importa a Vicente.
    2. **Sin información suficiente:** con imagen, pero sin datos con los que hacer una ficha decente, ni en MHD (descripciones, características) ni en Icecat. Se descarta después de consultar Icecat.

  En el catálogo de mayo, sin merchandising (23.633 productos): 46 sin imagen ni descripción, 1.067 sin imagen pero con descripción y 887 con imagen pero sin descripción. Solo se ha mirado `descripcion_ampliada` del listado; el detalle del producto trae además `caracteristicas`.
- [ ] **Icecat después del filtro** (se sigue haciendo mientras no se diga lo contrario): consultar Icecat por EAN para complementar la información, resolver dudas y completar la ficha técnica, que hoy se guarda en el metacampo `custom.icecat`. sincro-vicente ya tiene esa importación («Importación Icecat»), pero trabaja sobre productos ya creados en Shopify; en el flujo nuevo, Icecat entra antes de generar el contenido con IA, como una fuente más.
- [ ] **Contenido con IA** a partir de los datos de MHD, eligiendo el modelo para consumir lo mínimo:
    - título según unas reglas;
    - descripción corta o comercial;
    - descripción larga o ampliada;
    - características para los filtros, con los filtros actuales (se espera que cambien poco).
- [x] 2026-10-22 · **Árbol completo de categorías en la importación** (fase 1: niveles 1, 2 y 3): sincro-vicente solo guarda las 18 líneas (nivel 1); [IMPORTACION_CATALOGO_MHD.md](IMPORTACION_CATALOGO_MHD.md) lo dejó como consulta pendiente a MHD. Pero en *Pruebas API MHD* (2026-09-04) `GET /categories?nivel=2` y `?nivel=3` devolvieron 157 familias y 476 subfamilias (`outputs/categories_level*.json`). Ojo: el nivel 3 no trae el código del padre (se deduce por prefijo) y `padre` no filtra bien con códigos alfanuméricos (`G`, `H`, `S`…).
- [ ] **Precios y ofertas:** de MHD nada entra etiquetado como «Oferta» y su precio anterior (`pvp_antes`) se ignora: no se usa como precio tachado (2026-10-22).
- [ ] **Título** (estructura aprobada 2026-10-22): **tipo + marca + modelo + 2-3 datos clave de su familia**, unos 70 caracteres como máximo; marca escrita como la escribe la marca, resto en minúscula normal, modelo tal cual; sin « | », sin repeticiones, compatibilidades ni códigos internos; color solo si es lo que distingue al producto. Los datos clave se fijan por familia (tabla por preparar; regla genérica para el resto). Comparar antes con el estilo de los títulos actuales de la tienda. Se monta en la misma llamada de IA que las descripciones, con un modelo pequeño, y se valida por código (longitud, marca y modelo exactos).
- [ ] **El experimento se hace por piezas reutilizables en sincro-vicente** (descarte, Icecat, contenido con IA, colección y filtros, borrador en Shopify), para integrarlas luego en el importador oficial sin rehacerlas.
- [ ] **Experimento controlado:** un producto de MHD con todo el proceso (descarte, Icecat, contenido con IA, colección, filtros, imágenes, etiqueta energética) hasta dejarlo como **borrador** en Shopify. Antes, cerrar el título ideal.
- [ ] **Informes** de cada ejecución: todo lo descartado y por qué (sin imagen, poca información, sin precio, sin dato clave), lo que no casa con ninguna categoría del árbol, y las demás anomalías (ver *Informes de la importación*).

## Infraestructura de sincro-vicente (2026-10-22)

- [x] **Tareas programadas desactivadas** (no borradas): las seis de `cron.job` (clientes, catálogo, prioridades, precios, stock e Icecat) se lanzaban cada minuto (8.640 ejecuciones al día) con las colas vacías; la última importación de clientes era del 13 de agosto. Si se lanza a mano una importación antigua y se corta, ya no se reanuda sola. Anotado en [IMPORTACION_CATALOGO_MHD.md](IMPORTACION_CATALOGO_MHD.md).
- [x] **Limpieza:** importación de MHD de hoy (cortada por Vercel hacia las 08:40) marcada como fallida; borradas 243.877 filas en bruto de ejecuciones fallidas de MHD y 534.551 registros de cron de más de 7 días; tablas compactadas. Base de datos: de 1,3 GB a 399 MB.
- [x] Borradas también las filas en bruto de SQL Server (`source_sqlserver_rows`, 46.053) y las de la última importación completada de MHD (99.191), ya volcadas en las tablas normalizadas. Base de datos final: **239 MB**.
- [x] 2026-10-22 · **Corregir la retención** (resuelto en la fase 1: ya no hay filas en bruto, cada página va directa a las tablas finales): la importación de MHD solo borra las filas en bruto al terminar bien; las de ejecuciones fallidas se quedaban para siempre.
- [x] 2026-10-22 · Auditoría hecha: [AUDITORIA_IMPORTACION_MHD.md](AUDITORIA_IMPORTACION_MHD.md).
- [x] 2026-10-22 · **Rehacer la importación de MHD** según la auditoría: fase 1 en producción (función de Supabase `mhd-catalog-import`, una página por llamada; ver [IMPORTACION_CATALOGO_MHD.md](IMPORTACION_CATALOGO_MHD.md)). Pendiente: la primera importación completa real (la lanza David) y la fase 2 (fichas de detalle: fotos, características, etiqueta). Se revisó (la hizo Codex): cómo se llama a la API, cómo se encola, qué hace Vercel y qué Supabase, y si el progreso en pantalla refleja lo que pasa de verdad. Hallazgo ya visto: el bucle corre dentro de una función de Vercel, que se corta a los pocos minutos, y la pantalla siguió marcando «En curso».
- [x] 2026-10-22 · **Importaciones parciales por entidad, lanzables a mano** (decidido 2026-10-22, **muy importante**): categorías, marcas, productos, precios y stock, cada una por separado y también todas juntas. Por ahora siempre manuales; en producción se decidirá si se programan y si son fiables. MHD tiene endpoints propios `/prices` y `/stocks` (listados completos, sin filtro por fecha según la colección de Postman), mucho más ligeros que `/products`.
- [x] 2026-10-22 · **Bajas** (implementado en la fase 1; decidido 2026-10-22, **muy importante**: MHD no las comunica). Solo se detectan con una importación **completa de productos** que termine bien, comparando con la última completa: lo que estaba y ya no viene es baja. Las parciales (precios, stock…) nunca marcan bajas. Cada ejecución debe dejar la lista de bajas y de productos que reaparecen, para el informe y para archivar en Shopify.
- [x] 2026-10-22 · **Proyecto transferido a la organización Aligeria** (plan Pro, +10 $/mes), con la transferencia de Supabase: misma dirección, claves, datos, funciones, secretos y región (eu-west-1). Comprobado después: base de datos, 7 funciones activas, tareas programadas desactivadas y la app respondiendo.
- [x] 2026-10-22 · **Máquina subida a Micro** (gratis en la organización de pago); comprobado en la configuración de Postgres (1 GB de memoria).
- [ ] **Integración de GitHub desconectada** (necesario para la transferencia). Tenía activado «Deploy to production»: cada subida a `main` aplicaba migraciones en la base real, con un historial que no cuadra (73 aplicadas frente a 65 archivos). Historial cuadrado el 2026-10-22 (74 = 74, sin diferencias de esquema). Falta decidir si se vuelve a conectar.
