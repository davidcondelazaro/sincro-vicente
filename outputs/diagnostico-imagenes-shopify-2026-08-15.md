# Diagnóstico de productos Shopify sin imágenes

Fecha de comprobación: 15 de agosto de 2026.

Se revisaron los 12 productos activos de Shopify que no tienen ningún medio asociado. Se contrastaron con `source_products` y `catalog_import_events` de Supabase, y se probaron todas las rutas de imagen mediante el proxy de Pladisel que utiliza la Edge Function `sync-catalog-imports`.

## Resultado

| SKU | URLs en origen | Resultado actual del proxy | Registro de sincronización | Conclusión |
| --- | ---: | --- | --- | --- |
| `ACV145501E` | 3 | 3 x 404 | Error: no se pudo descargar ninguna imagen | Rutas de origen rotas. |
| `CR5029` | 5 | 5 x 200 JPEG | Error el 14/08: no se pudo descargar ninguna imagen | Incidencia transitoria o ya corregida en origen; hoy es recuperable. |
| `CV6135F0` | 0 | No aplicable | Creado sin imágenes de origen | Falta la información de imágenes en la fuente. |
| `CV7D30E0` | 0 | No aplicable | Creado sin imágenes de origen | Falta la información de imágenes en la fuente. |
| `MI2118` | 5 | 5 x 404 | Error: no se pudo descargar ninguna imagen | Rutas de origen rotas. |
| `RO2932EA` | 2 | 2 x 404 | Error: no se pudo descargar ninguna imagen | Rutas de origen rotas. |
| `SCPD901AN` | 7 (6 únicas) | 6 x 404 | Error: no se pudo descargar ninguna imagen | Rutas de origen rotas; además hay una URL duplicada. |
| `SF5120E0` | 0 | No aplicable | Creado sin imágenes de origen | Falta la información de imágenes en la fuente. |
| `UB5920F0` | 0 | No aplicable | Creado sin imágenes de origen | Falta la información de imágenes en la fuente. |
| `UB9820E0` | 0 | No aplicable | Creado sin imágenes de origen | Falta la información de imágenes en la fuente. |
| `W4X1095NWK` | 11 | 11 x 404 | Error: no se pudo descargar ninguna imagen | Rutas de origen rotas. |
| `X-10BK` | 2 | 2 x 404 | Error: no se pudo descargar ninguna imagen | Rutas de origen rotas. |

## Detalle técnico

- Los seis productos con rutas fallidas devuelven HTTP 404 desde el proxy. La respuesta del proxy confirma que no puede acceder al archivo de origen y que el origen devuelve 404.
- No se ha detectado ninguna imagen accesible superior a 25 MB ni de dimensiones excesivas. No se pueden medir las rutas que devuelven 404 porque el archivo no existe o no es accesible.
- Las cinco imágenes de `CR5029` se descargan actualmente como JPEG de 28–49 KB y 1000 × 1000 px. Están dentro de los límites de Shopify.
- En Supabase, todos los productos figuran como `shopify_synced = true` e `images_sync_pending = false`, incluso los que terminaron con error de imagen. El estado se debe al comportamiento actual del worker: los productos creados sin URL de imagen se consideran correctos y los productos con fallo conservaron el evento de error, sin una marca separada que permita reintentarlos automáticamente.
- La Edge Function omite las respuestas que no sean correctas del proxy y termina con el mensaje genérico “No se pudo descargar ninguna imagen desde el origen” cuando no queda ninguna imagen válida.

## Acciones recomendadas

1. Corregir o restaurar en el origen las rutas de los seis SKU con 404.
2. Completar las URL de imagen en origen para los cinco SKU que llegan vacíos.
3. Reintentar solamente `CR5029` ya: sus cinco imágenes son válidas ahora.
4. Una vez resueltas las rutas, marcar los SKU afectados como pendientes de imágenes y lanzar una importación de productos limitada a esos SKU con imágenes forzadas.

