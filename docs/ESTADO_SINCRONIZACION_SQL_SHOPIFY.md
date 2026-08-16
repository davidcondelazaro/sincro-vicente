# Estado de la sincronización SQL Server → Supabase → Shopify

Este documento recoge las decisiones y cambios asentados durante agosto de 2026 para la sincronización del catálogo, precios y stock.

## Arquitectura acordada

El flujo queda separado en tres etapas:

1. SQL Server aporta una fotografía de los datos de Vicente.
2. Supabase conserva y normaliza esos datos en tablas `source_*`.
3. Las colas y Edge Functions utilizan esas tablas para actualizar Shopify.

La aplicación local y la publicada utilizan el mismo proyecto de Supabase. Por tanto, las migraciones y las Edge Functions desplegadas afectan al entorno compartido real.

## Copia desde SQL Server

La aplicación no se conecta directamente a la red de SQL Server. Solicita las tablas al puente HTTPS de Pladisel, que conserva las credenciales de SQL Server y acepta únicamente las tablas autorizadas. La URL y el token del puente se configuran como secretos de servidor en `SQL_SERVER_PROXY_URL` y `SQL_SERVER_PROXY_TOKEN`; no se copian a Supabase ni se exponen al navegador.

Durante esta primera fase, el puente devuelve una tabla completa y la aplicación la remite a Supabase en lotes de 1.000 filas. Si alguna tabla supera los límites prácticos de respuesta, el siguiente ajuste será paginar el puente, sin alterar la normalización ni el historial de ejecuciones.

La copia inicial guarda las filas recibidas en `source_sqlserver_rows` y después sustituye/normaliza las tablas de origen (`source_products`, `source_prices`, `source_stock`, fabricantes, categorías, características y productos relacionados).

`source_sqlserver_rows` no es un histórico ilimitado de cada versión del payload. Conserva la fotografía de origen necesaria para la normalización; el histórico operativo se conserva en las tablas de ejecuciones y sus eventos.

### Hash de origen

Cada fila de `source_sqlserver_rows` tiene `row_hash`, calculado con SHA-256 sobre el payload completo de la fila. El hash se genera automáticamente mediante trigger.

Las tablas normalizadas tienen estas columnas adicionales:

- `source_hash`: hash de la versión de SQL Server que originó la fila.
- `source_changed`: indica que el hash recibido es diferente del anterior durante la normalización.
- `shopify_synced`: indica si esa fila ya se ha tratado correctamente por su sincronizador de Shopify.

Se aplican a:

- `source_manufacturers`
- `source_categories`
- `source_features`
- `source_feature_values`
- `source_products`
- `source_prices`
- `source_related_products`
- `source_stock`

El proceso de normalización compara el hash anterior con el nuevo:

- mismo hash: no hay cambio y se conserva el estado de sincronización;
- hash diferente: `source_changed = true` y `shopify_synced = false`;
- primera carga: se inicializa el hash y se considera sincronizada para no marcar todo el catálogo como pendiente.

El hash representa los datos de la entidad. Las imágenes no tienen todavía un hash de archivo independiente; sus enlaces forman parte de la información del producto y se tratarán más adelante si hace falta.

### Migraciones relacionadas

- `20260815110000_source_hash_baseline.sql`: columnas, función de hash, trigger y estado inicial.
- `20260815120000_compare_source_hashes_on_normalization.sql`: comparación entre importaciones.
- `20260815123000_source_sqlserver_hash_lookup_index.sql`: índice para localizar rápidamente el hash de origen.
- `20260815124500_optimize_hash_normalization_timeout.sql`: optimización de la normalización y timeout ampliado a 120 segundos.

El aumento de timeout fue necesario porque la normalización de entidades relacionadas podía superar el timeout de PostgreSQL aunque el proceso terminara correctamente en unos 16 segundos tras la optimización.

## Enlaces SKU ↔ Shopify

La tabla `product_shopify_links` relaciona el SKU de Vicente con los identificadores técnicos de Shopify. No se modificó para añadir timestamps ni estados adicionales.

Campos funcionales principales:

- SKU de origen.
- ID de producto Shopify.
- ID de variante única.
- ID de inventario.
- `link_status`: `linked`, `missing_in_shopify` o `ambiguous_in_shopify`.
- número de coincidencias y datos básicos del producto Shopify.

Aunque el proyecto no trabaja con variantes comerciales, se guarda la variante técnica única porque Shopify la necesita para precios e inventario.

La tabla se completa con el script manual:

```bash
set -a; source .env.local; set +a
npm run sync:shopify-links
```

El script recorre los SKU por tandas, consulta Shopify por SKU exacto y guarda únicamente coincidencias inequívocas. La última comprobación dejó:

