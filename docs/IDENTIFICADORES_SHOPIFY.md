# Identificadores de Shopify

Decidido por David el 2026-10-29: «en cualquier conector ERP-tienda tener el ID de cada extremo siempre ha sumado». Sustituye al espejo de la tienda ([ESPEJO_TIENDA_SHOPIFY.md](ESPEJO_TIENDA_SHOPIFY.md), retirado ese día).

## Qué guarda

Tabla `store_shopify_ids`, una fila por código de MHD (= SKU en Shopify):

| Campo | Contenido |
|---|---|
| `codigo` | Código de MHD |
| `product_id`, `variant_id`, `inventory_item_id` | Producto, variante y artículo de inventario en Shopify |
| `handle`, `ean` | Dirección y EAN que tiene el producto |
| `status`, `title`, `product_type` | Estado, título y tipo (familia del árbol) que le puso el importador |

No guarda nada que no hayamos escrito nosotros: precio y stock se comparan con lo último que enviamos (`mhd_shopify_price_stock`), no con Shopify.

## Quién la escribe

- **La subida del importador** (`rememberShopifyIds` en `src/lib/mhd-importer/shopify-ids.ts`): al crear o actualizar el producto, con lo que devuelve `productSet`.
- **El archivado de duplicados por EAN** (`rememberShopifyStatus`).
- **No se refresca.** La carga inicial (2026-10-29) salió del espejo: 24.472 productos (24.275 activos y 197 borradores), los mismos que cubría el espejo, sin diferencias.

## Quién la lee

- Base de datos: precio y stock (`mhd_price_stock_changes`), agotados (`mhd_absence_candidates`), altas (`mhd_new_products`), Inicio (`mhd_catalog_overview`) y los informes (`mhd_sync_report`, `mhd_absence_report`).
- Agotados: tamaño de la tienda para el freno del 2 %.
- Pantallas: productos bloqueados, cola de revisión (enlace «Ver en Shopify») y garantías (activos por familia).
- Redirecciones: el producto al que apunta cada URL vieja. Los que no están (productos de la tienda antigua sin código de MHD, casi todos archivados) se preguntan a Shopify por dirección, de 50 en 50.

## Lo puntual se pregunta a Shopify

Una consulta ligera por producto, en el momento (el importador tarda un minuto o más por producto, así que no pesa):

- **¿Ya existe por EAN?** `storeProductsByEan`: los productos con ese EAN, también los que no son de MHD. Lo usan la subida (refrescar el existente y archivar duplicados; los ya archivados no se vuelven a archivar), el procesado (la dirección del existente le vale) y las tandas «solo nuevos».
- **¿Está libre la dirección?** `handleOwner`, más `mhd_importer_handles`, que reserva la dirección para que dos productos de una tanda no se queden la misma.

## Lo que queda fuera

- Productos que no vienen de MHD y no tienen código: garantías, servicios y tarjeta regalo (no se sincronizan).
- Productos de la tienda antigua cuyo equivalente de MHD (por EAN) descartó el importador: nadie los pisa y ninguna sincronización los ve. El 30-10 había 6 activos con stock de agosto (2 auriculares Sennheiser y 2 radios descartados por «Sin imagen», 2 Satisfyer por «Salud sexual: no se importa»); se archivaron con el visto bueno de David. Los de «Sin imagen» vuelven solos cuando MHD les pone fotos (el paso de altas los reprocesa y la subida reactiva el archivado por EAN). Sus URLs de PrestaShop van en la carga masiva de redirecciones.
- Las tablas del espejo (`shopify_products`, `shopify_variants`, `shopify_collections`, `shopify_mirror_runs`) se borraron el 2026-10-30 con el sí de David, tras comprobar que ningún código, función, vista ni tarea las usaba.
