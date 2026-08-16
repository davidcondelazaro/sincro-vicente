-- Las promociones vuelven al flujo estándar de publicación de productos.
-- Se mantienen pendientes para que la siguiente sincronización aplique la
-- plantilla de tema y publique de nuevo los productos activos de V346.
update public.source_products
set shopify_synced = false
where active is true
  and id_category_default = 'V346';