- 6.577 SKU de productos normalizados.
- 4.335 enlaces válidos.
- 2.242 SKU sin producto Shopify.
- 0 coincidencias ambiguas.

Los 2.242 SKU sin enlace correspondían a productos inactivos, por lo que no deben entrar en las sincronizaciones normales.

## Importaciones completadas

La carga de fabricantes, categorías, características, valores de características, productos relacionados, precios, stock y productos se completó con los hashes actuales.

En la carga inicial se estableció `shopify_synced = true` para no convertir todo el catálogo existente en una cola pendiente. En futuras copias completas, sólo los hashes diferentes se marcarán como pendientes.

Las pequeñas diferencias entre filas recibidas y filas normalizadas se deben a duplicados del origen, no a una pérdida silenciosa de datos.

## Precios

La pantalla es `/importacion-precios` y tiene cuatro modos:

### Solo cambios

Es el modo incremental. Selecciona únicamente filas de `source_prices` que cumplan simultáneamente:

- producto activo;
- enlace `product_shopify_links` válido;
- `shopify_synced = false`.

Después de una actualización correcta, el registro se marca como `shopify_synced = true`.

### Todo

Es el modo forzado. Procesa todos los precios de productos activos con enlace Shopify, sin mirar `shopify_synced`.

No realiza una lectura previa del precio actual en Shopify para comparar. Utiliza directamente los IDs guardados en `product_shopify_links` y envía la actualización.

### Unos IDs

Procesa sólo los SKU indicados, siempre aplicando los filtros de producto activo y enlace Shopify.

### Parcial

Procesa los registros modificados desde la última importación completa o parcial finalizada, además de aplicar los filtros de activo y enlace.

### Alcance actual del modo forzado

En la ejecución iniciada el 15 de agosto de 2026:

- total válido: 4.117 precios;
- incluye sólo productos activos y enlazados;
- no incluye los 2.336 precios sin producto activo o sin enlace válido;
- se actualiza directamente, sin comparación previa con Shopify.

El worker `sync-price-stock-imports` está desplegado como versión activa 15. La función registra cada evento y marca `source_prices.shopify_synced = true` después de una actualización correcta.

## Stock

La pantalla `/importacion-stock` utiliza ahora exactamente el mismo patrón que precios:

### Solo cambios

Selecciona filas de `source_stock` con producto activo, enlace Shopify válido e inventario Shopify disponible, siempre que `shopify_synced = false`. Una actualización correcta marca la fila como sincronizada.

### Todo, Unos IDs y Parcial

Aplican los mismos filtros de producto activo, enlace válido e inventario disponible, pero ignoran `shopify_synced`. Son actualizaciones forzadas: no se consulta previamente el nivel de stock actual en Shopify.

El worker obtiene el `shopify_inventory_item_id` desde `product_shopify_links` y usa `inventorySetOnHandQuantities` por lotes. Así se evita buscar cada SKU en Shopify antes de escribirlo y se conserva la idempotencia del lote.

Estado actual tras la preparación del flujo:

- 4.116 filas de stock activas, enlazadas y con ID de inventario.
- 0 filas pendientes en el modo «Solo cambios» en este momento.

El stock y los precios comparten la misma tabla de ejecuciones, eventos, cursor, controles de pausa/reanudación y marcado posterior de `shopify_synced`.

## Qué no se ha modificado

- Ordenación de productos.
- Icecat.
- Importación de clientes.
- Bajas y archivado derivados de cambios de origen.
- Hash independiente de archivos de imagen.
- Nuevas columnas en `product_shopify_links`.

## Productos: cambios y altas

La importación de productos utiliza ahora dos modos:

- **Solo cambios y altas**: recorre únicamente productos activos cuyo `shopify_synced` está pendiente o cuya correspondencia Shopify falta/no es válida.
- **Todo (forzado)**: recorre todos los productos activos, independientemente de `shopify_synced`.

Ambos modos admiten además una lista de SKU y una fecha `fecha_modificacion` como filtros. Las bajas quedan fuera de este flujo y se tratarán separadamente.

Para cada candidato:

1. Se consulta primero `product_shopify_links`.
2. Si hay un enlace válido, se recupera ese producto Shopify.
3. Si no hay enlace, se busca puntualmente por SKU y después por handle para evitar duplicados.
4. Si existe en Shopify, se reconstruye la correspondencia; si no existe, se crea el producto.
5. Tras finalizar correctamente producto, imágenes y publicación, se hace upsert de `product_shopify_links` con producto, variante, inventario, handle y estado.
6. Sólo entonces se marca `source_products.shopify_synced = true`.

