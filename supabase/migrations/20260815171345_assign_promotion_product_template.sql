-- Los productos de la categoría V346 usan la plantilla product.promociones.*
-- en Shopify. Reencolamos únicamente los activos para que el modo
-- "Solo cambios y altas" les aplique la nueva asignación de plantilla.
-- Los enlaces de product_shopify_links se conservan: sólo se reabre la
-- sincronización del catálogo de producto.
update public.source_products
set shopify_synced = false
where active is true
  and id_category_default = 'V346';
