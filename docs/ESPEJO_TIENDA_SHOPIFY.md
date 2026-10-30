# Espejo de la tienda de Shopify (retirado)

> **Retirado el 2026-10-29.** Lo sustituyen los identificadores de cada extremo: ver [IDENTIFICADORES_SHOPIFY.md](IDENTIFICADORES_SHOPIFY.md). El código se quitó (`src/lib/shopify-mirror.ts`, el refresco del trabajador y el botón «Actualizar espejo»); las tablas se borraron el 2026-10-30 con el sí de David. Lo de abajo queda como historia.

Decidido por David el 2026-10-26: las sincronizaciones e importaciones no preguntan a Shopify producto a producto. Leen una copia local de la tienda en Supabase y solo escriben en Shopify cuando suben algo.

## Qué guarda

| Tabla | Contenido |
|---|---|
| `shopify_products` | Identificador, dirección (`handle`), estado, título, proveedor, tipo, etiquetas, categoría y fechas de Shopify |
| `shopify_variants` | Identificador, producto, SKU, EAN (`barcode`), precio, precio tachado, venta sin stock e `inventory_item_id` |
| `shopify_collections` | Identificador, dirección, título y reglas de las automáticas (`null` en las manuales) |
| `shopify_mirror_runs` | Cada refresco: estado, cuándo, cuántos productos, variantes y colecciones, y el error si falla |

Índices por SKU, EAN, dirección y proveedor. La dirección no es única en el espejo: entre dos refrescos puede haber pasado de un producto a otro.

## Cómo se llena

- **Refresco completo** (`refreshShopifyMirror` en `src/lib/shopify-mirror.ts`): una consulta masiva de Shopify (*bulk operation*) para productos y variantes, y las colecciones por páginas. Lo que ya no está en Shopify se borra del espejo. Solo uno a la vez; uno que lleve más de 15 minutos «en curso» se da por caído.
  - Primera vez, el 2026-10-26: 4.807 productos, 4.815 variantes y 696 colecciones en 22 s.
- **Al subir un producto** (`mirrorProduct`): la subida pide a Shopify los mismos campos en la respuesta de `productSet` y guarda la fila al momento.
- **Cuándo se refresca:**
  - El trabajador de los procesos lo refresca al empezar si tiene más de 6 horas (`WORKER.mirrorMaxAgeHours`).
  - La pantalla «Procesos» tiene el botón «Actualizar espejo».
  - Sin espejo, solo trabaja el primer puesto, que lo llena; los demás esperan.

## Quién lo usa (2026-10-26)

- **Importador de MHD, al procesar:** cero consultas a Shopify.
  - Colocación en la tienda: tipo, etiquetas y categoría de las hermanas por EAN, y colección de marca por proveedor.
  - Dirección libre: espejo más `mhd_importer_handles`, que reserva la dirección para que dos productos de una tanda no se queden la misma.
  - Producto que ya está en la tienda: por EAN.
- **Importador de MHD, al subir:** busca por EAN en el espejo si el producto ya existe en Shopify. Solo pregunta a Shopify el producto concreto que va a actualizar y las ubicaciones, una vez por hora.

## Pendiente

- **Sustituir el espejo por los identificadores de cada extremo** (David, 2026-10-29: «en cualquier conector ERP-tienda tener el ID de cada extremo siempre ha sumado»). Ya solo hay procesos parciales (altas, agotados y bajas, cambios), y precio y stock se comparan con lo último que enviamos, no con Shopify. Basta guardar, por código de MHD, el producto, la variante y el artículo de inventario de Shopify al subirlo (ya está en `mhd_shopify_price_stock` y `mhd_importer_product_runs.shopify_product_id`), y preguntar a Shopify en el momento lo puntual: si un alta ya existe (por código o EAN), si una dirección está libre. Si Shopify contesta «no existe» al escribir, se vuelve a buscar por código y se corrige el identificador. Toca: precio y stock, agotados, altas, colocación y dirección en el importador, informes. Hacerlo después de las altas automáticas, pieza a pieza y comprobando cada una. Recordárselo a David.

- Que el resto de sincronizaciones (precios y stock desde SQL Server, que hoy usa `product_shopify_links`) lean del espejo. Va en la propuesta de rediseño de sincronizaciones.
- Refresco incremental (solo lo cambiado desde la última vez) o por *webhooks* de Shopify, si el completo se queda corto cuando la tienda crezca a ~35.000 productos.