`source_changed` permanece como señal histórica y no se borra al sincronizar. El flujo de altas deja preparados los IDs técnicos para que los procesos de precios y stock puedan operar inmediatamente sobre el nuevo producto.

## Cómo probar sin riesgo

1. Ejecutar una copia desde SQL Server.
2. Comprobar que las filas con cambios tienen `source_changed = true` y `shopify_synced = false`.
3. En precios, usar primero **Solo cambios**.
4. Para una prueba controlada, usar **Unos IDs** con un único SKU.
5. Reservar **Todo** para un forzado consciente: realiza escrituras directas en Shopify sobre todos los productos activos enlazados.
6. Revisar el registro de la ejecución: actualizados, sin cambios, advertencias, errores y pendientes.

Si no hay cambios pendientes, **Solo cambios** debe indicar que no existen registros válidos. Eso es correcto: la carga inicial deja todos los registros actuales como sincronizados y sólo una nueva importación con diferencias volverá a crear pendientes.

## Operación local

Desde `sincro-vicente`:

```bash
npm install
npm run dev -- --port 3100
```

La aplicación se abre en `http://localhost:3100`. Si la interfaz queda en «Preparando cola…» y no aparece una nueva ejecución, comprobar primero que el servidor local responde y reiniciarlo; en ese caso no se ha creado ninguna ejecución ni se han escrito precios por ese clic.

## Referencia de despliegues

- `import-source-catalog`: versión activa 10.
- `sync-price-stock-imports`: versión activa 16.
- `sync-catalog-imports`: versión activa 40.
- El proyecto Supabase compartido es `cxmsriqumanocmviuzok`.

Las credenciales y tokens no deben copiarse a este documento ni al repositorio.

## Decisiones para las próximas fases

### Copia automática programada desde Vercel (pendiente)

La copia de SQL Server se podrá programar desde Vercel, sin añadir procesos nuevos en Pladisel y reutilizando el puente HTTPS ya instalado.

El cron no reproducirá un clic de la interfaz ni duplicará la importación. Se extraerá el núcleo actual a un importador común que ya sabe:

- solicitar las ocho tablas autorizadas al puente PHP;
- enviar las filas a Supabase en lotes de 1.000;
- crear y actualizar la ejecución, su progreso y sus errores;
- normalizar el catálogo únicamente después de recibir todas las tablas.

La pantalla manual y una nueva ruta privada de cron llamarán a ese mismo importador. La ruta de cron se protegerá con `CRON_SECRET`, configurado sólo en Vercel, y se declarará en `vercel.json` con la frecuencia que se acuerde. Antes de iniciar una copia, comprobará en Supabase que no exista otra ejecución con estado `running`, para evitar solapamientos con una copia manual o una ejecución anterior.

Supabase seguirá siendo el destino y el registro de ejecuciones; no almacenará el token del puente ni programará esta tarea. La sincronización posterior a Shopify no forma parte de esta automatización inicial: la copia dejará los cambios detectados como pendientes para los flujos de catálogo, precio y stock.

Estas decisiones quedan guardadas como referencia antes de modificar marcas, categorías y características.

### Regla común

- Usar `source_changed` como señal histórica de que la entidad cambió.
- Usar `shopify_synced` para saber si ya se procesó correctamente.
- El modo incremental debe seleccionar sólo pendientes.
- Las ejecuciones forzadas pueden recorrer el conjunto completo, pero no deben crear enlaces técnicos innecesarios.
- Las bajas se tratarán en procesos separados.

### Marcas

- Añadir un modo incremental para marcas modificadas o pendientes.
- Crear o actualizar la colección correspondiente.
- Marcar `shopify_synced = true` sólo después de completar correctamente.
- No crear otra tabla de correspondencias salvo que Shopify lo exija.

### Categorías

- Procesar incrementalmente las categorías modificadas o pendientes.
- Respetar el orden jerárquico: padres antes que hijas.
- Si cambia un padre, valorar reprocesar también sus descendientes.
- Mantener las bajas fuera de este flujo por ahora.

### Características y valores

- Procesar sólo definiciones de características modificadas o pendientes.
- Cuando cambie una característica, revisar sus valores asociados.
- Mantener las exclusiones históricas ya definidas.
- No crear una tabla de correspondencias: localizar las definiciones por namespace y key de metafield.

### Productos relacionados

- No crear un proceso Shopify independiente para relaciones.
- Si cambia una relación, marcar el producto principal como pendiente para la siguiente sincronización de producto.

### Orden previsto

1. Marcas.
2. Categorías.
3. Características.
4. Valores de características.
5. Productos.
6. Precios y stock.
